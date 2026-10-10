import { DEFAULT_LLM_MODEL, validateEnvironment } from "../../src/config/env.validation";

const VALID_ENV = {
  BACKEND_PORT: "3000",
  DATABASE_URL: "postgresql://test_user:test_password@postgres-test:5432/tokenscope_test",
  JWT_SECRET: "test-only-not-for-production-1234567890",
  JWT_ISSUER: "tokenscope-test",
  JWT_AUDIENCE: "tokenscope-test-web",
  JWT_ACCESS_TTL_SECONDS: "3600",
};

describe("Environment configuration", () => {
  it("returns typed configuration for valid input", () => {
    expect(validateEnvironment({ ...VALID_ENV })).toEqual({
      ...VALID_ENV,
      BACKEND_PORT: 3000,
      JWT_ACCESS_TTL_SECONDS: 3600,
      // Assistant settings are optional: absent → disabled key, default model.
      GEMINI_API_KEY: null,
      LLM_MODEL: DEFAULT_LLM_MODEL,
    });
  });

  it.each(Object.keys(VALID_ENV))("rejects a missing %s", (key) => {
    const env: Record<string, unknown> = { ...VALID_ENV };
    delete env[key];
    expect(() => validateEnvironment(env)).toThrow(key);
  });

  it.each(["0", "65536", "-1", "3000.5", "abc", "3e3", ""])(
    "rejects invalid port %j", (port) => {
      expect(() => validateEnvironment({ ...VALID_ENV, BACKEND_PORT: port }))
        .toThrow("BACKEND_PORT");
    },
  );

  it.each(["1", "65535"])("accepts port boundary %s", (port) => {
    expect(validateEnvironment({ ...VALID_ENV, BACKEND_PORT: port }).BACKEND_PORT)
      .toBe(Number(port));
  });

  it.each(["0", "-1", "1.5", "1h", "9007199254740992"])(
    "rejects invalid JWT lifetime %j", (ttl) => {
      expect(() => validateEnvironment({ ...VALID_ENV, JWT_ACCESS_TTL_SECONDS: ttl }))
        .toThrow("JWT_ACCESS_TTL_SECONDS");
    },
  );

  it.each([
    "not-a-url",
    "https://postgres-test/tokenscope_test",
    "postgresql://postgres-test/",
    "postgresql://postgres-test/tokenscope_test#fragment",
    " postgresql://postgres-test/tokenscope_test ",
  ])("rejects invalid database URL %j", (url) => {
    expect(() => validateEnvironment({ ...VALID_ENV, DATABASE_URL: url }))
      .toThrow("DATABASE_URL");
  });

  it.each([
    { label: "short", value: "too-short" },
    { label: "blank", value: "   " },
    { label: "repeated character", value: "a".repeat(64) },
    { label: "placeholder", value: "change-me-before-use-12345678901234567890" },
    { label: "whitespace", value: "test-only-secret-with whitespace-1234567890" },
  ])("rejects a $label JWT secret", ({ value }) => {
    expect(() => validateEnvironment({ ...VALID_ENV, JWT_SECRET: value }))
      .toThrow("JWT_SECRET");
  });

  it.each(["JWT_ISSUER", "JWT_AUDIENCE"])("rejects a blank %s", (key) => {
    expect(() => validateEnvironment({ ...VALID_ENV, [key]: "   " })).toThrow(key);
  });

  it.each([
    { key: "DATABASE_URL", value: "https://user:DO_NOT_EXPOSE_CONFIG_VALUE@host/database" },
    { key: "JWT_SECRET", value: "DO_NOT_EXPOSE_CONFIG_VALUE" },
  ])("does not expose the rejected $key value", ({ key, value }) => {
    let caught: unknown;
    try { validateEnvironment({ ...VALID_ENV, [key]: value }); }
    catch (error) { caught = error; }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(key);
    expect((caught as Error).message).not.toContain(value);
    expect((caught as Error).message).not.toContain("DO_NOT_EXPOSE_CONFIG_VALUE");
  });
});

describe("Assistant configuration (TSE-80)", () => {
  it("starts without a Gemini key: assistant disabled", () => {
    expect(validateEnvironment({ ...VALID_ENV }).GEMINI_API_KEY).toBeNull();
  });

  // Each row: a malformed key that must disable the assistant, never crash startup.
  it.each([["  "], ['"AIzaFakeKey123"'], ["AIza Fake"], [123]])(
    "treats %p as an absent key, without failing startup",
    (value) => {
      expect(validateEnvironment({ ...VALID_ENV, GEMINI_API_KEY: value }).GEMINI_API_KEY).toBeNull();
    },
  );

  // Both key formats issued by Google AI Studio (fake values only).
  it.each(["AIzaFakeKey123", "AQ.FakeKey-123_abc"])("keeps a well-formed key %p", (key) => {
    expect(validateEnvironment({ ...VALID_ENV, GEMINI_API_KEY: key }).GEMINI_API_KEY).toBe(key);
  });

  it("trims surrounding whitespace from a valid key", () => {
    expect(validateEnvironment({ ...VALID_ENV, GEMINI_API_KEY: "  AIzaFakeKey123  " }).GEMINI_API_KEY)
      .toBe("AIzaFakeKey123");
  });

  it("defaults the model when absent or empty", () => {
    expect(validateEnvironment({ ...VALID_ENV }).LLM_MODEL).toBe(DEFAULT_LLM_MODEL);
    expect(validateEnvironment({ ...VALID_ENV, LLM_MODEL: "" }).LLM_MODEL).toBe(DEFAULT_LLM_MODEL);
  });

  it("keeps a valid configured model", () => {
    expect(validateEnvironment({ ...VALID_ENV, LLM_MODEL: "gemini-2.5-flash" }).LLM_MODEL)
      .toBe("gemini-2.5-flash");
  });

  it("disables the assistant on a malformed model name", () => {
    expect(validateEnvironment({ ...VALID_ENV, LLM_MODEL: "bad model!" }).LLM_MODEL).toBeNull();
  });
});