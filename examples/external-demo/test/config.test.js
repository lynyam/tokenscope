const { loadConfig } = require("../src/config");

function validEnv() {
  return {
    GEMINI_API_KEY: "test-gemini-key",
    LLM_MODEL: "gemini-3.8-flash",
    TOKENSCOPE_BASE_URL: "https://localhost:8443",
    TOKENSCOPE_CHAT_API_KEY: "test-chat-key",
    TOKENSCOPE_TRANSLATION_API_KEY: "test-translation-key"
  };
}

test("loads settings with a local-only host and default port", () => {
  const config = loadConfig(validEnv());

  expect(config).toEqual({
    host: "127.0.0.1",
    port: 8080,
    geminiApiKey: "test-gemini-key",
    model: "gemini-3.8-flash",
    tokenScopeBaseUrl: "https://localhost:8443",
    chatApiKey: "test-chat-key",
    translationApiKey: "test-translation-key"
  });
  expect(Object.isFrozen(config)).toBe(true);
});

test.each(Object.keys(validEnv()))(
  "rejects missing configuration: %s",
  name => {
    const env = validEnv();
    delete env[name];
    expect(() => loadConfig(env)).toThrow(name);
  }
);

test.each(["", "0", "65536", "abc", "8080.5", "-1"])(
  "rejects invalid port: %j",
  PORT => {
    expect(() => loadConfig({ ...validEnv(), PORT })).toThrow("PORT");
  }
);

test("accepts a configured port", () => {
  expect(loadConfig({ ...validEnv(), PORT: "9090" }).port).toBe(9090);
});

test.each([
  "http://example.com",
  "https://user:password@example.com",
  "https://example.com/api/v1",
  "https://example.com?key=secret",
  "https://example.com#fragment",
  "not-a-url"
])("rejects unsuitable TokenScope URL: %s", TOKENSCOPE_BASE_URL => {
  expect(() => loadConfig({
    ...validEnv(), TOKENSCOPE_BASE_URL
  })).toThrow("TOKENSCOPE_BASE_URL");
});

test.each([
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "http://[::1]:8081",
  "https://example.com"
])("accepts supported TokenScope origin: %s", TOKENSCOPE_BASE_URL => {
  expect(loadConfig({
    ...validEnv(), TOKENSCOPE_BASE_URL
  }).tokenScopeBaseUrl).toBe(TOKENSCOPE_BASE_URL);
});

test("rejects identical workflow keys", () => {
  const env = validEnv();
  env.TOKENSCOPE_TRANSLATION_API_KEY = env.TOKENSCOPE_CHAT_API_KEY;
  expect(() => loadConfig(env)).toThrow("different TokenScope keys");
});

test("rejects disabled TLS verification", () => {
  expect(() => loadConfig({
    ...validEnv(),
    NODE_TLS_REJECT_UNAUTHORIZED: "0"
  })).toThrow("TLS certificate verification");
});

test.each([
  "GEMINI_API_KEY",
  "TOKENSCOPE_CHAT_API_KEY",
  "TOKENSCOPE_TRANSLATION_API_KEY"
])("rejects whitespace in %s without revealing its value", name => {
  const env = { ...validEnv(), [name]: "PRIVATE KEY VALUE" };

  expect(() => loadConfig(env)).toThrow(name);
  try {
    loadConfig(env);
  } catch (error) {
    expect(error.message).not.toContain("PRIVATE KEY VALUE");
  }
});

test("rejects a malformed model identifier", () => {
  expect(() => loadConfig({
    ...validEnv(),
    LLM_MODEL: "../invalid model"
  })).toThrow("LLM_MODEL");
});
