/**
 * TEST FILE — unit
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  DTO transformation + class-validator rules in isolation.
 *         No HTTP server; the global ValidationPipe is exercised end to
 *         end in test/auth/auth.e2e-spec.ts instead.
 * Proves: API.md's exact signup validation constraints.
 */
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { SignUpDto } from "../../src/auth/dto/sign-up.dto";

describe("SignUpDto", () => {
  const validPayload = {
    email: "alice@example.com",
    password: "correct-horse-battery",
    displayName: "Alice",
  };

  it("accepts a valid payload", async () => {
    const dto = plainToInstance(SignUpDto, validPayload);
    expect(await validate(dto)).toHaveLength(0);
  });

  it("trims and lowercases the email", () => {
    const dto = plainToInstance(SignUpDto, {
      ...validPayload,
      email: "  Alice@Example.COM  ",
    });
    expect(dto.email).toBe("alice@example.com");
  });

  it("trims displayName", () => {
    const dto = plainToInstance(SignUpDto, {
      ...validPayload,
      displayName: "   Alice   ",
    });
    expect(dto.displayName).toBe("Alice");
  });

  it("leaves the password exactly as submitted", () => {
    const dto = plainToInstance(SignUpDto, {
      ...validPayload,
      password: "  spaced password  ",
    });
    expect(dto.password).toBe("  spaced password  ");
  });

  it("rejects an invalid email", async () => {
    const dto = plainToInstance(SignUpDto, { ...validPayload, email: "not-an-email" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "email")).toBe(true);
  });

  it("rejects an email longer than 254 characters", async () => {
    const longLocalPart = "a".repeat(250);
    const dto = plainToInstance(SignUpDto, {
      ...validPayload,
      email: `${longLocalPart}@example.com`,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "email")).toBe(true);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const dto = plainToInstance(SignUpDto, { ...validPayload, password: "short" });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });

  it("rejects a password longer than 128 characters", async () => {
    const dto = plainToInstance(SignUpDto, {
      ...validPayload,
      password: "a".repeat(129),
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });

  it("rejects a blank displayName", async () => {
    const dto = plainToInstance(SignUpDto, { ...validPayload, displayName: "   " });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "displayName")).toBe(true);
  });
});