import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { isUUID } from "class-validator";
import type { Socket } from "socket.io";
import { TokenService } from "../auth/token.service";
import { PrismaService } from "../database/prisma.service";
import { ProjectAccessService } from "../projects/project-access.service";
import { ApiException } from "../common/errors/api.exception";
import { TraceChangesService } from "../traces/trace-changes.service";
import { AccessChangesService, type AccessChange } from "../access-changes/access-changes.service";
import { realtimeError, rejected, type ProjectSubscription, type RealtimeAck, type RealtimeErrorCode } from "./realtime.types";

interface Connection {
  socket: Socket;
  userId: string;
  expiresAt: number;
  generation: number;
  target?: ProjectSubscription;
  active?: ProjectSubscription;
  attempts: number[];
  expiryTimer?: NodeJS.Timeout;
  roomWork: Promise<void>;
  cleanup: () => void;
}
interface PendingChange {
  timer?: NodeJS.Timeout;
  flushing: boolean;
  dirty: boolean;
}
const room = (projectId: string) => `project:${projectId}`;
const READ_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

@Injectable()
export class RealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly connections = new Map<string, Connection>();
  private readonly userCounts = new Map<string, number>();
  private readonly pending = new Map<string, PendingChange>();
  private readonly subscriptions: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly tokens: TokenService,
    private readonly access: ProjectAccessService,
    private readonly db: PrismaService,
    private readonly traceChanges: TraceChangesService,
    private readonly accessChanges: AccessChangesService,
  ) {}

  onModuleInit(): void {
    this.subscriptions.push(
      this.traceChanges.subscribe(({ projectId }) => this.changed(projectId)),
      this.accessChanges.subscribe(change => this.revoke(change)),
    );
  }

  // Namespace middleware calls this before accepting the connection.
  prepare(socket: Socket): void {
    if (this.closed) throw this.connectionError("INTERNAL_SERVER_ERROR");
    const token: unknown = socket.handshake.auth?.token;
    if (token === undefined) throw this.connectionError("AUTHENTICATION_REQUIRED");
    if (typeof token !== "string" || !token || token.length > 8192) {
      throw this.connectionError("INVALID_ACCESS_TOKEN");
    }
    let claims: ReturnType<TokenService["verifyAccessToken"]>;
    try { claims = this.tokens.verifyAccessToken(token); }
    catch (error) {
      throw this.connectionError(error instanceof Error && error.name === "TokenExpiredError"
        ? "ACCESS_TOKEN_EXPIRED" : "INVALID_ACCESS_TOKEN");
    }
    const expiresAt = claims.exp * 1000;
    if (!Number.isFinite(expiresAt)) throw this.connectionError("INVALID_ACCESS_TOKEN");
    if (expiresAt <= Date.now()) throw this.connectionError("ACCESS_TOKEN_EXPIRED");
    const count = this.userCounts.get(claims.sub) ?? 0;
    if (count >= 5) throw this.connectionError("RATE_LIMITED");
    const state: Connection = {
      socket, userId: claims.sub, expiresAt, generation: 0,
      attempts: [], roomWork: Promise.resolve(), cleanup: () => this.release(socket),
    };
    this.connections.set(socket.id, state);
    this.userCounts.set(state.userId, count + 1);
    // A failed initialization has no namespace disconnect event.
    socket.conn.once("close", state.cleanup);
    socket.once("disconnect", state.cleanup);
    this.armExpiry(state);
  }

  accept(socket: Socket): boolean {
    const state = this.connections.get(socket.id);
    return !!state && this.live(state);
  }

  async subscribe(socket: Socket, payload: unknown): Promise<RealtimeAck> {
    const state = this.connections.get(socket.id);
    if (!state || !this.live(state)) return rejected("INVALID_ACCESS_TOKEN");
    this.clear(state); // Replacement always leaves the previous subscription.
    const generation = state.generation;
    const now = Date.now();
    state.attempts = state.attempts.filter(time => time > now - 10_000);
    const limited = state.attempts.length >= 10;
    if (!limited) state.attempts.push(now);
    await state.roomWork;
    if (!this.current(state, generation)) return rejected("PROJECT_NOT_FOUND");
    if (limited) return rejected("RATE_LIMITED");
    if (!this.validSubscription(payload)) return rejected("VALIDATION_ERROR");
    const scope = { ...payload };
    state.target = scope; // Pending authorization must also be revocable.
    try {
      await this.access.assertProjectAccess(state.userId, scope.organizationId, scope.projectId, READ_ROLES);
      let joined = false;
      await this.queueRoom(state, async () => {
        if (!this.current(state, generation)) return;
        await socket.join(room(scope.projectId));
        if (!this.current(state, generation)) {
          await socket.leave(room(scope.projectId));
          return;
        }
        state.active = scope;
        joined = true;
      });
      return joined && this.current(state, generation)
        ? { ok: true, projectId: scope.projectId } : rejected("PROJECT_NOT_FOUND");
    } catch (error) {
      if (this.current(state, generation)) this.clear(state);
      return rejected(error instanceof ApiException && error.code === "PROJECT_NOT_FOUND"
        ? "PROJECT_NOT_FOUND" : "INTERNAL_SERVER_ERROR");
    }
  }

  async unsubscribe(socket: Socket, valid = true): Promise<RealtimeAck> {
    const state = this.connections.get(socket.id);
    if (!state || !this.live(state)) return rejected("INVALID_ACCESS_TOKEN");
    this.clear(state);
    await state.roomWork;
    return valid ? { ok: true } : rejected("VALIDATION_ERROR");
  }

  release(socket: Socket): void {
    const state = this.connections.get(socket.id);
    if (!state) return;
    this.connections.delete(socket.id);
    this.clear(state);
    clearTimeout(state.expiryTimer);
    socket.conn.off("close", state.cleanup);
    socket.off("disconnect", state.cleanup);
    socket.removeAllListeners("project.subscribe");
    socket.removeAllListeners("project.unsubscribe");
    const count = (this.userCounts.get(state.userId) ?? 1) - 1;
    if (count > 0) this.userCounts.set(state.userId, count);
    else this.userCounts.delete(state.userId);
  }

  private validSubscription(value: unknown): value is ProjectSubscription {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const body = value as Record<string, unknown>;
    return Object.keys(body).length === 2 && typeof body.organizationId === "string" &&
      typeof body.projectId === "string" && isUUID(body.organizationId) && isUUID(body.projectId);
  }

  private clear(state: Connection): void {
    const projectId = state.active?.projectId;
    state.generation += 1;
    state.target = undefined;
    state.active = undefined;
    if (projectId) {
      void this.queueRoom(state, async () => { await state.socket.leave(room(projectId)); }).catch(() => {});
      if (![...this.connections.values()].some(item => item.active?.projectId === projectId)) {
        const entry = this.pending.get(projectId);
        if (entry && !entry.flushing) {
          clearTimeout(entry.timer);
          this.pending.delete(projectId);
        }
      }
    }
  }

  // Serialize room mutations, not authorization reads. A late join must finish
  // and leave before a newer generation can join the same project room.
  private queueRoom(state: Connection, work: () => Promise<void>): Promise<void> {
    const result = state.roomWork.then(work);
    state.roomWork = result.catch(() => this.stop(state, "INTERNAL_SERVER_ERROR"));
    return result;
  }

  private live(state: Connection): boolean {
    if (this.closed || this.connections.get(state.socket.id) !== state) return false;
    if (state.expiresAt <= Date.now()) {
      this.stop(state, "ACCESS_TOKEN_EXPIRED");
      return false;
    }
    return state.socket.connected;
  }

  private current(state: Connection, generation: number): boolean {
    return this.live(state) && state.generation === generation;
  }

  private armExpiry(state: Connection): void {
    const remaining = state.expiresAt - Date.now();
    if (remaining <= 0) { this.stop(state, "ACCESS_TOKEN_EXPIRED"); return; }
    state.expiryTimer = setTimeout(() => this.armExpiry(state), Math.min(remaining, 2_147_483_647));
    state.expiryTimer.unref?.();
  }

  private stop(state: Connection, code: RealtimeErrorCode): void {
    if (this.connections.get(state.socket.id) !== state) return;
    if (state.socket.connected) state.socket.emit("realtime.error", realtimeError(code));
    this.release(state.socket);
    state.socket.disconnect(true);
  }

  private connectionError(code: RealtimeErrorCode): Error {
    return Object.assign(new Error(realtimeError(code).message), { data: realtimeError(code) });
  }

  private revoke(change: AccessChange): void {
    for (const state of this.connections.values()) {
      const scope = state.target;
      if (!scope || scope.organizationId !== change.organizationId) continue;
      if (change.kind === "membership.removed" && state.userId !== change.userId) continue;
      if (change.kind === "project.archived" && scope.projectId !== change.projectId) continue;
      this.revokeState(state, scope.projectId);
    }
  }

  private revokeState(state: Connection, projectId: string): void {
    this.clear(state);
    if (this.live(state)) state.socket.emit("access.revoked", { projectId, code: "PROJECT_NOT_FOUND" });
  }

  private changed(projectId: string): void {
    if (this.closed || ![...this.connections.values()].some(state => state.active?.projectId === projectId)) return;
    const existing = this.pending.get(projectId);
    if (existing) { existing.dirty = true; return; }
    const entry: PendingChange = { flushing: false, dirty: false };
    this.pending.set(projectId, entry);
    this.schedule(projectId, entry);
  }

  private schedule(projectId: string, entry: PendingChange): void {
    entry.timer = setTimeout(() => { void this.flush(projectId, entry); }, 150);
    entry.timer.unref?.();
  }

  private async flush(projectId: string, entry: PendingChange): Promise<void> {
    entry.timer = undefined;
    entry.flushing = true;
    entry.dirty = false;
    const candidates = [...this.connections.values()]
      .filter(state => state.active?.projectId === projectId && this.live(state))
      .map(state => ({ state, generation: state.generation }));
    try {
      if (!candidates.length) return;
      const userIds = [...new Set(candidates.map(({ state }) => state.userId))];
      // One batched Prisma read per project flush, never a query per socket.
      const project = await this.db.project.findFirst({
        where: { id: projectId, archivedAt: null, organization: { archivedAt: null } },
        select: { organization: { select: { memberships: {
          where: { userId: { in: userIds }, role: { in: [...READ_ROLES] } },
          select: { userId: true },
        } } } },
      });
      const allowed = new Set(project?.organization.memberships.map(member => member.userId) ?? []);
      const event = { eventId: randomUUID(), projectId, occurredAt: new Date().toISOString() };
      for (const { state, generation } of candidates) {
        if (!this.current(state, generation)) continue;
        if (!allowed.has(state.userId)) { this.revokeState(state, projectId); continue; }
        // Rooms are routing bookkeeping, not proof of current authorization.
        state.socket.emit("traces.changed", event);
      }
    } catch {
      this.logger.warn({ event: "realtime_authorization_failed", projectId });
      for (const { state, generation } of candidates) {
        if (this.current(state, generation)) this.stop(state, "INTERNAL_SERVER_ERROR");
      }
    } finally {
      entry.flushing = false;
      if (!this.closed && entry.dirty &&
          [...this.connections.values()].some(state => state.active?.projectId === projectId)) {
        this.schedule(projectId, entry);
      } else this.pending.delete(projectId);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closed = true;
    this.subscriptions.splice(0).forEach(unsubscribe => unsubscribe());
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
    const states = [...this.connections.values()];
    for (const state of states) {
      this.release(state.socket);
      state.socket.disconnect(true);
    }
    await Promise.all(states.map(state => state.roomWork));
  }
}
