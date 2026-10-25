const net = require("node:net");
const { loadEvaluationConfig, checkTokenScope, checkPort, checkDemo } = require("../src/evaluation-runtime");

const env = {
  GEMINI_API_KEY: "fixture-provider-key",
  LLM_MODEL: "gemini-3.5-flash-lite",
  TOKENSCOPE_BASE_URL: "https://localhost:8443",
  TOKENSCOPE_CHAT_API_KEY: "fixture-chat-key",
  TOKENSCOPE_TRANSLATION_API_KEY: "fixture-translation-key",
  NODE_EXTRA_CA_CERTS: "/run/caddy-root.crt"
};

test("evaluation defaults match the committed real-model catalogue", () => {
  const config = loadEvaluationConfig(env);
  expect(config.model).toBe(require("../config/model-prices.json")[0].model);
  expect(config.host).toBe("127.0.0.1");
  expect(config.port).toBe(8080);
});

test.each([
  { TOKENSCOPE_BASE_URL: "http://localhost:5173" },
  { TOKENSCOPE_BASE_URL: "https://some-other-host.example" },
  { LLM_MODEL: "unknown-model" },
  { PORT: "443" },
  { PORT: "8443" },
  { NODE_EXTRA_CA_CERTS: "" },
  { NODE_TLS_REJECT_UNAUTHORIZED: "0" }
])("rejects unsuitable evaluation settings without printing secrets: %j", patch => {
  expect(() => loadEvaluationConfig({ ...env, ...patch })).toThrow();
  try { loadEvaluationConfig({ ...env, ...patch }); } catch (error) {
    expect(error.message).not.toContain(env.GEMINI_API_KEY);
    expect(error.message).not.toContain(env.TOKENSCOPE_CHAT_API_KEY);
  }
});

test("preflight checks only the anonymous HTTPS health endpoint, without API keys", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ status: 200, json: async () => ({ status: "healthy" }) });
  await checkTokenScope(loadEvaluationConfig(env), fetchImpl);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledWith("https://localhost:8443/api/v1/health/db", {
    redirect: "error", signal: expect.any(AbortSignal)
  });
});

test.each([
  { status: 503, json: async () => ({ status: "unhealthy" }) },
  { status: 200, json: async () => ({ status: "unhealthy" }) },
  { status: 200, json: async () => { throw new Error("HTML instead of JSON"); } }
])("rejects failed/incorrect TokenScope readiness", async response => {
  await expect(checkTokenScope(loadEvaluationConfig(env), async () => response)).rejects.toThrow("HTTPS readiness failed");
});

test("TLS/network errors are safe and never downgrade to HTTP", async () => {
  const fetchImpl = jest.fn().mockRejectedValue(new Error("sensitive raw diagnostic"));
  await expect(checkTokenScope(loadEvaluationConfig(env), fetchImpl)).rejects.toThrow("HTTPS readiness failed");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("an occupied demo port fails before launching another server", async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await expect(checkPort({ host: "127.0.0.1", port: server.address().port })).rejects.toThrow("PORT is unavailable");
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("an available port can be checked without keeping a listener open", async () => {
  await expect(checkPort({ host: "127.0.0.1", port: 0 })).resolves.toBeUndefined();
});

test("steady-state health checks only the local demo and never call a provider or TokenScope", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({ status: 200, text: async () => "Two workflows. One tracing wrapper." });
  await checkDemo(loadEvaluationConfig(env), fetchImpl);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(fetchImpl.mock.calls[0][0]).toBe("http://127.0.0.1:8080/");
});

test("wrong local content is not demo readiness", async () => {
  await expect(checkDemo(loadEvaluationConfig(env), async () => ({ status: 200, text: async () => "Another application" })))
    .rejects.toThrow("Demo HTTP readiness failed");
});
