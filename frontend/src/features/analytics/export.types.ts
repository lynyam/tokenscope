import type { AnalyticsSnapshot } from "../../types/analytics.types";
export type { AnalyticsSnapshot } from "../../types/analytics.types";

/**
 * Entrée capturée au clic (contrat : docs/API.md, « Dashboard exports — TSE-77 »).
 * Les générateurs n'utilisent que ça.
 */
export type DashboardExportInput = Readonly<{
  project: Readonly<{ id: string; name: string }>;
  snapshot: AnalyticsSnapshot;
}>;
