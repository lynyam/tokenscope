/**
 * TEST FILE — unit
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  SignInDto transformation + validation in isolation.
 */
import { validate } from "class-validator";
import { plainToInstance } from "class-transformer";
import { SignInDto } from "../../src/auth/dto/sign-in.dto";

describe("SignInDto", () => {
  it("accepts a valid payload", async () => {
    const dto = plainToInstance(SignInDto, {
      email: "alice@example.com",
      password: "correct-horse-battery",
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("normalizes the email identically to SignUpDto", () => {
    const dto = plainToInstance(SignInDto, {
      email: "  Alice@Example.COM  ",
      password: "anything",
    });
    expect(dto.email).toBe("alice@example.com");
  });

  it("does not enforce sign-up's minimum password length", async () => {
    // A short password must produce a generic 401 from the service,
    // not a 400 that reveals the password policy.
    const dto = plainToInstance(SignInDto, {
      email: "alice@example.com",
      password: "x",
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it("rejects an empty password", async () => {
    const dto = plainToInstance(SignInDto, {
      email: "alice@example.com",
      password: "",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "password")).toBe(true);
  });
});