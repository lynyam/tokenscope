const { createHandlers } = require("../src/handlers");

const config = {
  geminiApiKey: "test-gemini-key",
  model: "gemini-3.8-flash",
  tokenScopeBaseUrl: "https://localhost:8443",
  chatApiKey: "test-chat-key",
  translationApiKey: "test-translation-key"
};

function setup() {
  const generate = jest.fn().mockResolvedValue({
    model: config.model,
    status: "SUCCESS",
    text: "Generated answer",
    error: null,
    usage: { inputTokens: 10, outputTokens: 20 }
  });

  const sendTrace = jest.fn().mockResolvedValue({ state: "sent" });

  // Observe calls while executing the real shared wrapper.
  const realWrapper = require("../src/call-with-trace").callWithTrace;
  const wrapper = jest.fn(options => realWrapper(options));

  const handlers = createHandlers(config, {
    generate,
    sendTrace,
    callWithTrace: wrapper
  });

  return { handlers, generate, sendTrace, wrapper };
}

test.each([
  ["chat", { text: "  Explain APIs.  " }, "chat", config.chatApiKey],
  ["translate", { text: "  Hello  ", targetLanguage: "French" },
    "translation", config.translationApiKey]
])("%s uses the shared wrapper and its own key", async (
  handler, body, workflow, apiKey
) => {
  const { handlers, generate, sendTrace, wrapper } = setup();
  const result = await handlers[handler](body);

  expect(result.statusCode).toBe(200);
  expect(wrapper).toHaveBeenCalledTimes(1);
  expect(wrapper).toHaveBeenCalledWith(expect.objectContaining({
    workflow,
    tokenScopeKey: apiKey
  }));
  expect(generate).toHaveBeenCalledTimes(1);
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({
    apiKey: config.geminiApiKey,
    model: config.model,
    text: body.text.trim()
  }));
  expect(sendTrace).toHaveBeenCalledTimes(1);
  expect(sendTrace).toHaveBeenCalledWith(expect.objectContaining({
    baseUrl: config.tokenScopeBaseUrl,
    apiKey,
    payload: expect.objectContaining({ workflow })
  }));

  for (const secret of [
    config.geminiApiKey, config.chatApiKey, config.translationApiKey
  ]) {
    expect(JSON.stringify(result)).not.toContain(secret);
  }
});

test("translation instructions include the selected language", async () => {
  const { handlers, generate } = setup();

  await handlers.translate({ text: "Hello", targetLanguage: "Spanish" });

  expect(generate.mock.calls[0][0].instruction).toContain("Spanish");
  expect(generate.mock.calls[0][0].text).toBe("Hello");
});

test.each([
  ["chat", null],
  ["chat", []],
  ["chat", {}],
  ["chat", { text: 42 }],
  ["chat", { text: "   " }],
  ["chat", { text: "x".repeat(2001) }],
  ["chat", { text: "Hello", apiKey: "override" }],
  ["chat", { text: "Hello", model: "override" }],
  ["chat", { text: "Hello", projectId: "override" }],
  ["chat", { text: "Hello", providerUrl: "https://example.com" }],
  ["translate", { text: "Hello" }],
  ["translate", { text: "Hello", targetLanguage: "Unsupported" }],
  ["translate", { text: "Hello", targetLanguage: ["French"] }],
  ["translate", {
    text: "Hello", targetLanguage: "French", organizationId: "override"
  }]
])("rejects invalid %s input: %j", async (handler, body) => {
  const { handlers, generate, sendTrace, wrapper } = setup();

  const result = await handlers[handler](body);

  expect(result.statusCode).toBe(400);
  expect(wrapper).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
  expect(sendTrace).not.toHaveBeenCalled();
});

test("accepts exactly 2,000 characters", async () => {
  const { handlers } = setup();
  const result = await handlers.chat({ text: "x".repeat(2000) });
  expect(result.statusCode).toBe(200);
});

test("trace delivery failure preserves the successful answer", async () => {
  const { handlers, generate, sendTrace } = setup();
  sendTrace.mockRejectedValue(new Error("offline"));

  const result = await handlers.chat({ text: "Hello" });

  expect(result.statusCode).toBe(200);
  expect(result.body.providerResult.text).toBe("Generated answer");
  expect(result.body.delivery.state).toBe("failed");
  expect(generate).toHaveBeenCalledTimes(1);
});

test("provider failure remains separate from trace delivery", async () => {
  const { handlers, generate, sendTrace } = setup();
  generate.mockResolvedValue({
    model: null,
    status: "ERROR",
    text: "",
    usage: null,
    error: "Gemini is temporarily unavailable."
  });

  const result = await handlers.chat({ text: "Hello" });

  expect(result.statusCode).toBe(502);
  expect(result.body.providerResult.status).toBe("ERROR");
  expect(result.body.delivery.state).toBe("not_sent");
  expect(sendTrace).not.toHaveBeenCalled();
});
