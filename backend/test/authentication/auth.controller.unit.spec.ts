/**
 * TEST FILE — unit
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  Controller delegation only, with AuthService mocked.
 *         HTTP status codes and validation are proved in
 *         test/auth/auth.e2e-spec.ts (STEP 11) against the real app.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { AuthController } from "../../src/auth/auth.controller";
import { AuthService } from "../../src/auth/auth.service";

describe("AuthController", () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            signUp: jest.fn(),
            signIn: jest.fn(),
            getCurrentUser: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(AuthController);
    authService = module.get(AuthService);
  });

  it("signUp passes the DTO straight to AuthService", async () => {
    const dto = {
      email: "alice@example.com",
      password: "correct-horse-battery",
      displayName: "Alice",
    } as never;
    authService.signUp.mockResolvedValue("auth-response" as never);

    await expect(controller.signUp(dto)).resolves.toBe("auth-response");
    expect(authService.signUp).toHaveBeenCalledWith(dto);
  });

  it("signIn passes the DTO straight to AuthService", async () => {
    const dto = { email: "alice@example.com", password: "x" } as never;
    authService.signIn.mockResolvedValue("auth-response" as never);

    await expect(controller.signIn(dto)).resolves.toBe("auth-response");
    expect(authService.signIn).toHaveBeenCalledWith(dto);
  });

  it("getCurrentUser uses the id from the guard-supplied user, not request input", async () => {
    authService.getCurrentUser.mockResolvedValue("safe-user" as never);

    await expect(controller.getCurrentUser({ id: "user-1" })).resolves.toBe("safe-user");
    expect(authService.getCurrentUser).toHaveBeenCalledWith("user-1");
  });
});