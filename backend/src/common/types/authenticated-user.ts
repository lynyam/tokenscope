/**
 * Shared identity type.
 *
 * The minimal shape attached to `request.user` by JwtAuthGuard once a
 * token has been verified.
 *
 * Deliberately contains ONLY the user id. Per SECURITY.md, organization
 * roles must never be embedded here or in the JWT itself, because roles
 * are organization-scoped and can change while a token is still valid.
 * Roles are always read fresh from the database by the memberships
 * access services, never trusted from a token payload.
 */

export interface AuthenticatedUser {
  id: string;
}