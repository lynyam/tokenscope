const http = require("node:http");
const { createDemoServer } = require("../src/server");

let server;
let handlers;
let port;

beforeEach(async () => {
  handlers = {
    chat: jest.fn().mockResolvedValue({
      statusCode: 200,
      body: { answer: "Test chat answer" }
    }),
    translate: jest.fn().mockResolvedValue({
      statusCode: 200,
      body: { answer: "Bonjour" }
    })
  };

  server = createDemoServer({}, { handlers });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  port = server.address().port;
});

afterEach(async () => {
  await new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve())
  );
});

function request({
  route = "/demo/chat",
  method = "POST",
  headers = { "Content-Type": "application/json" },
  body = '{"text":"Hello"}'
} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: route,
      method,
      headers,
      agent: false
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
        });
      });
    });

    req.on("error", reject);
    req.end(body);
  });
}

test.each([
  ["/demo/chat", "chat"],
  ["/demo/translate", "translate"]
])("routes %s to its handler", async (route, name) => {
  const response = await request({ route });

  expect(response.status).toBe(200);
  expect(handlers[name]).toHaveBeenCalledWith({ text: "Hello" });
  expect(handlers[name]).toHaveBeenCalledTimes(1);
  const other = name === "chat" ? "translate" : "chat";
  expect(handlers[other]).not.toHaveBeenCalled();
});

test("preserves handler validation errors", async () => {
  handlers.chat.mockResolvedValue({
    statusCode: 400,
    body: { error: "Text must be a string." }
  });

  const response = await request({ body: '{"text":42}' });

  expect(response.status).toBe(400);
  expect(response.body.error).toBe("Text must be a string.");
});

test("rejects malformed JSON before calling a handler", async () => {
  const response = await request({ body: '{"text":' });

  expect(response.status).toBe(400);
  expect(handlers.chat).not.toHaveBeenCalled();
});

test("rejects invalid UTF-8 before calling a handler", async () => {
  const body = Buffer.concat([
    Buffer.from('{"text":"'),
    Buffer.from([0xff]),
    Buffer.from('"}')
  ]);
  const response = await request({ body });

  expect(response.status).toBe(400);
  expect(handlers.chat).not.toHaveBeenCalled();
});

test("requires JSON content type", async () => {
  const response = await request({
    headers: { "Content-Type": "text/plain" }
  });

  expect(response.status).toBe(415);
  expect(handlers.chat).not.toHaveBeenCalled();
});

test("requires POST for submissions", async () => {
  const response = await request({ method: "GET", body: "" });

  expect(response.status).toBe(405);
  expect(response.headers.allow).toBe("POST");
  expect(handlers.chat).not.toHaveBeenCalled();
});

test("rejects an oversized declared body", async () => {
  const body = JSON.stringify({ text: "x".repeat(16 * 1024) });
  const response = await request({
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body))
    },
    body
  });

  expect(response.status).toBe(413);
  expect(handlers.chat).not.toHaveBeenCalled();
});

test("enforces the byte limit for chunked requests", async () => {
  const response = await request({
    headers: {
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked"
    },
    body: JSON.stringify({ text: "é".repeat(9000) })
  });

  expect(response.status).toBe(413);
  expect(handlers.chat).not.toHaveBeenCalled();
});

test("accepts a body exactly at the transport limit", async () => {
  const prefix = '{"text":"';
  const suffix = '"}';
  const body = prefix +
    "x".repeat(16 * 1024 - prefix.length - suffix.length) +
    suffix;

  const response = await request({ body });

  expect(response.status).toBe(200);
  expect(handlers.chat).toHaveBeenCalledTimes(1);
});

test.each(["/.env", "/src/config.js", "/unknown"])(
  "does not expose %s",
  async route => {
    const response = await request({ route, method: "GET", body: "" });
    expect(response.status).toBe(404);
    expect(handlers.chat).not.toHaveBeenCalled();
    expect(handlers.translate).not.toHaveBeenCalled();
  }
);

test("returns a safe error for unexpected handler exceptions", async () => {
  handlers.chat.mockRejectedValue(new Error("PRIVATE SERVER DETAILS"));

  const response = await request();

  expect(response.status).toBe(500);
  expect(JSON.stringify(response.body)).not.toContain("PRIVATE");
});

test("sets no-store and browser security headers", async () => {
  const response = await request();

  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["content-security-policy"])
    .toContain("frame-ancestors 'none'");
});
