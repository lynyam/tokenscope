import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TraceFailureNotice } from "./TraceFailureNotice";
import { LIMITS } from "../../api/trace-filters";
import type { DashboardPeriod, PeriodPreset } from "./dashboardPeriod";
import { PERIOD_PRESET_LABELS } from "./dashboardPeriod";
import type { FilterDraft } from "./dashboardSelection";
import type { ChoicesState } from "./TraceFilterForm";

export const FILTER_DEBOUNCE_MS = 300;

const SELECT = "h-9 w-full rounded-md border bg-transparent px-2 text-sm";
const PRESETS: PeriodPreset[] = ["24h", "7d", "30d"];

const toInput = (iso: string) => iso.slice(0, -1);
const withCurrent = (options: string[], current: string) =>
  current && !options.includes(current) ? [current, ...options] : options;

interface Props {
  period: DashboardPeriod;
  /** The preset that produced the period, or "custom". */
  preset: PeriodPreset | "custom";
  filters: FilterDraft;
  choices: ChoicesState;
  /** Messages explaining why the typed selection was not applied. */
  errors: string[];
  refreshing: boolean;
  onPreset: (preset: PeriodPreset) => void;
  /** Returns an error message, or null when the custom period was applied. */
  onApplyCustom: (from: string, to: string) => string | null;
  onFilterChange: (patch: Partial<FilterDraft>) => void;
  onReset: () => void;
  onRefresh: () => void;
  onRetryChoices: () => void;
}

export function DashboardControls({
  period, preset, filters, choices, errors, refreshing,
  onPreset, onApplyCustom, onFilterChange, onReset, onRefresh, onRetryChoices,
}: Props) {
  const [fromDraft, setFromDraft] = useState(toInput(period.from));
  const [toDraft, setToDraft] = useState(toInput(period.to));
  const [customError, setCustomError] = useState<string | null>(null);
  const [qDraft, setQDraft] = useState(filters.q);
  const [workflowDraft, setWorkflowDraft] = useState(filters.workflow);
  const onFilterChangeRef = useRef(onFilterChange);
  useEffect(() => { onFilterChangeRef.current = onFilterChange; }, [onFilterChange]);

  // A preset, Reset or an applied custom period updates the date inputs.
  useEffect(() => {
    setFromDraft(toInput(period.from));
    setToDraft(toInput(period.to));
    setCustomError(null);
  }, [period.from, period.to]);
  useEffect(() => { setQDraft(filters.q); }, [filters.q]);
  useEffect(() => { setWorkflowDraft(filters.workflow); }, [filters.workflow]);

  useEffect(() => {
    if (qDraft === filters.q) return;
    const timer = setTimeout(() => onFilterChangeRef.current({ q: qDraft }), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [qDraft, filters.q]);
  useEffect(() => {
    if (workflowDraft === filters.workflow) return;
    const timer = setTimeout(() => onFilterChangeRef.current({ workflow: workflowDraft }), FILTER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [workflowDraft, filters.workflow]);

  function applyCustom(event: FormEvent) {
    event.preventDefault();
    setCustomError(onApplyCustom(fromDraft, toDraft));
  }

  const ready = choices.phase === "ready" ? choices.choices : null;
  const providers = withCurrent(ready?.providers ?? [], filters.provider);
  const models = withCurrent(
    filters.provider
      ? ready?.modelsByProvider[filters.provider] ?? []
      : [...new Set(Object.values(ready?.modelsByProvider ?? {}).flat())].sort(),
    filters.model,
  );

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div role="group" aria-label="Period" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(item => (
            <Button key={item} type="button" size="sm" variant={preset === item ? "default" : "outline"}
              aria-pressed={preset === item} onClick={() => onPreset(item)}>
              {PERIOD_PRESET_LABELS[item]}
            </Button>
          ))}
        </div>
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" aria-label="Custom period" onSubmit={applyCustom}>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="dashboard-from">From (UTC)</Label>
            <Input id="dashboard-from" type="datetime-local" step={0.001} value={fromDraft}
              onChange={event => setFromDraft(event.target.value)} />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="dashboard-to">To (UTC)</Label>
            <Input id="dashboard-to" type="datetime-local" step={0.001} value={toDraft}
              onChange={event => setToDraft(event.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit" variant={preset === "custom" ? "default" : "outline"}>Apply period</Button>
          </div>
        </form>
        {customError && <p role="alert" className="text-sm text-destructive">{customError}</p>}
        <p className="text-xs text-muted-foreground" data-testid="applied-period">
          Applied: {period.from} → {period.to} UTC
        </p>
      </div>

      <div role="group" aria-label="Filters" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="dashboard-search">Search</Label>
          <Input id="dashboard-search" type="search" maxLength={LIMITS.q} value={qDraft}
            onChange={event => setQDraft(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dashboard-workflow">Workflow</Label>
          <Input id="dashboard-workflow" maxLength={LIMITS.workflow} value={workflowDraft}
            onChange={event => setWorkflowDraft(event.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dashboard-status">Status</Label>
          <select id="dashboard-status" className={SELECT} value={filters.status}
            onChange={event => onFilterChange({ status: event.target.value })}>
            <option value="">All statuses</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dashboard-provider">Provider</Label>
          <select id="dashboard-provider" className={SELECT} value={filters.provider}
            // A model of another provider would give an impossible combination: clear it.
            onChange={event => onFilterChange({ provider: event.target.value, model: "" })}>
            <option value="">All providers</option>
            {providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dashboard-model">Model</Label>
          <select id="dashboard-model" className={SELECT} value={filters.model}
            onChange={event => onFilterChange({ model: event.target.value })}>
            <option value="">All models</option>
            {models.map(model => <option key={model} value={model}>{model}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="button" variant="outline" onClick={onReset}>Reset</Button>
          <Button type="button" variant="outline" disabled={refreshing} onClick={onRefresh}>
            {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </div>

      {choices.phase === "error" && (
        <div className="space-y-2">
          <p>Provider and model choices could not be loaded.</p>
          <TraceFailureNotice failure={choices.failure} onRetry={onRetryChoices} retryLabel="Retry choices" />
        </div>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
          {errors.map(message => <li key={message}>{message}</li>)}
        </ul>
      )}
    </div>
  );
}
