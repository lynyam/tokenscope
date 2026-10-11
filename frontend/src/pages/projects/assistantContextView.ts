import type { AssistantContext } from "../../types/assistant.types";

export const NO_OBSERVATIONS = "No observations";

export type ContextRow = { label: string; value: string };
export type ContextModelRow = { name: string; details: string };
export type ContextView = {
  projectName: string;
  period: string;
  filters: string;
  generatedAt: string;
  syntheticPricing: boolean;
  rows: ContextRow[];
  models: ContextModelRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Text for display. null / missing means "unknown" and is never shown as 0.
function show(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return NO_OBSERVATIONS;
}

// "7200" -> "7,200". Works on the string: the exact value is never converted to a number.
function groupDigits(value: string): string {
  return /^\d+$/.test(value) ? value.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : value;
}

function tokens(value: unknown): string {
  return typeof value === "string" ? groupDigits(value) : show(value);
}

// "0.015350000000" -> "$0.01535". Trailing zeros are removed (at least 2 decimals stay),
// so a tiny positive cost is never shown as $0.00.
export function formatUsd(value: unknown): string {
  if (typeof value !== "string" || !/^\d+\.\d+$/.test(value)) return show(value);
  const [integer, fraction] = value.split(".");
  let trimmed = fraction.replace(/0+$/, "");
  if (trimmed.length < 2) trimmed = trimmed.padEnd(2, "0");
  return "$" + groupDigits(integer) + "." + trimmed;
}

function activeFilters(filters: unknown): string {
  if (!isRecord(filters)) return "No filters";
  const active = Object.entries(filters).filter(
    ([, value]) => typeof value === "string" && value !== "",
  );
  return active.length === 0
    ? "No filters"
    : active.map(([key, value]) => key + ": " + String(value)).join(" · ");
}

export function buildContextView(context: AssistantContext): ContextView {
  const project = isRecord(context.project) ? context.project : {};
  const window = isRecord(context.window) ? context.window : {};
  const summary = isRecord(context.summary) ? context.summary : {};
  const pricing = isRecord(context.pricing) ? context.pricing : {};

  const errorRate =
    typeof summary.errorRatePct === "number" ? summary.errorRatePct + "%" : NO_OBSERVATIONS;
  const latency =
    typeof summary.averageLatencyMs === "number" ? summary.averageLatencyMs + " ms" : NO_OBSERVATIONS;

  const models = (Array.isArray(context.byModel) ? context.byModel : [])
    .filter(isRecord)
    .map((item) => ({
      name: show(item.provider) + "/" + show(item.model),
      details:
        show(item.traceCount) +
        " traces · " +
        formatUsd(item.estimatedCostUsd) +
        " · " +
        tokens(item.inputTokens) +
        " in / " +
        tokens(item.outputTokens) +
        " out",
    }));

  return {
    projectName: show(project.name),
    period: show(window.from) + " → " + show(window.to) + " (UTC)",
    filters: activeFilters(context.filters),
    generatedAt: show(context.generatedAt),
    syntheticPricing: pricing.containsSyntheticPricing === true,
    rows: [
      { label: "Matching traces", value: show(summary.traceCount) },
      { label: "Estimated cost", value: formatUsd(summary.estimatedCostUsd) },
      {
        label: "Tokens",
        value:
          tokens(summary.inputTokens) +
          " in · " +
          tokens(summary.outputTokens) +
          " out · " +
          tokens(summary.totalTokens) +
          " total",
      },
      { label: "Errors", value: show(summary.errorCount) },
      { label: "Error rate", value: errorRate },
      { label: "Average latency", value: latency },
    ],
    models,
  };
}