// Realtime client (TSE-73 contract): same-origin Socket.IO, namespace /realtime, path /socket.io.
//
// Rules implemented here (see docs/API.md, "Realtime — TSE-73"):
// - ONE socket per project, shared by every listener (no socket per component).
// - Subscribe after EVERY connection; "live" only after the server acknowledged the subscription.
// - After every successful acknowledgement the listener is told to resynchronize over HTTP
//   (there is no event replay).
// - Socket.IO's own reconnection is used, with bounded backoff + jitter.
// - Notifications for another project are ignored. They carry no figures: they only say "refetch".
// - access.revoked / PROJECT_NOT_FOUND: the project is unavailable, the login stays valid.
// - Invalid / expired token: invalidate ONLY the captured session (the existing session-expiry behavior).
// - A transport failure alone never invalidates the session.
import { io } from "socket.io-client";
import {
  isAuthSessionCurrent,
  getAuthSessionSnapshot,
  invalidateAuthSession,
  subscribeToAuthInvalidation,
  type AuthSessionSnapshot,
} from "./auth-session";

export type RealtimeState = "connecting" | "live" | "reconnecting" | "offline" | "unavailable";

export interface RealtimeListener {
  onState(state: RealtimeState): void;
  /** A `traces.changed` notification for THIS project arrived. */
  onChanged(): void;
  /** The subscription was acknowledged (first time or after a reconnection): refetch now. */
  onSynced(): void;
  /** The server revoked access to this project. */
  onRevoked(): void;
}

/** The small part of a Socket.IO client socket that this module uses. */
export interface RealtimeSocket {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  active?: boolean;
  connected?: boolean;
  connect(): unknown;
  disconnect(): unknown;
  timeout(ms: number): {
    emit(event: string, payload: unknown, callback: (error: Error | null, ack?: unknown) => void): unknown;
  };
}

export type RealtimeSocketFactory = (auth: (callback: (data: { token: string | null }) => void) => void) => RealtimeSocket;

export const SUBSCRIBE_TIMEOUT_MS = 5000;
export const RECONNECT_DELAY_MS = 1000;
export const RECONNECT_DELAY_MAX_MS = 30_000;

const AUTH_ERROR_CODES = new Set(["AUTHENTICATION_REQUIRED", "INVALID_ACCESS_TOKEN", "ACCESS_TOKEN_EXPIRED"]);

const defaultFactory: RealtimeSocketFactory = auth =>
  io("/realtime", {
    path: "/socket.io",
    autoConnect: false,
    auth,
    transports: ["polling", "websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: RECONNECT_DELAY_MS,
    reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
    randomizationFactor: 0.5,
  }) as unknown as RealtimeSocket;

let socketFactory: RealtimeSocketFactory = defaultFactory;

/** Tests only: replace the socket factory (pass nothing to restore the real one). */
export function setRealtimeSocketFactoryForTests(factory?: RealtimeSocketFactory): void {
  socketFactory = factory ?? defaultFactory;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `{ code }` from a socket error payload, whatever shape it has. */
function errorCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.code === "string") return value.code;
  if (isRecord(value.data) && typeof value.data.code === "string") return value.data.code;
  if (isRecord(value.error) && typeof value.error.code === "string") return value.error.code;
  return undefined;
}

/** Bounded exponential backoff with jitter (between 50 % and 100 % of the delay). */
export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(RECONNECT_DELAY_MAX_MS, RECONNECT_DELAY_MS * 2 ** Math.min(attempt, 10));
  return Math.round(base * (0.5 + random() * 0.5));
}

class ProjectConnection {
  private readonly listeners = new Set<RealtimeListener>();
  private readonly session: AuthSessionSnapshot;
  private socket: RealtimeSocket | null = null;
  private state: RealtimeState = "connecting";
  private closed = false;
  private subscribed = false;
  private generation = 0; // every (re)connection and every subscription attempt gets a new one
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopAuthWatch: () => void = () => {};

  constructor(
    private readonly organizationId: string,
    private readonly projectId: string,
    private readonly onEmpty: () => void,
  ) {
    this.session = getAuthSessionSnapshot();
  }

