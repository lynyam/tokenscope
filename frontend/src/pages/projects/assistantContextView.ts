import type { AssistantContext } from "../../types/assistant.types";

import { formatCostUsd, formatCount, NO_OBSERVATIONS } from "./dashboardFormat";
export { NO_OBSERVATIONS } from "./dashboardFormat";

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

function tokens(value: unknown): string {
  return typeof value === "string" ? formatCount(value) : show(value);
}

export function formatUsd(value: unknown): string {
  return typeof value === "string" ? formatCostUsd(value) : NO_OBSERVATIONS;
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
  const { project, window, summary, pricing } = context;

  const errorRate =
    typeof summary.errorRatePct === "number" ? summary.errorRatePct + "%" : NO_OBSERVATIONS;
  const latency =
    typeof summary.averageLatencyMs === "number" ? summary.averageLatencyMs + " ms" : NO_OBSERVATIONS;

  const models = context.byModel
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