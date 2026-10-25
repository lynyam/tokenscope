const SAFE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERROR_MESSAGES = {
  "400:VALIDATION_ERROR": "Trace payload rejected: integration validation error.",
  "400:MODEL_PRICE_NOT_FOUND": "Trace rejected: missing pricing catalogue configuration.",
  "401:INVALID_API_KEY": "Trace rejected: invalid or revoked key, or inaccessible project.",
  "409:TRACE_EXTERNAL_ID_CONFLICT": "Trace rejected: conflicting execution ID.",
  "409:TRACE_DELETED": "Trace rejected: this execution ID cannot be reused.",
  "429:RATE_LIMITED": "Trace delivery rate limit reached."
};

async function sendTrace({ baseUrl, apiKey, payload, fetchImpl = fetch }) {
  const signal = AbortSignal.timeout(10_000);
  let httpStatus = null;
  let requestId = null;

  try {
    const response = await fetchImpl(
      `${baseUrl.replace(/\/+$/, "")}/api/v1/public/traces`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey
        },
        body: JSON.stringify(payload),
        signal
      }
    );

    httpStatus = response.status;
    const headerId = response.headers.get("X-Request-Id");
    if (typeof headerId === "string" && SAFE_ID.test(headerId)) {
      requestId = headerId;
    }

    // Some failures, such as proxy errors, may return non-JSON bodies.
    let body = null;
    try {
      body = await response.json();
    } catch {
      if (signal.aborted) throw new Error("timeout");
    }

    if (!requestId && typeof body?.requestId === "string" &&
        SAFE_ID.test(body.requestId)) {
      requestId = body.requestId;
    }

    if (httpStatus === 200 || httpStatus === 201) {
      const traceId = typeof body?.id === "string" && UUID.test(body.id)
        ? body.id
        : null;

      return {
        state: httpStatus === 201 ? "sent" : "already_recorded",
        message: httpStatus === 201 ? "Trace sent." : "Trace already recorded.",
        httpStatus,
        traceId,
        requestId,
        warning: traceId ? null : "TokenScope did not return a valid trace ID."
      };
    }

    const errorKey = `${httpStatus}:${body?.code}`;
    const knownError = Object.hasOwn(ERROR_MESSAGES, errorKey);

    const rawRetryAfter = response.headers.get("Retry-After");
    const retryAfterSeconds =
      httpStatus === 429 &&
      typeof rawRetryAfter === "string" &&
      /^\d{1,9}$/.test(rawRetryAfter)
        ? Number(rawRetryAfter)
        : null;

    return {
      state: "failed",
      message: knownError
        ? ERROR_MESSAGES[errorKey]
        : httpStatus >= 500
          ? "Trace delivery failed: TokenScope is temporarily unavailable."
          : "Trace delivery was rejected by TokenScope.",
      httpStatus,
      code: knownError ? body.code : null,
      requestId,
      retryAfterSeconds
    };
  } catch {
    return {
      state: "failed",
      message: signal.aborted
        ? "Trace delivery timed out. Storage status is unknown."
        : "Trace delivery failed. Storage status is unknown.",
      httpStatus,
      requestId
    };
  }
}

module.exports = { sendTrace };
