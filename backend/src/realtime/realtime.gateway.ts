import type { IncomingMessage } from "node:http";
import { ConfigService } from "@nestjs/config";
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from "@nestjs/websockets";
import type { Namespace, Socket } from "socket.io";
import type { EnvironmentVariables } from "../config/env.validation";
import { allowedRealtimeRequest } from "../config/realtime-origins";
import { RealtimeService } from "./realtime.service";
import { rejected, type RealtimeAck } from "./realtime.types";

@WebSocketGateway({
  namespace: "/realtime", path: "/socket.io",
  transports: ["polling", "websocket"], serveClient: false, maxHttpBufferSize: 16_384,
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService<EnvironmentVariables>,
  ) {}

  afterInit(namespace: Namespace): void {
    const origins = this.config.get("REALTIME_ALLOWED_ORIGINS", { infer: true }) ?? [];
    // Engine middleware checks initial polling, subsequent polling and upgrades.
    namespace.server.engine.use((req: IncomingMessage, _res: unknown, next: (error?: Error) => void) => {
      next(allowedRealtimeRequest(req, origins) ? undefined : new Error("Origin not allowed."));
    });
    namespace.use((socket, next) => {
      try { this.realtime.prepare(socket); next(); }
      catch (error) {
        this.realtime.release(socket);
        next(error as Error);
      }
    });
  }

  handleConnection(socket: Socket): void {
    if (!this.realtime.accept(socket)) { socket.disconnect(true); return; }
    // Explicit Socket.IO handlers: HTTP guards/pipes do not validate this protocol.
    // Authentication is above; runtime payload validation is in RealtimeService.
    socket.on("project.subscribe", (...args: unknown[]) => {
      const ack = typeof args.at(-1) === "function" ? args.pop() as (result: RealtimeAck) => void : undefined;
      void this.realtime.subscribe(socket, args.length === 1 ? args[0] : undefined)
        .then(result => ack?.(result))
        .catch(() => ack?.(rejected("INTERNAL_SERVER_ERROR")));
    });
    socket.on("project.unsubscribe", (...args: unknown[]) => {
      const ack = typeof args.at(-1) === "function" ? args.pop() as (result: RealtimeAck) => void : undefined;
      void this.realtime.unsubscribe(socket, args.length === 0)
        .then(result => ack?.(result))
        .catch(() => ack?.(rejected("INTERNAL_SERVER_ERROR")));
    });
  }
}
