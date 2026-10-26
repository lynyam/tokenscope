import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getAccessToken, saveAccessToken } from "@/api/auth-session";
import {
  setRealtimeSocketFactoryForTests, subscribeToProjectRealtime,
  type RealtimeListener, type RealtimeSocket,
} from "@/api/realtime-client";

class FakeSocket implements RealtimeSocket {
  active = true;
  connected = false;
  handlers = new Map<string, (...args: unknown[]) => void>();
  ack?: (error: Error | null, value?: unknown) => void;
  on(event: string, listener: (...args: unknown[]) => void) { this.handlers.set(event, listener); }
  connect = vi.fn(() => {});
  disconnect = vi.fn(() => {});
  emit = vi.fn((_event: string, _payload: unknown, ack: (error: Error | null, value?: unknown) => void) => { this.ack = ack; });
  timeout() { return { emit: this.emit }; }
  fire(event: string, value?: unknown) { this.handlers.get(event)?.(value); }
  ready() { this.connected = true; this.fire("connect"); this.ack?.(null, { ok: true, projectId: "p" }); }
}
const sockets: FakeSocket[] = [];
const stops: Array<() => void> = [];
const listener = (): RealtimeListener => ({ onState: vi.fn(), onChanged: vi.fn(), onSynced: vi.fn(), onRevoked: vi.fn() });
beforeEach(() => {
  vi.useFakeTimers();
  saveAccessToken("old-token");
  sockets.length = 0;
  setRealtimeSocketFactoryForTests(() => { const socket = new FakeSocket(); sockets.push(socket); return socket; });
});
afterEach(() => { stops.splice(0).forEach(stop => stop()); setRealtimeSocketFactoryForTests(); vi.useRealTimers(); });

it("shares one socket, reports Live only after the matching acknowledgement, and cleans up", () => {
  const a = listener(); const b = listener();
  stops.push(subscribeToProjectRealtime("o", "p", a));
  stops.push(subscribeToProjectRealtime("o", "p", b));
  expect(sockets).toHaveLength(1);
  const socket = sockets[0];
  expect(a.onState).not.toHaveBeenCalledWith("live");
  socket.ready();
  expect(a.onState).toHaveBeenLastCalledWith("live");
  expect(b.onSynced).toHaveBeenCalledTimes(1);
  socket.fire("traces.changed", { projectId: "other" });
  expect(a.onChanged).not.toHaveBeenCalled();
  socket.fire("traces.changed", { projectId: "p" });
  expect(a.onChanged).toHaveBeenCalledTimes(1);
  stops[0](); expect(socket.disconnect).not.toHaveBeenCalled();
  stops[1](); expect(socket.disconnect).toHaveBeenCalled();
});

it("resynchronizes after reconnection and when joining an already-live connection", () => {
  const a = listener(); const b = listener();
  stops.push(subscribeToProjectRealtime("o", "p", a));
  sockets[0].ready();
  stops.push(subscribeToProjectRealtime("o", "p", b));
  expect(b.onSynced).toHaveBeenCalledTimes(1);
  sockets[0].fire("disconnect", "transport close");
  sockets[0].ready();
  expect(a.onSynced).toHaveBeenCalledTimes(2);
});

it("revokes project access without clearing the session", () => {
  const a = listener(); stops.push(subscribeToProjectRealtime("o", "p", a));
  sockets[0].ready(); sockets[0].fire("access.revoked", { projectId: "p" });
  expect(a.onRevoked).toHaveBeenCalledOnce();
  expect(getAccessToken()).toBe("old-token");
});

it("does not deliver old-session events or invalidate a newer login", () => {
  const a = listener(); stops.push(subscribeToProjectRealtime("o", "p", a));
  sockets[0].ready(); saveAccessToken("new-token");
  const b = listener(); stops.push(subscribeToProjectRealtime("o", "p", b));
  expect(sockets).toHaveLength(2);
  sockets[0].fire("traces.changed", { projectId: "p" });
  sockets[0].fire("realtime.error", { code: "ACCESS_TOKEN_EXPIRED" });
  expect(a.onChanged).not.toHaveBeenCalled();
  expect(getAccessToken()).toBe("new-token");
});

it("uses a bounded manual retry only when Socket.IO will not reconnect", async () => {
  stops.push(subscribeToProjectRealtime("o", "p", listener()));
  const socket = sockets[0];
  socket.fire("connect_error", new Error("network"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(socket.connect).toHaveBeenCalledTimes(1);
  socket.active = false;
  socket.fire("connect_error", { data: { code: "RATE_LIMITED" } });
  await vi.advanceTimersByTimeAsync(1000);
  expect(socket.connect).toHaveBeenCalledTimes(2);
});

it("invalidates the current session on verified authentication failure", () => {
  stops.push(subscribeToProjectRealtime("o", "p", listener()));
  sockets[0].fire("connect_error", { data: { code: "ACCESS_TOKEN_EXPIRED" } });
  expect(getAccessToken()).toBeNull();
});
