const { readFileSync } = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const publicDir = path.join(__dirname, "../public");
const html = readFileSync(path.join(publicDir, "index.html"), "utf8");
const script = readFileSync(path.join(publicDir, "app.js"), "utf8");

let dom;
let document;
let fetchMock;

const settle = () => new Promise(resolve => setImmediate(resolve));

function result(overrides = {}) {
  return {
    providerResult: {
      status: "SUCCESS",
      text: "Test answer",
      model: "test-model",
      usage: { inputTokens: 10, outputTokens: 20 }
    },
    execution: {
      externalId: "demo-test",
      latencyMs: 100
    },
    delivery: {
      state: "sent",
      message: "Trace sent."
    },
    tracePayload: {
      externalId: "demo-test",
      provider: "gemini",
      workflow: "chat",
      inputTokens: 10,
      outputTokens: 20
    },
    ...overrides
  };
}

function submit(name) {
  document.getElementById(`${name}-form`).dispatchEvent(
    new dom.window.Event("submit", { bubbles: true, cancelable: true })
  );
}

beforeEach(() => {
  dom = new JSDOM(html, {
    url: "http://127.0.0.1:8080",
    runScripts: "outside-only"
  });
  document = dom.window.document;
  fetchMock = jest.fn();
  dom.window.fetch = fetchMock;
  dom.window.eval(script);
});

afterEach(() => {
  dom.window.close();
});

test.each(["chat", "translation"])(
  "%s prevents duplicate submissions while pending",
  async name => {
    let resolveRequest;
    fetchMock.mockImplementation(() => new Promise(resolve => {
      resolveRequest = resolve;
    }));
    document.getElementById(`${name}-text`).value = "Hello";

    submit(name);
    submit(name);

    const button = document.querySelector(
      `#${name}-form button[type="submit"]`
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);

    resolveRequest({ json: async () => result() });
    await settle();

    expect(button.disabled).toBe(false);
    expect(document.getElementById(`${name}-form`)
      .getAttribute("aria-busy")).toBe("false");
  }
);

test("translation sends trimmed input and the selected language", async () => {
  fetchMock.mockResolvedValue({ json: async () => result() });
  document.getElementById("translation-text").value = "  Hello  ";
  document.getElementById("target-language").value = "Spanish";

  submit("translation");
  await settle();

  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/demo/translate");
  expect(JSON.parse(options.body)).toEqual({
    text: "Hello",
    targetLanguage: "Spanish"
  });
});

test("renders generated markup as text without creating HTML elements", async () => {
  const data = result();
  const markup = '<img src=x onerror="alert(1)">';
  data.providerResult.text = markup;
  fetchMock.mockResolvedValue({ json: async () => data });
  document.getElementById("chat-text").value = "Hello";

  submit("chat");
  await settle();

  const answer = document.getElementById("chat-answer");
  expect(answer.textContent).toBe(markup);
  expect(answer.querySelector("img")).toBeNull();
});

test("delivery failure preserves the successful provider answer", async () => {
  fetchMock.mockResolvedValue({
    json: async () => result({
      delivery: { state: "failed", message: "Trace delivery failed." }
    })
  });
  document.getElementById("chat-text").value = "Hello";

  submit("chat");
  await settle();

  expect(document.getElementById("chat-answer").textContent)
    .toBe("Test answer");
  expect(document.getElementById("chat-delivery").textContent)
    .toContain("Trace delivery failed");
  expect(document.getElementById("chat-result").hidden).toBe(false);
});

test("network failure re-enables submission without retrying", async () => {
  fetchMock.mockRejectedValue(new Error("PRIVATE ERROR"));
  document.getElementById("chat-text").value = "Hello";

  submit("chat");
  await settle();

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(document.querySelector('#chat-form button[type="submit"]')
    .disabled).toBe(false);
  const feedback = document.getElementById("chat-progress").textContent;
  expect(feedback).toContain("may have completed");
  expect(feedback).not.toContain("PRIVATE ERROR");
});

test("copies only the exact trace payload returned by the backend", async () => {
  const data = result();
  const writeText = jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { writeText }
  });
  fetchMock.mockResolvedValue({ json: async () => data });
  document.getElementById("chat-text").value = "PRIVATE QUESTION";

  submit("chat");
  await settle();
  document.getElementById("chat-copy").click();
  await settle();

  expect(writeText).toHaveBeenCalledWith(
    JSON.stringify(data.tracePayload, null, 2)
  );
  expect(document.getElementById("chat-copy-status").textContent)
    .toBe("Trace payload copied.");
});
