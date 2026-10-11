const { callWithTrace } = require("../src/call-with-trace");

function providerResult() {
  return {
    model: "gemini-3.8-flash",
    status: "SUCCESS",
    text: "PRIVATE ANSWER",
    error: null,
    usage: { inputTokens: 11, outputTokens: 393 }
  };
}

test.each(["chat", "translation"])(
  "executes once and passes the selected %s workflow and key",
  async workflow => {
    let time = 0;
    const execute = jest.fn(async () => {
      time = 125;
      return providerResult();
    });
    const sendTrace = jest.fn(async () => {
      time = 9000;
      return { state: "sent" };
    });

    const result = await callWithTrace({
      workflow,
      tokenScopeKey: "PRIVATE KEY",
      execute,
      sendTrace,
      clock: () => time
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(sendTrace).toHaveBeenCalledTimes(1);
    expect(sendTrace).toHaveBeenCalledWith({
      apiKey: "PRIVATE KEY",
      payload: result.tracePayload
    });
    expect(result.tracePayload.workflow).toBe(workflow);
    expect(result.tracePayload.latencyMs).toBe(125);
    expect(Object.keys(result.tracePayload).sort()).toEqual([
      "externalId", "provider", "model", "workflow", "inputTokens",
      "outputTokens", "latencyMs", "status", "occurredAt", "metadata"
    ].sort());
    expect(JSON.stringify(result.tracePayload)).not.toContain("PRIVATE");
  }
);

test("delivery exceptions preserve the answer without retries", async () => {
  const execute = jest.fn(async () => providerResult());
  const sendTrace = jest.fn(async () => { throw new Error("offline"); });

  const result = await callWithTrace({
    workflow: "chat", tokenScopeKey: "test", execute, sendTrace
  });

  expect(result.providerResult.status).toBe("SUCCESS");
  expect(result.providerResult.text).toBe("PRIVATE ANSWER");
  expect(result.tracePayload.status).toBe("SUCCESS");
  expect(result.delivery.state).toBe("failed");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(sendTrace).toHaveBeenCalledTimes(1);
});

test("missing usage preserves the answer and prevents trace submission", async () => {
  const sendTrace = jest.fn();
  const result = await callWithTrace({
    workflow: "chat",
    tokenScopeKey: "test",
    execute: async () => ({ ...providerResult(), usage: null }),
    sendTrace
  });

  expect(result.providerResult.text).toBe("PRIVATE ANSWER");
  expect(result.tracePayload).toBeNull();
  expect(result.delivery.state).toBe("not_sent");
  expect(sendTrace).not.toHaveBeenCalled();
});

test("each execution has its own ID, including concurrent executions", async () => {
  const options = {
    workflow: "chat",
    tokenScopeKey: "test",
    execute: async () => providerResult(),
    sendTrace: async () => ({ state: "sent" })
  };
  const results = await Promise.all([
    callWithTrace(options), callWithTrace(options)
  ]);

  expect(results[0].execution.externalId)
    .not.toBe(results[1].execution.externalId);
});

test("provider exceptions produce no invented usage or trace", async () => {
  const sendTrace = jest.fn();
  const result = await callWithTrace({
    workflow: "chat",
    tokenScopeKey: "test",
    execute: async () => { throw new Error("PRIVATE ERROR"); },
    sendTrace
  });

  expect(result.providerResult.status).toBe("ERROR");
  expect(result.providerResult.usage).toBeNull();
  expect(sendTrace).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("PRIVATE ERROR");
});
