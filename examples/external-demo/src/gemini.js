const { normalizeGeminiResponse } = require("./gemini-response");

async function generateWithGemini({
  apiKey,
  model,
  instruction,
  text,
  fetchImpl = fetch
}) {
  const signal = AbortSignal.timeout(60_000);

  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: instruction }]
          },
          contents: [{
            role: "user",
            parts: [{ text }]
          }],
          generationConfig: {
            candidateCount: 1,
            maxOutputTokens: 600
          }
        }),
        signal
      }
    );

    const body = await response.json();
    const result = normalizeGeminiResponse(body);

    if (!response.ok) {
      let error = "Gemini could not process this request.";

      if (response.status === 400) {
        error = "Gemini rejected the request. Check provider configuration.";
      } else if ([401, 403].includes(response.status)) {
        error = "Gemini access was denied. Check the API key and permissions.";
      } else if (response.status === 404) {
        error = "The configured Gemini model is unavailable.";
      } else if (response.status === 429) {
        error = "Gemini quota or rate limit reached. Try again later.";
      } else if (response.status >= 500) {
        error = "Gemini is temporarily unavailable.";
      }

      return { ...result, status: "ERROR", text: "", error };
    }

    return result;
  } catch {
    // Never expose raw exceptions, request headers or provider error bodies.
    return {
      model: null,
      status: "ERROR",
      text: "",
      usage: null,
      error: signal.aborted
        ? "Gemini did not finish within 60 seconds."
        : "Unable to obtain a valid Gemini response."
    };
  }
}

module.exports = { generateWithGemini };
