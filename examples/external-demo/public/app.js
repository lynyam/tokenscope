"use strict";

function setupPanel(name, endpoint) {
  const get = suffix => document.getElementById(`${name}-${suffix}`);
  const form = get("form");
  const input = get("text");
  const submit = form.querySelector('button[type="submit"]');
  const progress = get("progress");
  const result = get("result");
  const answer = get("answer");
  const delivery = get("delivery");
  const details = get("details");
  const payloadSection = get("payload-section");
  const payloadDisplay = get("payload");
  const copyButton = get("copy");
  const copyStatus = get("copy-status");
  const language = name === "translation"
    ? document.getElementById("target-language")
    : null;

  let pending = false;
  let replayPayload = null;

  function addDetail(label, value) {
    if (value === null || value === undefined) return;
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = String(value);
    details.append(term, description);
  }

  function render(data) {
    const provider = data.providerResult;
    const trace = data.delivery;

    if (!provider || !trace || !data.execution) {
      throw new Error("Invalid demo response.");
    }

    answer.textContent = provider.status === "SUCCESS"
      ? provider.text
      : provider.error || "The provider could not produce an answer.";
    answer.className = provider.status === "SUCCESS"
      ? "answer"
      : "answer error";

    const delivered = ["sent", "already_recorded"].includes(trace.state);
    delivery.className = delivered ? "success" : "error";
    delivery.textContent = trace.message || "Trace delivery status unavailable.";

    if (trace.warning) {
      delivery.textContent += ` ${trace.warning}`;
    }
    if (trace.retryAfterSeconds !== null &&
        trace.retryAfterSeconds !== undefined) {
      delivery.textContent +=
        ` Retry after ${trace.retryAfterSeconds} seconds. No automatic retry was made.`;
    }

    details.replaceChildren();
    addDetail("Execution ID", data.execution.externalId);
    addDetail("Trace ID", trace.traceId);
    addDetail("Request ID", trace.requestId);
    addDetail("Delivery HTTP status", trace.httpStatus);
    addDetail("Provider", data.tracePayload?.provider || "gemini");
    addDetail("Model", provider.model);
    addDetail("Workflow", name);
    addDetail("Input tokens", provider.usage?.inputTokens);
    addDetail("Output tokens", provider.usage?.outputTokens);
    addDetail("Provider latency (ms)", data.execution.latencyMs);

    if (!provider.usage) {
      addDetail("Token usage", "Unavailable");
    }

    replayPayload = data.tracePayload
      ? JSON.stringify(data.tracePayload, null, 2)
      : null;
    payloadDisplay.textContent = replayPayload || "";
    payloadSection.hidden = replayPayload === null;
    copyStatus.textContent = "";
    result.hidden = false;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (pending) return;

    const text = input.value.trim();
    const length = Array.from(text).length;

    if (length < 1 || length > 2000) {
      progress.textContent = "Enter between 1 and 2,000 characters.";
      progress.className = "progress error";
      return;
    }

    const body = { text };
    if (language) body.targetLanguage = language.value;

    pending = true;
    submit.disabled = true;
    input.disabled = true;
    if (language) language.disabled = true;
    form.setAttribute("aria-busy", "true");

    result.hidden = true;
    replayPayload = null;
    payloadSection.hidden = true;
    payloadSection.open = false;
    payloadDisplay.textContent = "";
    copyStatus.textContent = "";
    progress.className = "progress";
    progress.textContent = "Waiting for Gemini and trace delivery…";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      // Provider errors use HTTP 502 but still have a structured result.
      if (data.providerResult && data.delivery && data.execution) {
        render(data);
        progress.textContent = "Request finished.";
      } else {
        progress.className = "progress error";
        progress.textContent = typeof data.error === "string"
          ? data.error
          : "The demo could not process this request.";
      }
    } catch {
      progress.className = "progress error";
      progress.textContent =
        "Unable to retrieve the result. The request may have completed; " +
        "submitting again starts a new provider call.";
    } finally {
      pending = false;
      submit.disabled = false;
      input.disabled = false;
      if (language) language.disabled = false;
      form.setAttribute("aria-busy", "false");
    }
  });

  copyButton.addEventListener("click", async () => {
    if (replayPayload === null) return;

    try {
      await navigator.clipboard.writeText(replayPayload);
      copyStatus.textContent = "Trace payload copied.";
    } catch {
      copyStatus.textContent =
        "Clipboard access unavailable. Select and copy the payload above.";
    }
  });
}

setupPanel("chat", "/demo/chat");
setupPanel("translation", "/demo/translate");
