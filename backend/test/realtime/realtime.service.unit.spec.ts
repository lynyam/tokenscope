import "reflect-metadata";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type { Socket } from "socket.io";
import { Logger } from "@nestjs/common";
import { RealtimeService } from "../../src/realtime/realtime.service";
import { TokenService } from "../../src/auth/token.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { PrismaService } from "../../src/database/prisma.service";
import { TraceChangesService } from "../../src/traces/trace-changes.service";
import { AccessChangesService } from "../../src/access-changes/access-changes.service";
import { ApiException } from "../../src/common/errors/api.exception";

const org = randomUUID(), project = randomUUID(), other = randomUUID(), user = randomUUID();
const scope = { organizationId: org, projectId: project };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
function socketFor(token = user) {
  const socket = Object.assign(new EventEmitter(), {
    id: randomUUID(), connected: true, handshake: { auth: { token } },
    conn: new EventEmitter(), rooms: new Set<string>(),
    join: jest.fn(async (name: string) => { socket.rooms.add(name); }),
    leave: jest.fn(async (name: string) => { socket.rooms.delete(name); }),
    disconnect: jest.fn(() => { socket.connected = false; }),
    emit: jest.fn(),
  });
  return socket;
}

describe("Realtime lifecycle", () => {
  let service: RealtimeService;
  let changes: TraceChangesService;
  let accessChanges: AccessChangesService;
  let authorize: jest.Mock;
  let read: jest.Mock;
  let verify: jest.Mock;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-18T10:00:00Z"));
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => {});
    changes = new TraceChangesService();
    accessChanges = new AccessChangesService();
    authorize = jest.fn().mockResolvedValue({ id: project });
    read = jest.fn().mockResolvedValue({ organization: { memberships: [{ userId: user }] } });
    verify = jest.fn((sub: string) => ({ sub, exp: Date.now() / 1000 + 3600 }));
    service = new RealtimeService(
      { verifyAccessToken: verify } as unknown as TokenService,
      { assertProjectAccess: authorize } as unknown as ProjectAccessService,
      { project: { findFirst: read } } as unknown as PrismaService,
      changes, accessChanges,
    );
    service.onModuleInit();
  });
  afterEach(async () => {
    await service.onModuleDestroy();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  const asSocket = (socket: ReturnType<typeof socketFor>) => socket as unknown as Socket;
  async function connect() {
    const socket = socketFor();
    service.prepare(asSocket(socket));
    expect(await service.subscribe(asSocket(socket), scope)).toEqual({ ok: true, projectId: project });
    return socket;
  }
  const changed = () => changes.publish({ projectId: project });
  const events = (socket: ReturnType<typeof socketFor>, name = "traces.changed") =>
    socket.emit.mock.calls.filter(([event]) => event === name);

  it("coalesces 100 changes in a fixed window and batches two recipients", async () => {
    const a = await connect(), b = await connect();
    await changed();
    await jest.advanceTimersByTimeAsync(100);
    for (let i = 1; i < 100; i++) await changed();
    await jest.advanceTimersByTimeAsync(49);
    expect(read).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(events(a)).toHaveLength(1);
    expect(events(b)[0][1]).toEqual(events(a)[0][1]);
    expect(Object.keys(events(a)[0][1]).sort()).toEqual(["eventId", "occurredAt", "projectId"]);
    expect(jest.getTimerCount()).toBe(2); // Only the two expiry timers remain.
  });

  it("schedules another flush for changes received during dispatch", async () => {
    const socket = await connect();
    const gate = deferred<unknown>();
    read.mockReturnValueOnce(gate.promise);
    await changed();
    await jest.advanceTimersByTimeAsync(150);
    await changed();
    gate.resolve({ organization: { memberships: [{ userId: user }] } });
    await jest.advanceTimersByTimeAsync(0);
    expect(events(socket)).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
    expect(events(socket)).toHaveLength(2);
  });

  it.each(["unsubscribe", "replacement", "revocation", "disconnect"])(
    "a late authorization cannot undo %s", async action => {
      const socket = socketFor();
      service.prepare(asSocket(socket));
      const gate = deferred<unknown>();
      authorize.mockReturnValueOnce(gate.promise);
      const pending = service.subscribe(asSocket(socket), scope);
      await jest.advanceTimersByTimeAsync(0);
      if (action === "unsubscribe") await service.unsubscribe(asSocket(socket));
      if (action === "replacement") {
        await service.subscribe(asSocket(socket), { ...scope, projectId: other });
      }
      if (action === "revocation") {
        await accessChanges.publish({ kind: "membership.removed", organizationId: org, userId: user });
      }
      if (action === "disconnect") service.release(asSocket(socket));
      gate.resolve({ id: project });
      expect(await pending).toMatchObject({ ok: false });
      expect(socket.rooms.has(`project:${project}`)).toBe(false);
      expect(socket.rooms.has(`project:${other}`)).toBe(action === "replacement");
    },
  );

  it("serializes a delayed join with a newer subscription to the same room", async () => {
    const socket = socketFor();
    service.prepare(asSocket(socket));
    const gate = deferred<void>();
    socket.join.mockImplementationOnce(async name => { await gate.promise; socket.rooms.add(name); });
    const first = service.subscribe(asSocket(socket), scope);
    await jest.advanceTimersByTimeAsync(0);
    const second = service.subscribe(asSocket(socket), scope);
    gate.resolve();
    expect(await first).toMatchObject({ ok: false });
    expect(await second).toEqual({ ok: true, projectId: project });
    expect(socket.rooms.has(`project:${project}`)).toBe(true);
  });

  it("invalid replacement leaves no room and invalid attempts consume the limit", async () => {
    const socket = await connect();
    const invalid = { ...scope, room: "forged" };
    for (let i = 0; i < 9; i++) {
      expect(await service.subscribe(asSocket(socket), invalid)).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
    }
    expect(await service.subscribe(asSocket(socket), scope)).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(socket.rooms.size).toBe(0);
    await jest.advanceTimersByTimeAsync(10_000);
    expect(await service.subscribe(asSocket(socket), scope)).toMatchObject({ ok: true });
  });

  it("keeps five connection slots and releases failed initialization", () => {
    const sockets = Array.from({ length: 5 }, () => socketFor());
    sockets.forEach(socket => service.prepare(asSocket(socket)));
    expect(() => service.prepare(asSocket(socketFor()))).toThrow("Too many");
    sockets[0].conn.emit("close");
    expect(() => service.prepare(asSocket(socketFor()))).not.toThrow();
  });

  it("expires a socket and rechecks expiry before a delayed join", async () => {
    verify.mockReturnValue({ sub: user, exp: Date.now() / 1000 + 1 });
    const socket = socketFor();
    service.prepare(asSocket(socket));
    const gate = deferred<unknown>();
    authorize.mockReturnValueOnce(gate.promise);
    const pending = service.subscribe(asSocket(socket), scope);
    // Advance wall time without firing the timer: join must check independently.
    jest.setSystemTime(Date.now() + 1001);
    gate.resolve({ id: project });
    expect(await pending).toMatchObject({ ok: false });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(events(socket, "realtime.error")[0][1].code).toBe("ACCESS_TOKEN_EXPIRED");
    expect(socket.rooms.size).toBe(0);
  });

  it("the expiry timer disconnects an idle socket", async () => {
    verify.mockReturnValue({ sub: user, exp: Date.now() / 1000 + 1 });
    const socket = await connect();
    await jest.advanceTimersByTimeAsync(1000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(events(socket, "realtime.error")[0][1].code).toBe("ACCESS_TOKEN_EXPIRED");
  });

  it.each(["unsubscribe", "expiry", "revocation"])(
    "does not deliver a delayed batch after %s", async action => {
      const socket = await connect();
      const gate = deferred<unknown>();
      read.mockReturnValueOnce(gate.promise);
      await changed();
      await jest.advanceTimersByTimeAsync(150);
      if (action === "unsubscribe") await service.unsubscribe(asSocket(socket));
      if (action === "expiry") jest.setSystemTime(Date.now() + 3_600_001);
      if (action === "revocation") await accessChanges.publish({ kind: "organization.archived", organizationId: org });
      gate.resolve({ organization: { memberships: [{ userId: user }] } });
      await jest.advanceTimersByTimeAsync(0);
      expect(events(socket)).toHaveLength(0);
    },
  );

  it("a failed batch fails closed; a missing membership revokes without logging out", async () => {
    const socket = await connect();
    read.mockResolvedValueOnce({ organization: { memberships: [] } });
    await changed();
    await jest.advanceTimersByTimeAsync(150);
    expect(events(socket, "access.revoked")).toHaveLength(1);
    expect(socket.disconnect).not.toHaveBeenCalled();
    await service.subscribe(asSocket(socket), scope);
    read.mockRejectedValueOnce(new Error("private database details"));
    await changed();
    await jest.advanceTimersByTimeAsync(150);
    expect(events(socket)).toHaveLength(0);
    expect(events(socket, "realtime.error")[0][1]).toEqual({ code: "INTERNAL_SERVER_ERROR", message: "Realtime is temporarily unavailable." });
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it("uses only the safe project-not-found error for denied subscriptions", async () => {
    const socket = socketFor();
    service.prepare(asSocket(socket));
    authorize.mockRejectedValue(new ApiException(404, "PROJECT_NOT_FOUND", "internal detail"));
    expect(await service.subscribe(asSocket(socket), scope)).toEqual({ ok: false, error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } });
  });

  it("access publication survives a failing listener", async () => {
    accessChanges.subscribe(() => { throw new Error("failure"); });
    await expect(accessChanges.publish({ kind: "organization.archived", organizationId: org })).resolves.toBeUndefined();
  });
});
