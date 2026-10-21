import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TraceFailure } from "./trace-failure";

/**
 * Failure feedback with a manual Retry. After a 429 the button stays disabled for the server's
 * Retry-After (a short default when it is absent); nothing retries automatically.
 */
export function TraceFailureNotice({
  failure,
  onRetry,
  retryLabel = "Retry",
}: {
  failure: TraceFailure;
  onRetry: () => void;
  retryLabel?: string;
}) {
  const [seconds, setSeconds] = useState(failure.kind === "rate-limit" ? failure.retryAfterSeconds : 0);

  useEffect(() => {
    if (failure.kind !== "rate-limit") { setSeconds(0); return; }
    setSeconds(failure.retryAfterSeconds);
    const timer = setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [failure]);

  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-4 text-sm">
      <p>{failure.message}</p>
      {failure.requestId && (
        <p className="break-all text-xs">
          Request ID: {failure.requestId}
        </p>
      )}
      <Button variant="outline" disabled={seconds > 0} onClick={onRetry}>
        {seconds > 0 ? `${retryLabel} in ${seconds}s` : retryLabel}
      </Button>
    </div>
  );
}
