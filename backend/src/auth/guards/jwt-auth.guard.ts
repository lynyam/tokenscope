/**
 * Purpose: intercepts every incoming request (except ones marked @Public()),
            verifies the JWT and either:
            + lets the request through
            + rejects it with the correct one of three distinct 401 error codes
 */

import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiException } from "../../common/errors/api.exception";
import { TokenService } from "../token.service";
import { IS_PUBLIC_KEY } from "../../common/decorators/public.decorator";

/**
 * Registered globally via APP_GUARD in auth.module.ts,
 * so EVERY route in the application is protected by default, and
 * @Public() is the explicit, auditable opt-out. This is safer than
 * opting in per controller, where a forgotten @UseGuards would silently
 * leave an endpoint unauthenticated.
 *
 * Runs at the position SPRINT_1_ARCHITECTURE.md's lifecycle describes:
 * request-ID middleware → route selection → JWT guard → ValidationPipe.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // getAllAndOverride checks the handler first, then the controller
    // class, so @Public() works whether applied to a method or a whole
    // controller.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers["authorization"];

    // API.md case 1: header absent or not in "Bearer <token>" form.
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTHENTICATION_REQUIRED",
        "Authentication is required.",
      );
    }

    const token = authHeader.slice("Bearer ".length).trim();

    try {
      const payload = this.tokenService.verifyAccessToken(token);

      // Attach ONLY the verified identity. SPRINT_1_ARCHITECTURE.md:
      // "the JWT guard authenticates and attaches only the trusted user
      // identity". Anything else in the payload is untrusted input.
      request.user = { id: payload.sub };
      return true;
    } catch (error) {
      // API.md case 2: expired. Distinguished from other failures
      // because the frontend can react to it by clearing its session.
      if ((error as Error)?.name === "TokenExpiredError") {
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          "ACCESS_TOKEN_EXPIRED",
          "Your session has expired.",
        );
      }

      // API.md case 3: malformed, wrong signature, wrong issuer/audience.
      // One generic code for all of them — distinguishing "bad
      // signature" from "wrong audience" would help an attacker probe
      // the token format. The raw error is never surfaced.
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "INVALID_ACCESS_TOKEN",
        "The provided access token is invalid.",
      );
    }
  }
}