  add(listener: RealtimeListener): () => void {
    this.listeners.add(listener);
    listener.onState(this.state);
    if (this.subscribed && this.isCurrent()) listener.onSynced();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.close();
        this.onEmpty();
      }
    };
  }

  start(): void {
    if (this.session.token === null) { this.stopWithState("unavailable"); return; }
    this.stopAuthWatch = subscribeToAuthInvalidation(() => this.stopWithState("unavailable")); // signed out: clean up
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);

    const socket = socketFactory(callback => {
      if (this.isCurrent()) callback({ token: this.session.token });
    });
    this.socket = socket;
    this.setState(navigator.onLine === false ? "offline" : "connecting");

    socket.on("connect", () => {
      if (!this.isCurrent()) return;
      this.subscribed = false;
      this.generation += 1;
      this.subscribe(this.generation);
    });
    socket.on("disconnect", reason => {
      if (!this.isCurrent()) return;
      this.generation += 1; // answers to the old subscription are ignored
      this.subscribed = false;
      this.clearRetry();
      this.setState(navigator.onLine === false ? "offline" : "reconnecting");
      // The server closed the connection: Socket.IO does not reconnect by itself in that case.
      if (reason === "io server disconnect") this.scheduleReconnect();
    });
    socket.on("connect_error", error => {
      if (!this.isCurrent()) return;
      const code = errorCode(error);
      if (code !== undefined && AUTH_ERROR_CODES.has(code)) { this.authFailed(); return; }
      if (code === "PROJECT_NOT_FOUND") { this.revoked(); return; }
      this.setState(navigator.onLine === false ? "offline" : "reconnecting");
      // A namespace middleware rejection disables Socket.IO's automatic retry.
      // Transport failures (active=true) remain owned by Socket.IO.
      if (socket.active === false) this.scheduleReconnect();
    });
    socket.on("realtime.error", payload => {
      if (!this.isCurrent()) return;
      const code = errorCode(payload);
      if (code !== undefined && AUTH_ERROR_CODES.has(code)) this.authFailed();
      // Other codes: the server closes the connection next; the disconnect handler recovers.
    });
    socket.on("traces.changed", payload => {
      if (!this.isCurrent() || !this.subscribed) return;
      if (!isRecord(payload) || payload.projectId !== this.projectId) return; // another project
      for (const listener of [...this.listeners]) listener.onChanged();
    });
    socket.on("access.revoked", payload => {
      if (!this.isCurrent()) return;
      if (!isRecord(payload) || payload.projectId !== this.projectId) return;
      this.revoked();
    });
    socket.connect();
  }

  isCurrent(): boolean {
    if (this.closed) return false;
    if (isAuthSessionCurrent(this.session)) return true;
    this.stopWithState("unavailable");
    return false;
  }

  private subscribe(generation: number): void {
    const socket = this.socket;
    if (!socket || !this.isCurrent() || navigator.onLine === false) return;
    socket
      .timeout(SUBSCRIBE_TIMEOUT_MS)
      .emit("project.subscribe", { organizationId: this.organizationId, projectId: this.projectId }, (error, ack) => {
        if (!this.isCurrent() || generation !== this.generation) return; // an old attempt
        if (!error && isRecord(ack) && ack.ok === true && ack.projectId === this.projectId) {
          this.subscribed = true;
          this.attempts = 0;
          this.setState("live"); // only now
          for (const listener of [...this.listeners]) listener.onSynced();
          return;
        }
        const code = error ? undefined : errorCode(ack);
        if (code !== undefined && AUTH_ERROR_CODES.has(code)) { this.authFailed(); return; }
        if (code === "PROJECT_NOT_FOUND" || code === "VALIDATION_ERROR") { this.revoked(); return; }
        // Timeout, RATE_LIMITED, INTERNAL_SERVER_ERROR: try again later, bounded and jittered.
        this.setState(navigator.onLine === false ? "offline" : "reconnecting");
        this.clearRetry();
        const delay = backoffDelayMs(this.attempts++);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (this.isCurrent() && generation === this.generation) this.subscribe(generation);
        }, delay);
      });
  }

  private scheduleReconnect(): void {
    this.clearRetry();
    const delay = backoffDelayMs(this.attempts++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.isCurrent()) this.socket?.connect();
    }, delay);
  }

  private readonly handleOffline = () => {
    if (!this.isCurrent() || this.state === "unavailable") return;
    this.generation += 1;
    this.subscribed = false;
    this.clearRetry();
    this.setState("offline");
  };

  private readonly handleOnline = () => {
    if (!this.isCurrent() || this.state === "unavailable") return;
    this.setState(this.subscribed ? "live" : "reconnecting");
    // The browser is back: do not wait for the next backoff step.
    if (!this.subscribed) {
      this.clearRetry();
      if (this.socket?.connected) this.subscribe(++this.generation);
      else this.socket?.connect();
    }
  };

  private authFailed(): void {
    // Only the captured session: an old connection never signs out a newer login.
    invalidateAuthSession(this.session);
    this.stopWithState("unavailable");
  }

  private revoked(): void {
    this.stopWithState("unavailable");
    for (const listener of [...this.listeners]) listener.onRevoked();
  }

  private stopWithState(state: RealtimeState): void {
    this.teardown();
    this.setState(state);
  }

  private setState(state: RealtimeState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.listeners]) listener.onState(state);
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private teardown(): void {
    this.closed = true;
    this.generation += 1;
    this.subscribed = false;
    this.clearRetry();
    window.removeEventListener("online", this.handleOnline);
    window.removeEventListener("offline", this.handleOffline);
    this.stopAuthWatch();
    this.stopAuthWatch = () => {};
    this.socket?.disconnect();
    this.socket = null;
    // A stopped connection is never reused by a later listener of the same project.
    this.onEmpty();
  }

  close(): void {
    this.teardown();
  }
}

const connections = new Map<string, ProjectConnection>();

/**
 * Listen to the realtime events of one project. Calls for the same project share one socket.
 * Returns the function that stops listening; the socket closes with its last listener.
 */
export function subscribeToProjectRealtime(
  organizationId: string,
  projectId: string,
  listener: RealtimeListener,
): () => void {
  const key = organizationId + "/" + projectId + "/" + getAuthSessionSnapshot().revision;
  let connection = connections.get(key);
  if (connection && !connection.isCurrent()) connection = undefined;
  let created = false;
  if (!connection) {
    const fresh: ProjectConnection = new ProjectConnection(organizationId, projectId, () => {
      if (connections.get(key) === fresh) connections.delete(key);
    });
    connection = fresh;
    connections.set(key, fresh);
    created = true;
  }
  const remove = connection.add(listener);
  if (created) connection.start();
  return remove;
}
