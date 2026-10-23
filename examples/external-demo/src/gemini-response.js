const { normalizeUsage } = require("./usage");

function normalizeGeminiResponse(body) {
  const candidate = body?.candidates?.[0];
  const parts = candidate?.content?.parts;

  // Keep visible text only; omit thoughts and provider signatures.
  const text = Array.isArray(parts)
    ? parts
        .filter(part => part && part.thought !== true &&
          typeof part.text === "string")
        .map(part => part.text)
        .join("")
        .trim()
    : "";

  let error = null;

  if (body?.promptFeedback?.blockReason) {
    error = "Gemini blocked this request. Try different input.";
  } else if (candidate?.finishReason === "MAX_TOKENS") {
    error = "Gemini reached the output limit before completing its answer.";
  } else if (candidate?.finishReason !== "STOP") {
    error = "Gemini did not complete an answer.";
  } else if (!text) {
    error = "Gemini returned no answer text.";
  }

  return {
    model: typeof body?.modelVersion === "string" &&
      body.modelVersion.trim() !== ""
      ? body.modelVersion
      : null,
    status: error ? "ERROR" : "SUCCESS",
    text: error ? "" : text,
    error,
    usage: normalizeUsage(body?.usageMetadata)
  };
}

module.exports = { normalizeGeminiResponse };
