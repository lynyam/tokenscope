const { sendTrace } = require("../src/send-trace");

const traceId = "550e8400-e29b-41d4-a716-446655440000";
const options = {
  baseUrl: "https://localhost:8443/",
  apiKey: "test-project-key",
  payload: { externalId: "demo-chat-test" }
};

function mockResponse(status, body, headers = {}) {
  return {
    status,
    headers: new Headers(headers),
    json: async () => body
  };
}

test.each([
  [201, "sent"],
  [200, "already_recorded"]
])("handles HTTP %s as %s with its trace ID", async (status, state) => {
  const fetchImpl = jest.fn().mockResolvedValue(
    mockResponse(status, { id: traceId }, { "X-Request-Id": "req-123" })
  );

  const result = await sendTrace({ ...options, fetchImpl });

  expect(result).toMatchObject({
    state,
    traceId,
    requestId: "req-123",
    httpStatus: status,
    warning: null
  });
  expect(fetchImpl).toHaveBeenCalledTimes(1);

  const [url, request] = fetchImpl.mock.calls[0];
  expect(url).toBe("https://localhost:8443/api/v1/public/traces");
  expect(request.method).toBe("POST");
  expect(request.redirect).toBe("error");
  expect(request.headers["X-API-Key"]).toBe("test-project-key");
  expect(JSON.parse(request.body)).toEqual(options.payload);
});

test.each([
  [400, "VALIDATION_ERROR", "integration validation error"],
  [400, "MODEL_PRICE_NOT_FOUND", "missing pricing"],
  [401, "INVALID_API_KEY", "invalid or revoked key"],
  [409, "TRACE_EXTERNAL_ID_CONFLICT", "conflicting execution ID"],
  [409, "TRACE_DELETED", "cannot be reused"],
  [429, "RATE_LIMITED", "rate limit"]
])("explains %s %s without retrying", async (status, code, message) => {
  const fetchImpl = jest.fn().mockResolvedValue(
    mockResponse(status, {
      code,
      message: "PRIVATE SERVER DETAILS",
      requestId: "req-456"
    })
  );

  const result = await sendTrace({ ...options, fetchImpl });

  expect(result.state).toBe("failed");
  expect(result.code).toBe(code);
  expect(result.message).toContain(message);
  expect(result.requestId).toBe("req-456");
  expect(JSON.stringify(result)).not.toContain("PRIVATE SERVER DETAILS");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("includes Retry-After for rate-limit feedback", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(
    mockResponse(429, { code: "RATE_LIMITED" }, { "Retry-After": "42" })
  );

  const result = await sendTrace({ ...options, fetchImpl });
  expect(result.retryAfterSeconds).toBe(42);
});

test("handles a non-JSON server failure", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    status: 503,
    headers: new Headers(),
    json: async () => { throw new Error("HTML error page"); }
  });

  const result = await sendTrace({ ...options, fetchImpl });

  expect(result.state).toBe("failed");
  expect(result.message).toContain("temporarily unavailable");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("network failure reports uncertain storage without exposing exceptions", async () => {
  const fetchImpl = jest.fn().mockRejectedValue(
    new Error("PRIVATE CONNECTION DETAILS")
  );

  const result = await sendTrace({ ...options, fetchImpl });

  expect(result.state).toBe("failed");
  expect(result.message).toContain("Storage status is unknown");
  expect(JSON.stringify(result)).not.toContain("PRIVATE CONNECTION DETAILS");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

test("does not invent a trace ID when the response lacks one", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(
    mockResponse(201, {})
  );

  const result = await sendTrace({ ...options, fetchImpl });

  expect(result.state).toBe("sent");
  expect(result.traceId).toBeNull();
  expect(result.warning).toBeTruthy();
});

test("does not display an unsafe request ID", async () => {
  const fetchImpl = jest.fn().mockResolvedValue(
    mockResponse(400, {
      code: "VALIDATION_ERROR",
      requestId: "<unsafe>"
    })
  );

  const result = await sendTrace({ ...options, fetchImpl });
  expect(result.requestId).toBeNull();
});

test("times out after 10 seconds without retrying", async () => {
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

    const pending = sendTrace({ ...options, fetchImpl });
    await jest.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(result.state).toBe("failed");
    expect(result.message).toContain("timed out");
    expect(result.message).toContain("Storage status is unknown");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  } finally {
    timeout.mockRestore();
    jest.useRealTimers();
  }
});
