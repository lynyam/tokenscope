export function ProductPreview() {
  return (
    <figure
      aria-labelledby="preview-caption"
      className="mt-12 overflow-hidden rounded-xl border border-border bg-card"
    >
      <figcaption
        id="preview-caption"
        className="border-b border-border px-6 py-4"
      >
        <p className="font-semibold">A closer look at your AI spending</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Illustrative preview · Fictional data · Analytics coming soon
        </p>
      </figcaption>

      <div className="grid md:grid-cols-2">
        <div className="min-w-0 p-6 sm:p-8">
          <h3 className="text-lg font-semibold">Estimated cost by workflow</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Example project · Last 7 days · USD
          </p>

          <p className="mt-6 text-4xl font-semibold tracking-tight">
            $120.00
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Total estimated cost
          </p>

          <ul className="mt-8 space-y-6">
            <li>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span>Customer support</span>
                <span>$72.00 · 60%</span>
              </div>
              <div
                aria-hidden="true"
                className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-[60%] rounded-full bg-chart-1" />
              </div>
            </li>

            <li>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span>Document summaries</span>
                <span>$36.00 · 30%</span>
              </div>
              <div
                aria-hidden="true"
                className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-[30%] rounded-full bg-chart-2" />
              </div>
            </li>

            <li>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span>Internal search</span>
                <span>$12.00 · 10%</span>
              </div>
              <div
                aria-hidden="true"
                className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full w-[10%] rounded-full bg-chart-3" />
              </div>
            </li>
          </ul>
        </div>

        <div className="min-w-0 border-t border-border bg-background/40 p-6 sm:p-8 md:border-l md:border-t-0">
          <h3 className="text-lg font-semibold">Inside one request</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Customer support · Example trace
          </p>

          <dl className="mt-6 divide-y divide-border text-sm">
            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="text-right">Demo model</dd>
            </div>

            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Input tokens</dt>
              <dd>12,000</dd>
            </div>

            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Output tokens</dt>
              <dd>800</dd>
            </div>

            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Response time</dt>
              <dd>2.4 seconds</dd>
            </div>

            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd>Completed</dd>
            </div>

            <div className="flex justify-between gap-4 py-3">
              <dt className="text-muted-foreground">Estimated cost</dt>
              <dd className="font-semibold">$0.036</dd>
            </div>
          </dl>

          <div className="mt-6 rounded-lg border border-border p-4">
            <p className="text-sm font-semibold">
              A starting point for investigation
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              This request used 15 times more input tokens than output
              tokens. Reviewing its prompt and included documents could
              help explain the input volume.
            </p>
          </div>
        </div>
      </div>
    </figure>
  );
}