import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthenticatedUser } from "../types/authenticated-user";

/**
 * Reusable parameter decorator.
 *
 * Lets a controller write `@CurrentUser() user: AuthenticatedUser`
 * instead of manually reaching into the raw request object each time.
 *
 * Only meaningful on a route protected by JwtAuthGuard, since it reads
 * `request.user`, which the guard is what actually populates. On a
 * @Public() route this would be undefined.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);