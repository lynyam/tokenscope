import { formatUtcInstant, parseUtcInstant, validatePeriod } from "../../api/trace-filters";

// Period selection for the dashboard. The validation rules (UTC instants, from < to,
// 90 days maximum) come from the shared trace-filters module; nothing is re-implemented here.

export type PeriodPreset = "24h" | "7d" | "30d";

export type DashboardPeriod = { from: string; to: string };

export type CustomPeriodResult =
  | { ok: true; period: DashboardPeriod }
  | { ok: false; message: string };

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const PRESET_DURATION_MS: Record<PeriodPreset, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
};

/**
 * Picking a preset resolves ONE exact period, right now. It does not slide afterwards:
 * only picking the preset again resolves a new period.
 */
export function resolvePreset(preset: PeriodPreset, now: Date = new Date()): DashboardPeriod {
  const end = now.getTime();
  return {
    from: formatUtcInstant(end - PRESET_DURATION_MS[preset]),
    to: formatUtcInstant(end),
  };
}

const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;

// <input type="datetime-local"> gives "2026-10-05T14:30". It is read as UTC.
function toInstantText(value: string): string {
  const text = value.trim();
  if (!DATETIME_LOCAL.test(text)) return text;
  return text.length === 16 ? text + ":00.000Z" : text + "Z";
}

/**
 * Validates a custom range typed by the user. An invalid range is reported with a message;
 * it is never replaced by a default period.
 */
export function resolveCustomPeriod(from: string, to: string): CustomPeriodResult {
  const start = toInstantText(from);
  const end = toInstantText(to);
  const message = validatePeriod(start, end);
  if (message !== null) return { ok: false, message };
  // validatePeriod guarantees both are valid instants: normalize them to the canonical form.
  return {
    ok: true,
    period: { from: formatUtcInstant(parseUtcInstant(start)!), to: formatUtcInstant(parseUtcInstant(end)!) },
  };
}
