import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LIMITS, TRACE_PAGE_SIZES, validatePeriod } from "../../api/trace-filters";
import type { ModelChoices } from "../../api/traces.api";
import type { TraceListQuery, TraceStatus } from "../../types/trace.types";

export const SEARCH_DEBOUNCE_MS = 300;

export type ChoicesState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; choices: ModelChoices };

export type QueryPatch = Partial<Pick<TraceListQuery, "q" | "provider" | "model" | "workflow" | "status" | "pageSize" | "from" | "to">>;

interface Props {
  query: TraceListQuery;
  choices: ChoicesState;
  onChange: (patch: QueryPatch, options?: { replace?: boolean }) => void;
  onReset: () => void;
  onRetryChoices: () => void;
}

const SELECT = "h-9 w-full rounded-md border bg-transparent px-2 text-sm";
const toInput = (iso: string) => iso.slice(0, 19);
function fromInput(value: string): string {
  const withSeconds = value.length === 16 ? value + ":00" : value;
  return withSeconds + ".000Z";
}

function withCurrent(options: string[], current: string | undefined): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

export function TraceFilterForm({ query, choices, onChange, onReset, onRetryChoices }: Props) {
  const [qDraft, setQDraft] = useState(query.q ?? "");
  const [workflowDraft, setWorkflowDraft] = useState(query.workflow ?? "");
  const [fromDraft, setFromDraft] = useState(toInput(query.from));
  const [toDraft, setToDraft] = useState(toInput(query.to));
  const [periodError, setPeriodError] = useState<string | null>(null);

  // Back/Forward, Reset and canonicalization update the controls.
  useEffect(() => { setQDraft(query.q ?? ""); }, [query.q]);
  useEffect(() => { setWorkflowDraft(query.workflow ?? ""); }, [query.workflow]);
  useEffect(() => { setFromDraft(toInput(query.from)); setToDraft(toInput(query.to)); setPeriodError(null); }, [query.from, query.to]);

  useEffect(() => {
    const value = qDraft.trim();
    if (value === (query.q ?? "")) return;
    const timer = setTimeout(() => onChange({ q: value || undefined }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qDraft, query.q]);

  useEffect(() => {
    const value = workflowDraft.trim();
    if (value === (query.workflow ?? "")) return;
    const timer = setTimeout(() => onChange({ workflow: value || undefined }, { replace: true }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowDraft, query.workflow]);

  function applyPeriod(event: FormEvent) {
    event.preventDefault();
    if (!fromDraft || !toDraft) { setPeriodError("Enter both dates as UTC instants."); return; }
    const from = fromInput(fromDraft);
    const to = fromInput(toDraft);
    const error = validatePeriod(from, to);
    if (error) { setPeriodError(error); return; }
    setPeriodError(null);
    onChange({ from, to });
  }

  const ready = choices.phase === "ready" ? choices.choices : null;
  const providers = withCurrent(ready?.providers ?? [], query.provider);
  const models = withCurrent(
    query.provider ? ready?.modelsByProvider[query.provider] ?? [] : [...new Set(Object.values(ready?.modelsByProvider ?? {}).flat())].sort(),
    query.model,
  );

  return (
    <form className="space-y-4 rounded-lg border p-4" aria-label="Trace filters" onSubmit={applyPeriod}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="trace-search">Search</Label>
          <Input id="trace-search" type="search" maxLength={LIMITS.q} value={qDraft}
            onChange={event => setQDraft(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trace-workflow">Workflow</Label>
          <Input id="trace-workflow" maxLength={LIMITS.workflow} value={workflowDraft}
            onChange={event => setWorkflowDraft(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trace-status">Status</Label>
          <select id="trace-status" className={SELECT} value={query.status ?? ""}
            onChange={event => onChange({ status: (event.target.value || undefined) as TraceStatus | undefined })}>
            <option value="">All statuses</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="trace-provider">Provider</Label>
          <select id="trace-provider" className={SELECT} value={query.provider ?? ""}
            onChange={event => onChange({ provider: event.target.value || undefined, model: undefined })}>
            <option value="">All providers</option>
            {providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="trace-model">Model</Label>
          <select id="trace-model" className={SELECT} value={query.model ?? ""}
            onChange={event => onChange({ model: event.target.value || undefined })}>
            <option value="">All models</option>
            {models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="trace-page-size">Rows per page</Label>
          <select id="trace-page-size" className={SELECT} value={query.pageSize}
            onChange={event => onChange({ pageSize: Number(event.target.value) })}>
            {TRACE_PAGE_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </div>
      </div>

      {choices.phase === "error" && (
        <p role="alert" className="text-sm text-destructive">
          Provider and model choices could not be loaded.{" "}
          <button type="button" className="underline" onClick={onRetryChoices}>Retry choices</button>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="trace-from">From (UTC)</Label>
          <Input id="trace-from" type="datetime-local" step={1} value={fromDraft}
            onChange={event => setFromDraft(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="trace-to">To (UTC)</Label>
          <Input id="trace-to" type="datetime-local" step={1} value={toDraft}
            onChange={event => setToDraft(event.target.value)} />
        </div>
        <div className="flex items-end gap-2">
          <Button type="submit">Apply period</Button>
          <Button type="button" variant="outline" onClick={onReset}>Reset</Button>
        </div>
      </div>
      {periodError && <p role="alert" className="text-sm text-destructive">{periodError}</p>}
    </form>
  );
}
