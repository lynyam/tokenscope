import { HttpStatus, Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import { ApiException } from "../common/errors/api.exception";
import { UsersService } from "../users/users.service";
import { TokenService } from "./token.service";
import { toSafeUser, SafeUser } from "../users/user.mapper";
import { SignUpDto } from "./dto/sign-up.dto";
import { SignInDto } from "./dto/sign-in.dto";
import { Prisma, type User } from "../generated/prisma/client";

/** The exact AuthResponse shape documented in API.md. */
export interface AuthResponse {
  user: SafeUser;
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}
// This is a valid verifier for a discarded random value.
// It is never assigned to an account.
//
// Unknown emails still perform Argon2 verification, avoiding the obvious
// fast-failure path that previously distinguished them from existing users.
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$PWGbYr6/w10JvKMxTGqBKQ$btxj8qjva5iUElvooJpfp3AwOe0uZNS8kxSpJLpIdRo";

  // Configure password hashing in this auth-owned provider.
// These costs match the dummy verifier above.
const PASSWORD_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;
/**
 * Orchestrates sign-up / sign-in / current-user.
 *
 * This is the single auth-owned provider that configures password
 * hashing (SECURITY.md: "Configure hashing in one auth-owned provider,
 * not separately in controllers"). No other file in the backend calls
 * argon2 directly.
 *
 * Every failure is thrown as an ApiException(status, code, message).
 * This project's global exception filter (common/filters/
 * api-exception.filter.ts) catches ApiException app-wide and turns it
 * into API.md's documented JSON error envelope — this service never
 * builds that JSON itself.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * SPRINT_1_ARCHITECTURE.md sign-up flow:
   * validate → normalize email → hash with Argon2id → create User
   * → map duplicate email to 409 → issue token → return safe user + token
   */
  async signUp(dto: SignUpDto): Promise<AuthResponse> {
    // dto.email is already trimmed + lowercased by SignUpDto's @Transform.
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) {
      throw this.emailAlreadyExists();
    }

    // argon2id specifically — NOT argon2i or argon2d. The `id` variant
    // resists both GPU brute force and side-channel attacks, and is
    // exactly what SECURITY.md and this ticket require.
    const passwordHash = await argon2.hash(dto.password, PASSWORD_OPTIONS,
    );
    let user: User;

    try {
      user = await this.usersService.create({
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
      });
    } catch (error) {
      // Two requests may both pass the lookup above before either inserts.
      // PostgreSQL's unique constraint is the final authority.
      if (this.isEmailConflict(error)) {
        throw this.emailAlreadyExists();
      }

      // Preserve unrelated failures so the shared filter returns a safe 500.
      // Do not mislabel every database error as a duplicate email.
      throw error;
    }

    // After this line the plaintext password is never referenced again:
    // never logged, never persisted, never returned.
    const { accessToken, expiresIn } = this.tokenService.signAccessToken(user.id);

    return { user: toSafeUser(user), accessToken, tokenType: "Bearer", expiresIn };
  }

  /**
   * SPRINT_1_ARCHITECTURE.md sign-in flow, with one structural rule that
   * matters more than it looks:
   *
   * `passwordMatches` is computed UNCONDITIONALLY, outside any early
   * return. Both failure causes (no such user / wrong password) then
   * fall through to ONE throw, producing byte-identical 401 responses.
   * Separate early returns would let an attacker enumerate which emails
   * have accounts (SECURITY.md "Credential privacy").
   */
  async signIn(dto: SignInDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(dto.email);

    // Both existing and unknown accounts perform password verification.
    // This performs comparable expensive work; it does not promise that
    // the entire HTTP request has perfectly identical execution time.
    const passwordMatches = await argon2.verify(
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
      dto.password,
    );

    if (!user || !passwordMatches) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "INVALID_CREDENTIALS",
        "Invalid email or password.",
      );
    }

    const { accessToken, expiresIn } = this.tokenService.signAccessToken(user.id);

    return { user: toSafeUser(user), accessToken, tokenType: "Bearer", expiresIn };
  }

  /**
   * Backs GET /auth/me. The userId arrives from JwtAuthGuard's verified
   * `sub` claim (via @CurrentUser()), never from request input.
   */
  async getCurrentUser(userId: string): Promise<SafeUser> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      // A cryptographically valid token whose user no longer exists.
      // Treated as unauthenticated rather than leaking that distinction.
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        "AUTHENTICATION_REQUIRED",
        "Authentication is required.",
      );
    }
    return toSafeUser(user);
  }
  private emailAlreadyExists(): ApiException {
    return new ApiException(
      HttpStatus.CONFLICT,
      "EMAIL_ALREADY_EXISTS",
      "An account with this email already exists.",
    );
  }

  private isEmailConflict(error: unknown): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      return false;
    }

    const meta = error.meta as {
      modelName?: string;
      target?: unknown;
      driverAdapterError?: {
        cause?: {
          kind?: string;
          constraint?: { fields?: unknown };
        };
      };
    } | undefined;

    if (meta?.modelName && meta.modelName !== "User") {
      return false;
    }

    // Some Prisma versions expose the unique constraint's name.
    if (meta?.target === "User_email_key") {
      return true;
    }

    // Support both Prisma field metadata and the PostgreSQL adapter shape.
    const cause = meta?.driverAdapterError?.cause;
    const fields = Array.isArray(meta?.target)
      ? meta.target
      : cause?.kind === "UniqueConstraintViolation"
        ? cause.constraint?.fields
        : undefined;

    return (
      Array.isArray(fields) &&
      fields.length === 1 &&
      fields[0] === "email"
    );
  }
}
