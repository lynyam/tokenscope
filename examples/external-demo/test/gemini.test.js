const { generateWithGemini } = require("../src/gemini");

const options = {
  apiKey: "test-key-not-a-secret",
  model: "gemini-3.8-flash",
  instruction: "Answer briefly.",
  text: "What is an API?"
};

test("makes one request with separate instructions and bounded output", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      modelVersion: "gemini-3.8-flash",
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: "An interface for applications." }] }
      }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        totalTokenCount: 15
      }
    })
  });

  const result = await generateWithGemini({ ...options, fetchImpl });

  expect(fetchImpl).toHaveBeenCalledTimes(1);
  const [url, request] = fetchImpl.mock.calls[0];
  expect(url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent"
  );
  expect(JSON.parse(request.body)).toEqual({
    systemInstruction: { parts: [{ text: options.instruction }] },
    contents: [{ role: "user", parts: [{ text: options.text }] }],
    generationConfig: { candidateCount: 1, maxOutputTokens: 600 }
  });
  expect(result).toMatchObject({
    status: "SUCCESS",
    text: "An interface for applications.",
    usage: { inputTokens: 10, outputTokens: 5 }
  });
});

test.each([400, 401, 403, 404, 429, 500])(
  "reports HTTP %s without retrying or exposing raw errors",
  async status => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({ error: { message: "PRIVATE ERROR DETAILS" } })
    });

    const result = await generateWithGemini({ ...options, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ERROR");
    expect(result.usage).toBeNull();
    expect(JSON.stringify(result)).not.toContain("PRIVATE ERROR DETAILS");
  }
);

test("handles network failure without retrying or exposing exceptions", async () => {
  const fetchImpl = jest.fn().mockRejectedValue(
    new Error("PRIVATE CONNECTION DETAILS")
  );

  const result = await generateWithGemini({ ...options, fetchImpl });

  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(result.status).toBe("ERROR");
  expect(JSON.stringify(result)).not.toContain("PRIVATE CONNECTION DETAILS");
});

test("enforces the provider timeout without retrying", async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const timeout = jest.spyOn(AbortSignal, "timeout")
    .mockImplementation(ms => {
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });

  try {
    const fetchImpl = jest.fn((_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      })
    );

    const pending = generateWithGemini({ ...options, fetchImpl });
    await jest.advanceTimersByTimeAsync(60_000);
    const result = await pending;

    expect(timeout).toHaveBeenCalledWith(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.error).toBe("Gemini did not finish within 60 seconds.");
  } finally {
    timeout.mockRestore();
    jest.useRealTimers();
  }
});
