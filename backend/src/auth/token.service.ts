import { Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";

export interface IssuedToken {
  accessToken: string;
  expiresIn: number;
}

/**
 * JWT: string made of three base64url-encoded parts, joined by dots:
 * e.g. eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.4f8a
 * 
 */

/**
 * The only place in the backend that signs or verifies a JWT.
 *
 * Centralizing this means there is exactly one implementation to audit
 * against SECURITY.md's token requirements, and one place to change if
 * the algorithm or claim set ever changes.
 */
@Injectable()
export class TokenService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvironmentVariables>,
  ) {
    // TTL comes from JWT_ACCESS_TTL_SECONDS (validated at startup by
    // config/env.validation.ts, per LOCAL_DEVELOPMENT.md). getOrThrow
    // means a missing value fails fast instead of silently defaulting.
    this.ttlSeconds = Number(
      this.configService.getOrThrow("JWT_ACCESS_TTL_SECONDS", { infer: true }),
    );
  }

  /**
   * Issues an access token whose payload contains ONLY `sub`.
   *
   * SECURITY.md: "include a stable user ID as sub; do not include
   * organization roles or permissions" — roles are organization-scoped
   * and can change while a token remains valid, so they are always read
   * fresh from the database rather than trusted from a token.
   *
   * issuer and audience are applied automatically by JwtModule's
   * signOptions (see auth.module.ts, STEP 9).
   */
  signAccessToken(userId: string): IssuedToken {
    const accessToken = this.jwtService.sign(
      { sub: userId },
      { expiresIn: this.ttlSeconds },
    );
    return { accessToken, expiresIn: this.ttlSeconds };
  }

  /**
   * Verifies signature, expiration, issuer and audience (issuer/audience
   * come from JwtModule's verifyOptions, STEP 9).
   *
   * Throws on any failure. JwtAuthGuard (STEP 8) is responsible for
   * catching the error and mapping it to the correct API.md 401 code —
   * this service deliberately knows nothing about HTTP status codes.
   */
  verifyAccessToken(token: string): { sub: string } {
    return this.jwtService.verify(token);
  }
}