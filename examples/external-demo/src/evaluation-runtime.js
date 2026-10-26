const net = require("node:net");
const { loadConfig } = require("./config");
const catalogue = require("../config/model-prices.json");

function loadEvaluationConfig(env = process.env) {
  const config = loadConfig(env);
  const url = new URL(config.tokenScopeBaseUrl);
  if (url.protocol !== "https:" || url.hostname !== "localhost") {
    throw new Error("Evaluation requires TOKENSCOPE_BASE_URL=https://localhost:<HTTPS port>.");
  }
  if (!catalogue.some(row => row.provider === "gemini" && row.model === config.model && !row.isSynthetic)) {
    throw new Error("LLM_MODEL has no verified entry in the external-demo catalogue.");
  }
  if (config.port < 1024 || config.port === Number(url.port || 443)) {
    throw new Error("PORT must be at least 1024 and different from TokenScope's HTTPS port.");
  }
  if (!env.NODE_EXTRA_CA_CERTS) {
    throw new Error("NODE_EXTRA_CA_CERTS must point to the exported public Caddy CA.");
  }
  return config;
}

async function checkTokenScope(config, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(config.tokenScopeBaseUrl + "/api/v1/health/db", {
      redirect: "error", signal: AbortSignal.timeout(10_000)
    });
    if (response.status !== 200 || (await response.json()).status !== "healthy") throw new Error();
  } catch {
    throw new Error("TokenScope HTTPS readiness failed. Run make eval-up and check the URL and exported CA.");
  }
}

function checkPort(config) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error("Demo PORT is unavailable. Stop its current listener or choose another port.")));
    probe.listen({ host: config.host, port: config.port, exclusive: true }, () => {
      probe.close(error => error ? reject(new Error("Could not check demo PORT.")) : resolve());
    });
  });
}

async function checkDemo(config, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`http://${config.host}:${config.port}/`, {
      redirect: "error", signal: AbortSignal.timeout(2_000)
    });
    if (response.status !== 200 || !(await response.text()).includes("Two workflows. One tracing wrapper.")) throw new Error();
  } catch {
    throw new Error("Demo HTTP readiness failed.");
  }
}

async function main() {
  const config = loadEvaluationConfig();
  switch (process.argv[2]) {
    case "preflight":
      await checkTokenScope(config);
      await checkPort(config);
      console.log("Demo configuration and trusted TokenScope HTTPS preflight passed; no provider request was made.");
      break;
    case "health":
      // Do not depend on TokenScope after startup: the demo must remain usable
      // when demonstrating failed trace delivery during a backend outage.
      await checkDemo(config);
      break;
    case "url":
      console.log(`http://${config.host}:${config.port}`);
      break;
    default:
      throw new Error("Unknown evaluation-runtime action.");
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { loadEvaluationConfig, checkTokenScope, checkPort, checkDemo };
