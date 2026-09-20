import { Injectable } from "@nestjs/common";
import { User } from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";

/**
 * User persistence, owned exclusively by the `users` module.
 *
 * Per SPRINT_1_ARCHITECTURE.md's module boundary table, `users` owns
 * "User persistence operations and safe-user mapping" and does NOT own
 * tokens, hashing, or organization roles — those stay in `auth`.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Looks up a user by an ALREADY-NORMALIZED email.
   *
   * This service deliberately does not trim/lowercase itself, so
   * normalization lives in exactly one place (the DTOs' @Transform). 
   * If two layers both normalized, a future change to one
   * could silently diverge from the other.
   */
  findByEmail(normalizedEmail: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: normalizedEmail } });
  }

  /** Resolves the full user record from a JWT `sub` claim (used by /auth/me). */
  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Creates the user row. `passwordHash` must ALREADY be hashed by the
   * caller (auth.service.ts) — this service never sees or
   * handles a plaintext password.
   */
  create(data: {
    email: string;
    passwordHash: string;
    displayName: string;
  }): Promise<User> {
    return this.prisma.user.create({ data });
  }
}