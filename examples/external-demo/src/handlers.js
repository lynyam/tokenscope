const { generateWithGemini } = require("./gemini");
const { callWithTrace } = require("./call-with-trace");
const { sendTrace } = require("./send-trace");

const LANGUAGES = Object.freeze(["English", "French", "Spanish"]);

function validateInput(body, translation) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }

  const allowed = translation ? ["text", "targetLanguage"] : ["text"];

  if (Object.keys(body).some(key => !allowed.includes(key))) {
    return "Request contains unsupported fields.";
  }

  if (typeof body.text !== "string") {
    return "Text must be a string.";
  }

  const text = body.text.trim();
  const length = Array.from(text).length;

  if (length < 1 || length > 2000) {
    return "Enter between 1 and 2,000 characters.";
  }

  if (translation && !LANGUAGES.includes(body.targetLanguage)) {
    return "Select English, French or Spanish.";
  }

  return null;
}

function createHandlers(config, dependencies = {}) {
  const generate = dependencies.generate || generateWithGemini;
  const trace = dependencies.callWithTrace || callWithTrace;
  const deliver = dependencies.sendTrace || sendTrace;

  async function handle(body, workflow) {
    const translation = workflow === "translation";
    const validationError = validateInput(body, translation);

    if (validationError) {
      return {
        statusCode: 400,
        body: { error: validationError }
      };
    }

    const instruction = translation
      ? `Translate the user's text into ${body.targetLanguage}. Return only the translation.`
      : "Answer the user's question clearly and briefly.";

    const result = await trace({
      workflow,
      tokenScopeKey: translation
        ? config.translationApiKey
        : config.chatApiKey,
      execute: () => generate({
        apiKey: config.geminiApiKey,
        model: config.model,
        instruction,
        text: body.text.trim()
      }),
      sendTrace: ({ apiKey, payload }) => deliver({
        baseUrl: config.tokenScopeBaseUrl,
        apiKey,
        payload
      })
    });

    // The body contains separate provider and trace-delivery outcomes.
    return {
      statusCode: result.providerResult.status === "SUCCESS" ? 200 : 502,
      body: result
    };
  }

  return {
    chat: body => handle(body, "chat"),
    translate: body => handle(body, "translation")
  };
}

module.exports = { createHandlers, LANGUAGES };
