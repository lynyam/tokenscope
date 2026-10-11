const { normalizeGeminiResponse } = require("../src/gemini-response");

function response() {
  return {
    modelVersion: "gemini-3.8-flash",
    candidates: [{
      finishReason: "STOP",
      content: { parts: [
        { text: "Internal reasoning", thought: true },
        { text: "Hello!", thoughtSignature: "unused-signature" }
      ] }
    }],
    usageMetadata: {
      promptTokenCount: 11,
      candidatesTokenCount: 18,
      thoughtsTokenCount: 375,
      totalTokenCount: 404
    }
  };
}

test("extracts visible text, actual model and usage only", () => {
  expect(normalizeGeminiResponse(response())).toEqual({
    model: "gemini-3.8-flash",
    status: "SUCCESS",
    text: "Hello!",
    error: null,
    usage: { inputTokens: 11, outputTokens: 393 }
  });
});

test("preserves an answer when usage is unavailable", () => {
  const body = response();
  delete body.usageMetadata;
  expect(normalizeGeminiResponse(body)).toMatchObject({
    status: "SUCCESS",
    text: "Hello!",
    usage: null
  });
});

test.each(["SAFETY", "MAX_TOKENS", undefined])(
  "does not label an incomplete or blocked response successful: %s",
  finishReason => {
    const body = response();
    body.candidates[0].finishReason = finishReason;
    expect(normalizeGeminiResponse(body)).toMatchObject({
      status: "ERROR",
      text: "",
      error: expect.any(String),
      usage: { inputTokens: 11, outputTokens: 393 }
    });
  }
);

test("rejects empty visible output", () => {
  const body = response();
  body.candidates[0].content.parts = [{ text: "   " }];
  expect(normalizeGeminiResponse(body).status).toBe("ERROR");
});

test("handles a blocked prompt without candidates", () => {
  expect(normalizeGeminiResponse({
    promptFeedback: { blockReason: "SAFETY" }
  })).toMatchObject({
    status: "ERROR",
    text: "",
    usage: null
  });
});

test("does not invent a missing model identifier", () => {
  const body = response();
  delete body.modelVersion;
  expect(normalizeGeminiResponse(body).model).toBeNull();
});
