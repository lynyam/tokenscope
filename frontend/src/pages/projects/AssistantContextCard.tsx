import type { AssistantContext } from "../../types/assistant.types";
import { buildContextView } from "./assistantContextView";

const CONTEXT_NOTICE =
  "This answer uses data collected when your question was submitted. It may be newer than the dashboard's previous refresh.";

// Everything is rendered as escaped plain text.
export function AssistantContextCard({ context }: { context: AssistantContext }) {
  const view = buildContextView(context);

  return (
    <section
      aria-label="Context used"
      className="rounded-md border border-border bg-muted p-3 text-xs text-foreground"
    >
      <details>
        <summary className="cursor-pointer font-semibold">Context used</summary>
        <div className="mt-2">
      <dl className="space-y-0.5 break-words">
        <div>
          <dt className="inline font-medium">Project: </dt>
          <dd className="inline">{view.projectName}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Period: </dt>
          <dd className="inline">{view.period}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Filters: </dt>
          <dd className="inline">{view.filters}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Generated at: </dt>
          <dd className="inline">{view.generatedAt}</dd>
        </div>
        {view.rows.map((row) => (
          <div key={row.label}>
            <dt className="inline font-medium">{row.label}: </dt>
            <dd className="inline">{row.value}</dd>
          </div>
        ))}
      </dl>
      {view.syntheticPricing && (
        <p className="mt-1 font-medium">Some costs use synthetic pricing.</p>
      )}
      {view.models.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer font-medium">By provider / model</summary>
          <ul className="mt-1 space-y-0.5 break-words">
            {view.models.map((model) => (
              <li key={model.name}>
                <span className="font-medium">{model.name}</span>: {model.details}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-2 text-muted-foreground">{CONTEXT_NOTICE}</p>
        </div>
      </details>
    </section>
  );
}