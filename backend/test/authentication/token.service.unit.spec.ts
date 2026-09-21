/**
 * TEST FILE — unit
 * Suite:  npm run test:unit   (config: test/jest-unit.json)
 * Scope:  TokenService against a locally-registered JwtModule with a
 *         fixed test secret. No app bootstrap, no database.
 * Proves: SECURITY.md's JWT claim and verification requirements.
 */
import { Test, TestingModule } from "@nestjs/testing";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { TokenService } from "../../src/auth/token.service";

const TEST_SECRET = "test-secret-at-least-32-characters-long-xxxx";
const TEST_ISSUER = "tokenscope";
const TEST_AUDIENCE = "tokenscope-web";

describe("TokenService", () => {
  let service: TokenService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { issuer: TEST_ISSUER, audience: TEST_AUDIENCE },
          verifyOptions: { issuer: TEST_ISSUER, audience: TEST_AUDIENCE },
        }),
      ],
      providers: [
        TokenService,
        { provide: ConfigService, useValue: { getOrThrow: () => "3600" } },
      ],
    }).compile();

    service = module.get(TokenService);
    jwtService = module.get(JwtService);
  });

  it("issues a token carrying the user id as `sub`", () => {
    const { accessToken } = service.signAccessToken("user-123");
    expect(service.verifyAccessToken(accessToken).sub).toBe("user-123");
  });

  it("reports the configured TTL as expiresIn", () => {
    expect(service.signAccessToken("user-123").expiresIn).toBe(3600);
  });

  it("does not embed roles or permissions in the payload", () => {
    const { accessToken } = service.signAccessToken("user-123");
    const payload = jwtService.decode(accessToken) as Record<string, unknown>;

    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("roles");
    expect(payload).not.toHaveProperty("permissions");
    expect(payload).not.toHaveProperty("organizationId");
  });

  it("sets issuer, audience and expiration claims", () => {
    const { accessToken } = service.signAccessToken("user-123");
    const payload = jwtService.decode(accessToken) as Record<string, unknown>;

    expect(payload.iss).toBe(TEST_ISSUER);
    expect(payload.aud).toBe(TEST_AUDIENCE);
    expect(payload.exp).toEqual(expect.any(Number));
  });

  it("throws on a malformed token", () => {
    expect(() => service.verifyAccessToken("not-a-real-token")).toThrow();
  });

  it("throws TokenExpiredError on an expired token", () => {
    const expired = jwtService.sign({ sub: "user-123" }, { expiresIn: -10 });
    expect(() => service.verifyAccessToken(expired)).toThrow(
      expect.objectContaining({ name: "TokenExpiredError" }),
    );
  });

  it("throws on a token signed with a different secret", () => {
    const foreign = new JwtService({ secret: "a-completely-different-secret-value" });
    const forged = foreign.sign(
      { sub: "user-123" },
      { issuer: TEST_ISSUER, audience: TEST_AUDIENCE },
    );
    expect(() => service.verifyAccessToken(forged)).toThrow();
  });

  it("throws on a token with the wrong audience", () => {
    const wrongAudience = jwtService.sign(
      { sub: "user-123" },
      { issuer: TEST_ISSUER, audience: "some-other-app" },
    );
    expect(() => service.verifyAccessToken(wrongAudience)).toThrow();
  });
});