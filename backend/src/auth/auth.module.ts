/**
 * Purpose: wires together everything auth-related into one NestJS module
 *  - declares the controller
 *  - registers the services as providers
 *  - imports UsersModule
 *  - configures JwtModule
 */

import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { TokenService } from "./token.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { UsersModule } from "../users/users.module";
import type { EnvironmentVariables } from "../config/env.validation";

/**
 * STEP 9 — wires the whole auth feature together.
 */
@Module({
  imports: [
    // Dependency rule #6: Auth → Users, never the reverse.
    UsersModule,

    // registerAsync so the secret/issuer/audience come from validated
    // environment configuration, never hardcoded (SECURITY.md).
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables>) => ({
        secret: config.getOrThrow("JWT_SECRET", { infer: true }),
        signOptions: {
          algorithm: "HS256",
          issuer: config.getOrThrow("JWT_ISSUER", { infer: true }),
          audience: config.getOrThrow("JWT_AUDIENCE", { infer: true }),
        },
        // verifyOptions must mirror signOptions — otherwise issuer and
        // audience would be signed into tokens but never actually
        // checked. SECURITY.md requires verifying both.
        verifyOptions: {
          algorithms: ["HS256"],
          issuer: config.getOrThrow("JWT_ISSUER", { infer: true }),
          audience: config.getOrThrow("JWT_AUDIENCE", { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    {
      // APP_GUARD applies JwtAuthGuard to EVERY route in the whole
      // application, not just this module's own controller. Future
      // modules (organizations, memberships, projects) inherit
      // protection automatically and never need @UseGuards themselves.
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  // Exported in case a later module ever needs to verify a token directly.
  exports: [TokenService],
})
export class AuthModule {}
