import { exportFilename } from "./export-filename";
import type { DashboardExportInput } from "./export.types";

/** Ordre exact des colonnes imposé par le ticket (section 5). */
export const CSV_COLUMNS = [
  "section",
  "snapshotId",
  "projectId",
  "projectName",
  "from",
  "to",
  "generatedAt",
  "timezone",
  "bucket",
  "q",
  "filterProvider",
  "filterModel",
  "filterWorkflow",
  "filterStatus",
  "bucketStart",
  "provider",
  "model",
  "traceCount",
  "inputTokens",
  "outputTokens",
  "estimatedCostUsd",
  "errorCount",
  "errorRatePct",
  "averageLatencyMs",
] as const;

type Column = (typeof CSV_COLUMNS)[number];
type Row = Partial<Record<Column, string>>;

/**
 * Colonnes dont le contenu peut venir d'un utilisateur (noms, filtres, labels).
 * Seules ces colonnes reçoivent la protection anti-formule : les nombres
 * (tokens, coûts, taux…) sont recopiés tels quels.
 */
const TEXT_COLUMNS = new Set<Column>([
  "projectName",
  "q",
  "filterProvider",
  "filterModel",
  "filterWorkflow",
  "filterStatus",
  "provider",
  "model",
]);

const RECORD_SEPARATOR = "\r\n";

/**
 * Commence par une tabulation / un retour chariot, ou par = + - @
 * éventuellement précédé d'espaces ou de caractères de contrôle.
 */
const FORMULA_START = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@\t\r]/;

export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

export function escapeCsvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** null / undefined → cellule vide (jamais "0"). */
function str(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function buildDashboardCsv(input: DashboardExportInput): string {
  const { project, snapshot } = input;

  if (project.id !== snapshot.projectId) {
    throw new Error("Export refusé : le projet ne correspond pas au snapshot.");
  }

  // Métadonnées répétées sur chaque ligne
  const meta: Row = {
    snapshotId: snapshot.snapshotId,
    projectId: project.id,
    projectName: project.name,
    from: snapshot.window.from,
    to: snapshot.window.to,
    generatedAt: snapshot.generatedAt,
    timezone: snapshot.window.timezone,
    bucket: snapshot.window.bucket,
    q: str(snapshot.filters.q),
    filterProvider: str(snapshot.filters.provider),
    filterModel: str(snapshot.filters.model),
    filterWorkflow: str(snapshot.filters.workflow),
    filterStatus: str(snapshot.filters.status),
  };

  const s = snapshot.summary;
  const rows: Row[] = [
    {
      ...meta,
      section: "summary",
      traceCount: str(s.traceCount),
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      estimatedCostUsd: s.estimatedCostUsd,
      errorCount: str(s.errorCount),
      errorRatePct: str(s.errorRatePct),
      averageLatencyMs: str(s.averageLatencyMs),
    },
    ...snapshot.series.map((b): Row => ({
      ...meta,
      section: "series",
      bucketStart: b.bucketStart,
      traceCount: str(b.traceCount),
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      estimatedCostUsd: b.estimatedCostUsd,
    })),
    ...snapshot.byModel.map((m): Row => ({
      ...meta,
      section: "model",
      provider: m.provider,
      model: m.model,
      traceCount: str(m.traceCount),
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      estimatedCostUsd: m.estimatedCostUsd,
    })),
  ];

  const lines = [
    CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      CSV_COLUMNS.map((col) => {
        const raw = row[col] ?? "";
        const safe = TEXT_COLUMNS.has(col) ? neutralizeFormula(raw) : raw;
        return escapeCsvCell(safe);
      }).join(","),
    ),
  ];

  return lines.join(RECORD_SEPARATOR) + RECORD_SEPARATOR;
}

/** tokenscope-dashboard-YYYYMMDDTHHmmssZ.csv (jamais le nom du projet). */
export function csvFilename(at: Date): string {
  return exportFilename("csv", at);
}
