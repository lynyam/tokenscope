/**
 * TEST FILE — unit
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  JwtAuthGuard logic against a hand-built ExecutionContext.
 *         Proves the guard's DECISIONS. That the guard is actually
 *         APPLIED app-wide is proved in test/auth/auth.e2e-spec.ts (STEP 11).
 * Proves: SECURITY.md "Authentication" — missing, malformed, expired
 *         and incorrectly signed tokens all return 401.
 */
import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtAuthGuard } from "../../src/auth/guards/jwt-auth.guard";
import { TokenService } from "../../src/auth/token.service";
import { ApiException } from "../../src/common/errors/api.exception";

function buildContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

function codeOf(error: unknown): string {
  return (error as ApiException).code;
}

/** Runs fn and returns whatever it threw. */
function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected the function to throw, but it did not.");
}

describe("JwtAuthGuard", () => {
  let guard: JwtAuthGuard;
  let tokenService: jest.Mocked<TokenService>;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    tokenService = { verifyAccessToken: jest.fn() } as never;
    reflector = { getAllAndOverride: jest.fn() } as never;
    guard = new JwtAuthGuard(tokenService, reflector);
  });

  it("allows a @Public() route through without any token", () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    expect(guard.canActivate(buildContext({ headers: {} }))).toBe(true);
    expect(tokenService.verifyAccessToken).not.toHaveBeenCalled();
  });

  describe("on a protected route", () => {
    beforeEach(() => reflector.getAllAndOverride.mockReturnValue(false));

    it("throws AUTHENTICATION_REQUIRED when the header is missing", () => {
      const context = buildContext({ headers: {} });
      const error = catchError(() => guard.canActivate(context));

      expect(error).toBeInstanceOf(ApiException);
      expect(codeOf(error)).toBe("AUTHENTICATION_REQUIRED");
    });

    it("throws AUTHENTICATION_REQUIRED for a non-Bearer scheme", () => {
      const context = buildContext({ headers: { authorization: "Basic abc123" } });
      expect(codeOf(catchError(() => guard.canActivate(context)))).toBe(
        "AUTHENTICATION_REQUIRED",
      );
    });

    it("throws ACCESS_TOKEN_EXPIRED for an expired token", () => {
      const expired = Object.assign(new Error("jwt expired"), {
        name: "TokenExpiredError",
      });
      tokenService.verifyAccessToken.mockImplementation(() => {
        throw expired;
      });

      const context = buildContext({ headers: { authorization: "Bearer expired" } });
      expect(codeOf(catchError(() => guard.canActivate(context)))).toBe(
        "ACCESS_TOKEN_EXPIRED",
      );
    });

    it("throws INVALID_ACCESS_TOKEN for a bad signature", () => {
      tokenService.verifyAccessToken.mockImplementation(() => {
        throw Object.assign(new Error("invalid signature"), {
          name: "JsonWebTokenError",
        });
      });

      const context = buildContext({ headers: { authorization: "Bearer forged" } });
      expect(codeOf(catchError(() => guard.canActivate(context)))).toBe(
        "INVALID_ACCESS_TOKEN",
      );
    });

    it("never leaks the underlying jwt error message", () => {
      tokenService.verifyAccessToken.mockImplementation(() => {
        throw new Error("secret internal detail");
      });

      const context = buildContext({ headers: { authorization: "Bearer x" } });
      const error = catchError(() => guard.canActivate(context)) as ApiException;

      expect(error.publicMessage).not.toContain("secret internal detail");
    });

    it("attaches ONLY { id } to request.user on success", () => {
      tokenService.verifyAccessToken.mockReturnValue({
        sub: "user-123",
        iss: "tokenscope",
        aud: "tokenscope-web",
      } as never);

      const request: Record<string, unknown> = {
        headers: { authorization: "Bearer valid" },
      };

      expect(guard.canActivate(buildContext(request))).toBe(true);
      expect(request.user).toEqual({ id: "user-123" });
    });
  });
});