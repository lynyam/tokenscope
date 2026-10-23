const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");

async function callWithTrace({
  workflow,
  tokenScopeKey,
  execute,
  sendTrace,
  clock = () => performance.now()
}) {
  if (!["chat", "translation"].includes(workflow)) {
    throw new Error("Unsupported workflow.");
  }

  const externalId = `demo-${workflow}-${randomUUID()}`;
  const occurredAt = new Date().toISOString();
  const started = clock();

  let providerResult;

  // Provider execution and trace delivery have separate error boundaries.
  try {
    providerResult = await execute();
  } catch {
    providerResult = {
      model: null,
      status: "ERROR",
      text: "",
      usage: null,
      error: "The provider operation failed."
    };
  }

  const latencyMs = Math.round(clock() - started);
  const execution = { externalId, occurredAt, latencyMs };

  const skipped = message => ({
    providerResult,
    execution,
    tracePayload: null,
    delivery: { state: "not_sent", message }
  });

  if (!providerResult?.usage) {
    return skipped("Trace not sent: provider usage unavailable.");
  }

  const { inputTokens, outputTokens } = providerResult.usage;
  const validCount = value =>
    Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;

  const validModel = typeof providerResult.model === "string" &&
    /^[a-z0-9][a-z0-9._:/-]{0,99}$/.test(providerResult.model);

  if (!validCount(inputTokens) || !validCount(outputTokens) ||
      !validModel ||
      !["SUCCESS", "ERROR"].includes(providerResult.status) ||
      !Number.isSafeInteger(latencyMs) ||
      latencyMs < 0 || latencyMs > 86_400_000) {
    return skipped("Trace not sent: execution data could not be represented accurately.");
  }

  // Explicit allowlist: no spreading provider data into the trace.
  const tracePayload = {
    externalId,
    provider: "gemini",
    model: providerResult.model,
    workflow,
    inputTokens,
    outputTokens,
    latencyMs,
    status: providerResult.status,
    occurredAt,
    metadata: {
      application: "tokenscope-external-demo",
      environment: "evaluation"
    }
  };

  let delivery;
  try {
    delivery = await sendTrace({
      apiKey: tokenScopeKey,
      payload: tracePayload
    });
  } catch {
    delivery = {
      state: "failed",
      message: "Trace delivery failed."
    };
  }

  return { providerResult, execution, tracePayload, delivery };
}

module.exports = { callWithTrace };
