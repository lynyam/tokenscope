import { User } from "@prisma/client";

/**
 * SafeUser shape documented in API.md.
 * Used as the `user` field of AuthResponse, and as the body of GET /auth/me.
 */

export interface SafeUser {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Raw Prisma User is converted to a public
 * shape.
 *
 * This function is what guarantees `passwordHash` never leaves the
 * backend (DATA_MODEL.md: "The backend must never expose a raw Prisma
 * User object"). Every auth/user/membership response must go through a
 * mapper like this rather than serializing the Prisma entity directly.
 */
export function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}