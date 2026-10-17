import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { isUUID } from "class-validator";
import { ApiException } from "../errors/api.exception";
import { RateLimitService } from "./rate-limit.service";

type AuthenticatedRequest = Request & {
  user: { id: string };
};

@Injectable()
export class ProjectReadLimitInterceptor implements NestInterceptor {
  constructor(private readonly limits: RateLimitService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const projectId = request.params.projectId;

    // Let the UUID parameter pipe produce the normal validation error.
    if (typeof projectId !== "string" || !isUUID(projectId, "all")) {
      return next.handle();
    }

    const decision = this.limits.consume(
      "browser-project-reads",
      `${request.user.id}:${projectId}`,
      60,
    );

    if (decision.allowed === false) {
      response.setHeader(
        "Retry-After",
        String(decision.retryAfterSeconds),
      );

      throw new ApiException(
        429,
        "RATE_LIMITED",
        "Too many requests. Please try again later.",
      );
    }

    return next.handle();
  }
}