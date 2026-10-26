function loadConfig(env = process.env) {
  const required = [
    "GEMINI_API_KEY",
    "LLM_MODEL",
    "TOKENSCOPE_BASE_URL",
    "TOKENSCOPE_CHAT_API_KEY",
    "TOKENSCOPE_TRANSLATION_API_KEY"
  ];

  for (const name of required) {
    if (typeof env[name] !== "string" || !env[name].trim()) {
      throw new Error(`Missing required configuration: ${name}`);
    }
  }

  for (const name of [
    "GEMINI_API_KEY",
    "TOKENSCOPE_CHAT_API_KEY",
    "TOKENSCOPE_TRANSLATION_API_KEY"
  ]) {
    if (/\s/.test(env[name])) {
      throw new Error(`Invalid configuration: ${name} must not contain whitespace.`);
    }
  }

  const model = env.LLM_MODEL.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(model)) {
    throw new Error("Invalid configuration: LLM_MODEL.");
  }

  const portText = env.PORT ?? "8080";
  if (!/^\d{1,5}$/.test(portText) ||
      Number(portText) < 1 || Number(portText) > 65535) {
    throw new Error("Invalid configuration: PORT must be between 1 and 65535.");
  }

  let url;
  try {
    url = new URL(env.TOKENSCOPE_BASE_URL.trim());
  } catch {
    throw new Error("Invalid configuration: TOKENSCOPE_BASE_URL.");
  }

  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const allowedProtocol = url.protocol === "https:" ||
    (url.protocol === "http:" && loopback);

  if (!allowedProtocol || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/") {
    throw new Error(
      "Invalid configuration: TOKENSCOPE_BASE_URL must be an HTTPS origin, or local loopback HTTP."
    );
  }

  if (env.TOKENSCOPE_CHAT_API_KEY === env.TOKENSCOPE_TRANSLATION_API_KEY) {
    throw new Error("Chat and Translation must use different TokenScope keys.");
  }

  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error("TLS certificate verification must remain enabled.");
  }

  return Object.freeze({
    host: "127.0.0.1",
    port: Number(portText),
    geminiApiKey: env.GEMINI_API_KEY,
    model,
    tokenScopeBaseUrl: url.origin,
    chatApiKey: env.TOKENSCOPE_CHAT_API_KEY,
    translationApiKey: env.TOKENSCOPE_TRANSLATION_API_KEY
  });
}

module.exports = { loadConfig };
