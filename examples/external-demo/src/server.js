const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { loadConfig } = require("./config");
const { createHandlers } = require("./handlers");

const BODY_LIMIT = 16 * 1024;
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const ASSETS = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"]
};

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let settled = false;
    const chunks = [];

    function fail(statusCode, message) {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject({ statusCode, message });
    }

    request.on("data", chunk => {
      if (settled) return;
      size += chunk.length;

      if (size > BODY_LIMIT) {
        fail(413, "Request body exceeds the 16 KiB limit.");
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (settled) return;

      try {
        const text = new TextDecoder("utf-8", { fatal: true })
          .decode(Buffer.concat(chunks));
        const body = JSON.parse(text);
        settled = true;
        resolve(body);
      } catch {
        fail(400, "Request body must contain valid UTF-8 JSON.");
      }
    });

    request.on("aborted", () => fail(400, "Request was interrupted."));
    request.on("error", () => fail(400, "Unable to read request."));
  });
}

function createDemoServer(config, dependencies = {}) {
  const handlers = dependencies.handlers || createHandlers(config);

  const server = http.createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; " +
      "connect-src 'self'; object-src 'none'; base-uri 'none'; " +
      "frame-ancestors 'none'; form-action 'self'");

    try {
      const route = request.url;
      const handler = route === "/demo/chat"
        ? handlers.chat
        : route === "/demo/translate"
          ? handlers.translate
          : null;

      if (handler) {
        if (request.method !== "POST") {
          response.setHeader("Allow", "POST");
          sendJson(response, 405, { error: "Use POST for submissions." });
          return;
        }

        const contentType = request.headers["content-type"] || "";
        if (contentType.split(";")[0].trim().toLowerCase() !==
            "application/json") {
          sendJson(response, 415, { error: "Use application/json." });
          return;
        }

        const declaredLength = request.headers["content-length"];
        if (declaredLength !== undefined &&
            Number(declaredLength) > BODY_LIMIT) {
          request.resume();
          sendJson(response, 413, {
            error: "Request body exceeds the 16 KiB limit."
          });
          return;
        }

        let body;
        try {
          body = await readJson(request);
        } catch (error) {
          if (!response.destroyed) {
            sendJson(response, error.statusCode, { error: error.message });
          }
          return;
        }

        const result = await handler(body);
        sendJson(response, result.statusCode, result.body);
        return;
      }

      if (Object.hasOwn(ASSETS, route)) {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          sendJson(response, 405, { error: "Use GET for this resource." });
          return;
        }

        const [filename, contentType] = ASSETS[route];
        let content;
        try {
          content = await readFile(path.join(PUBLIC_DIR, filename));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          sendJson(response, 404, { error: "Page asset is not available yet." });
          return;
        }

        response.writeHead(200, { "Content-Type": contentType });
        response.end(content);
        return;
      }

      sendJson(response, 404, { error: "Route not found." });
    } catch {
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, 500, { error: "The demo could not complete this request." });
      } else {
        response.destroy();
      }
    }
  });

  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

if (require.main === module) {
  try {
    const config = loadConfig();
    const server = createDemoServer(config);

    server.on("error", () => {
      console.error("Unable to start the demo server. Check port availability.");
      process.exitCode = 1;
    });

    server.listen(config.port, config.host, () => {
      console.log(`Demo available at http://${config.host}:${config.port}`);
    });
  } catch (error) {
    // Configuration errors name settings without printing their values.
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createDemoServer };
