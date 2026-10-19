import { io, type Socket, type ManagerOptions, type SocketOptions } from "socket.io-client";
import type { RealtimeAck } from "../../src/realtime/realtime.types";

export const TEST_ORIGIN = "http://localhost:5173";
export function client(url: string, token?: string, options: Partial<ManagerOptions & SocketOptions> = {}): Socket {
  return io(`${url}/realtime`, {
    path: "/socket.io", autoConnect: false, forceNew: true, reconnection: false,
    timeout: 2500, auth: token === undefined ? {} : { token },
    extraHeaders: { Origin: TEST_ORIGIN }, ...options,
  });
}
export function event<T = unknown>(socket: Socket, name: string, timeout = 4000): Promise<T> {
  const promise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, receive); reject(new Error(`Missing event: ${name}`)); }, timeout);
    function receive(value: T) { clearTimeout(timer); resolve(value); }
    socket.once(name, receive);
  });
  // If another assertion fails first, this timer must not create an unhandled rejection.
  void promise.catch(() => {});
  return promise;
}
export async function connected(socket: Socket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const success = () => { socket.off("connect_error", failure); resolve(); };
    const failure = (error: Error) => { socket.off("connect", success); reject(error); };
    socket.once("connect", success).once("connect_error", failure).connect();
  });
}
export const subscribe = (socket: Socket, organizationId: string, projectId: string): Promise<RealtimeAck> =>
  socket.timeout(3000).emitWithAck("project.subscribe", { organizationId, projectId });
export const settleWindow = () => new Promise<void>(resolve => setTimeout(resolve, 350));
