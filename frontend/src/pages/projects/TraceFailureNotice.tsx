import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RATE_LIMIT_COOLDOWN_SECONDS, type TraceFailure } from "./trace-failure";

/**
 * Failure feedback with a manual Retry. After a 429 the button stays disabled for a fixed cooldown
 * (the base ApiError does not expose Retry-After); nothing retries automatically.
 */
export function TraceFailureNotice({ failure, onRetry }: { failure: TraceFailure; onRetry: () => void }) {
  const [seconds, setSeconds] = useState(failure.kind === "rate-limit" ? RATE_LIMIT_COOLDOWN_SECONDS : 0);

  useEffect(() => {
    if (failure.kind !== "rate-limit") { setSeconds(0); return; }
    setSeconds(RATE_LIMIT_COOLDOWN_SECONDS);
    const timer = setInterval(() => setSeconds(value => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [failure]);

  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive/40 p-4 text-sm">
      <p>{failure.message}</p>
      <Button variant="outline" disabled={seconds > 0} onClick={onRetry}>
        {seconds > 0 ? `Retry in ${seconds}s` : "Retry"}
      </Button>
    </div>
  );
}
