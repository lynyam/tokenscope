/**
 * TEST FILE — unit
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  AuthService with mocked UsersService and TokenService.
 *         Real argon2 is used (not mocked) so the hashing assertions
 *         actually prove something.
 * Proves: SECURITY.md "Password storage" and "Credential privacy".
 */
import { Test, TestingModule } from "@nestjs/testing";
import { HttpStatus } from "@nestjs/common";
import { AuthService } from "../../src/auth/auth.service";
import { UsersService } from "../../src/users/users.service";
import { TokenService } from "../../src/auth/token.service";
import { ApiException } from "../../src/common/errors/api.exception";
import argon2 = require("argon2");

import { Prisma } from "../../src/generated/prisma/client";

describe("AuthService", () => {
  let authService: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let tokenService: jest.Mocked<TokenService>;

  const signUpDto = {
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  } as never;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: { findByEmail: jest.fn(), findById: jest.fn(), create: jest.fn() },
        },
        { provide: TokenService, useValue: { signAccessToken: jest.fn() } },
      ],
    }).compile();

    authService = module.get(AuthService);
    usersService = module.get(UsersService);
    tokenService = module.get(TokenService);

    tokenService.signAccessToken.mockReturnValue({
      accessToken: "fake.jwt.token",
      expiresIn: 3600,
    });
  });

  describe("signUp", () => {
    it("returns an AuthResponse matching API.md's shape", async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({
        id: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
        passwordHash: "$argon2id$hash",
      } as never);

      const result = await authService.signUp(signUpDto);

      expect(result).toEqual({
        user: { id: "user-1", email: "alice@example.com", displayName: "Alice" },
        accessToken: "fake.jwt.token",
        tokenType: "Bearer",
        expiresIn: 3600,
      });
    });

    it("stores a real Argon2id hash, never the plaintext password", async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockImplementation(
        async (data) => ({ id: "user-1", ...data }) as never,
      );

      await authService.signUp(signUpDto);

      const created = usersService.create.mock.calls[0][0];
      expect(created.passwordHash).not.toBe("correct-horse-battery");
      expect(created.passwordHash).toContain("$argon2id$");
      expect(await argon2.verify(created.passwordHash, "correct-horse-battery")).toBe(true);
    });

    it("never returns passwordHash", async () => {
      usersService.findByEmail.mockResolvedValue(null);
      usersService.create.mockResolvedValue({
        id: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
        passwordHash: "$argon2id$secret",
      } as never);

      const result = await authService.signUp(signUpDto);

      expect(JSON.stringify(result)).not.toContain("passwordHash");
      expect(JSON.stringify(result)).not.toContain("$argon2id$secret");
    });

    it("throws ApiException(409, EMAIL_ALREADY_EXISTS) when the email is taken", async () => {
      usersService.findByEmail.mockResolvedValue({ id: "existing" } as never);

      const error = await authService.signUp(signUpDto).catch((err) => err);

      expect(error).toBeInstanceOf(ApiException);
      expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
      expect(error.code).toBe("EMAIL_ALREADY_EXISTS");
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe("signIn", () => {
    async function mockExistingUser(plaintext: string) {
      const passwordHash = await argon2.hash(plaintext, { type: argon2.argon2id });
      usersService.findByEmail.mockResolvedValue({
        id: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
        passwordHash,
      } as never);
    }

    it("returns an AuthResponse for correct credentials", async () => {
      await mockExistingUser("correct-horse-battery");

      const result = await authService.signIn({
        email: "alice@example.com",
        password: "correct-horse-battery",
      } as never);

      expect(result.user.email).toBe("alice@example.com");
      expect(result.accessToken).toBe("fake.jwt.token");
    });

    it("produces an IDENTICAL ApiException for an unknown email and a wrong password", async () => {
      // Case 1 — unknown email
      usersService.findByEmail.mockResolvedValue(null);
      const unknownEmailError = await authService
        .signIn({ email: "ghost@example.com", password: "whatever" } as never)
        .catch((err) => err);

      // Case 2 — known email, wrong password
      await mockExistingUser("correct-horse-battery");
      const wrongPasswordError = await authService
        .signIn({ email: "alice@example.com", password: "wrong-password" } as never)
        .catch((err) => err);

      expect(unknownEmailError).toBeInstanceOf(ApiException);
      expect(wrongPasswordError).toBeInstanceOf(ApiException);
      expect(unknownEmailError.getStatus()).toBe(wrongPasswordError.getStatus());
      expect(unknownEmailError.code).toBe(wrongPasswordError.code);
      expect(unknownEmailError.publicMessage).toBe(wrongPasswordError.publicMessage);
      expect(unknownEmailError.code).toBe("INVALID_CREDENTIALS");
      expect(unknownEmailError.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    });

    it("does not issue a token on failed sign-in", async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await authService
        .signIn({ email: "ghost@example.com", password: "x" } as never)
        .catch(() => undefined);

      expect(tokenService.signAccessToken).not.toHaveBeenCalled();
    });
  });

  describe("getCurrentUser", () => {
    it("returns the SafeUser for an existing id", async () => {
      usersService.findById.mockResolvedValue({
        id: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
        passwordHash: "$argon2id$hash",
      } as never);

      await expect(authService.getCurrentUser("user-1")).resolves.toEqual({
        id: "user-1",
        email: "alice@example.com",
        displayName: "Alice",
      });
    });

    it("throws ApiException(401, AUTHENTICATION_REQUIRED) when the token's user no longer exists", async () => {
      usersService.findById.mockResolvedValue(null);

      const error = await authService.getCurrentUser("ghost").catch((err) => err);

      expect(error).toBeInstanceOf(ApiException);
      expect(error.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  it.each([
    { modelName: "User", target: ["email"] },
    { modelName: "User", target: "User_email_key" },
    {
      modelName: "User",
      driverAdapterError: {
        cause: {
          kind: "UniqueConstraintViolation",
          constraint: { fields: ["email"] },
        },
      },
    },
  ])("maps a raced database email conflict to 409", async meta => {
    // Simulate a request that passed the preliminary lookup but lost the insert.
    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError(
        "PRIVATE_DATABASE_DETAIL",
        { code: "P2002", clientVersion: "7.9.1", meta },
      ),
    );

    const error = await authService.signUp(signUpDto).catch(error => error);

    expect(error).toBeInstanceOf(ApiException);
    expect(error.getStatus()).toBe(409);
    expect(error.code).toBe("EMAIL_ALREADY_EXISTS");
    expect(error.publicMessage).toBe(
      "An account with this email already exists.",
    );
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });

  it("preserves unexpected persistence errors", async () => {
    // An ID conflict is not an email conflict.
    const error = new Prisma.PrismaClientKnownRequestError(
      "PRIVATE_DATABASE_DETAIL",
      {
        code: "P2002",
        clientVersion: "7.9.1",
        meta: { modelName: "User", target: ["id"] },
      },
    );

    usersService.findByEmail.mockResolvedValue(null);
    usersService.create.mockRejectedValue(error);

    await expect(authService.signUp(signUpDto)).rejects.toBe(error);
    expect(tokenService.signAccessToken).not.toHaveBeenCalled();
  });

  it("performs Argon2 verification for an unknown email", async () => {
    usersService.findByEmail.mockResolvedValue(null);

    // Observe the real verification call; do not replace its implementation.
    const verify = jest.spyOn(argon2, "verify");

    try {
      await expect(
        authService.signIn({
          email: "ghost@example.com",
          password: "incorrect",
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

      expect(verify).toHaveBeenCalledTimes(1);

      const [hash, password] = verify.mock.calls[0];
      expect(hash.startsWith("$argon2id$v=19$")).toBe(true);

      // Parameter ordering in the encoded hash is not significant.
      expect(hash.split("$")[3].split(",").sort()).toEqual([
        "m=65536",
        "p=4",
        "t=3",
      ]);

      expect(password).toBe("incorrect");
    } finally {
      verify.mockRestore();
    }
  });
});
