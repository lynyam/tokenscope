const MAX_TOKENS = 1_000_000_000;

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;

  const {
    promptTokenCount: inputTokens,
    candidatesTokenCount: answerTokens,
    thoughtsTokenCount: thinkingTokens,
    totalTokenCount: totalTokens
  } = usage;

  if (![inputTokens, answerTokens, totalTokens].every(isCount)) {
    return null;
  }

  // This mapping supports our text-only, no-tools requests.
  if (usage.toolUsePromptTokenCount !== undefined &&
      usage.toolUsePromptTokenCount !== 0) {
    return null;
  }

  const outputTokens = totalTokens - inputTokens;

  if (!isCount(outputTokens) || outputTokens < answerTokens) return null;
  if (inputTokens > MAX_TOKENS || outputTokens > MAX_TOKENS) return null;

  if (thinkingTokens !== undefined) {
    if (!isCount(thinkingTokens)) return null;
    if (answerTokens + thinkingTokens !== outputTokens) return null;
  }

  return { inputTokens, outputTokens };
}

module.exports = { normalizeUsage };
