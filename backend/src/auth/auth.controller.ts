/**
 * Purpose: HTTP entry point for all three endpoints: [POST /signup, POST /signin, GET /me]
 *          Translates HTTP requests into calls to auth.service.ts
 * 3 Route handler methods: (signup, signin, getMe: @Post(), @Get())
 * 
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { AuthService, AuthResponse } from "./auth.service";
import { SignUpDto } from "./dto/sign-up.dto";
import { SignInDto } from "./dto/sign-in.dto";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { AuthenticatedUser } from "../common/types/authenticated-user";
import { SafeUser } from "../users/user.mapper";

/**
 * STEP 9 — HTTP entry point for auth.
 *
 * Base path "auth". The /api/v1 prefix is applied globally by
 * configure-app.ts (already built), so the final routes are
 * /api/v1/auth/signup, /api/v1/auth/signin, /api/v1/auth/me.
 *
 * Per dependency rule #1, this controller only delegates: it never calls
 * Prisma, never hashes, never decides authorization itself.
 */
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** API.md: 201 Created — NestJS's default status for @Post. */
  @Public()
  @Post("signup")
  signUp(@Body() dto: SignUpDto): Promise<AuthResponse> {
    return this.authService.signUp(dto);
  }

  /**
   * API.md specifies 200 OK for sign-in, not 201. Without this explicit
   * @HttpCode, NestJS would return 201 for this @Post and silently break
   * the documented contract.
   */
  @Public()
  @Post("signin")
  @HttpCode(HttpStatus.OK)
  signIn(@Body() dto: SignInDto): Promise<AuthResponse> {
    return this.authService.signIn(dto);
  }

  /**
   * No @Public(), so the global JwtAuthGuard protects this route.
   * @CurrentUser() reads the identity the guard already verified and
   * attached — the client cannot influence which user is returned.
   */
  @Get("me")
  getCurrentUser(@CurrentUser() user: AuthenticatedUser): Promise<SafeUser> {
    return this.authService.getCurrentUser(user.id);
  }
}