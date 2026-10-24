import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { exportFilename } from "./export-filename";
import type { DashboardExportInput } from "./export.types";

// ============================================================================
// 1. MODÈLE — fonction pure, toute la logique est ici (facile à tester)
// ============================================================================

export const PDF_TITLE = "tokenscope report";
export const NO_FILTERS_TEXT = "No additional filters.";
export const NO_OBSERVATIONS_TEXT = "No observations";
export const NO_MODEL_DATA_TEXT = "No model data for this period.";
export const COST_LABEL = "Estimated cost (USD)";
export const REPORT_NOTE =
  "Costs are recorded estimates, not invoices. Evaluation fixtures may use synthetic pricing.";

export const MODEL_HEAD = ["Provider", "Model", "Traces", "Input tokens", "Output tokens", COST_LABEL];
export const SERIES_HEAD = ["Bucket start (UTC)", "Traces", "Input tokens", "Output tokens", COST_LABEL];

type Pair = [label: string, value: string];

export type PdfModel = {
  title: string;
  snapshotId: string;
  metadata: Pair[];
  /** Vide → afficher NO_FILTERS_TEXT */
  filters: Pair[];
  summary: Pair[];
  models: string[][];
  series: string[][];
  note: string;
};

/**
 * Coût pour l'affichage PDF, sans jamais passer par Number :
 *  "0.015350000000" → "0.01535"
 *  "0.000000000001" → "0.000000000001"   (les petites valeurs restent visibles)
 *  "0.000000000000" → "0.00"
 * Toute valeur inattendue est rendue telle quelle plutôt que transformée.
 */
export function formatCostForPdf(value: string): string {
  const match = /^(-?\d+)\.(\d+)$/.exec(value);
  if (!match) return value;
  const decimals = match[2].replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}.${decimals}`;
}

function orNoObservations(value: number | null): string {
  return value === null ? NO_OBSERVATIONS_TEXT : String(value);
}

export function buildPdfModel(input: DashboardExportInput): PdfModel {
  const { project, snapshot } = input;

  if (project.id !== snapshot.projectId) {
    throw new Error("Export refusé : le projet ne correspond pas au snapshot.");
  }

  const f = snapshot.filters;
  const filters: Pair[] = (
    [
      ["Search", f.q],
      ["Provider", f.provider],
      ["Model", f.model],
      ["Workflow", f.workflow],
      ["Status", f.status],
    ] as Array<[string, string | null]>
  ).filter((p): p is Pair => p[1] !== null && p[1] !== "");

  const s = snapshot.summary;

  return {
    title: PDF_TITLE,
    snapshotId: snapshot.snapshotId,
    metadata: [
      ["Project", project.name],
      ["Project ID", project.id],
      ["Snapshot ID", snapshot.snapshotId],
      ["Generated at", snapshot.generatedAt],
      ["Period (UTC)", `${snapshot.window.from} to ${snapshot.window.to} (end exclusive)`],
      ["Timezone", snapshot.window.timezone],
      ["Bucket", snapshot.window.bucket],
    ],
    filters,
    summary: [
      ["Traces", String(s.traceCount)],
      ["Input tokens", s.inputTokens],
      ["Output tokens", s.outputTokens],
      ["Total tokens", s.totalTokens],
      [COST_LABEL, formatCostForPdf(s.estimatedCostUsd)],
      ["Errors", String(s.errorCount)],
      ["Error rate (%)", orNoObservations(s.errorRatePct)],
      ["Average latency (ms)", orNoObservations(s.averageLatencyMs)],
    ],
    models: snapshot.byModel.map((m) => [
      m.provider,
      m.model,
      String(m.traceCount),
      m.inputTokens,
      m.outputTokens,
      formatCostForPdf(m.estimatedCostUsd),
    ]),
    series: snapshot.series.map((b) => [
      b.bucketStart,
      String(b.traceCount),
      b.inputTokens,
      b.outputTokens,
      formatCostForPdf(b.estimatedCostUsd),
    ]),
    note: REPORT_NOTE,
  };
}

// ============================================================================
// 2. RENDU — aucune décision métier, on dessine le modèle
// ============================================================================

const FONT_FILE = "DejaVuSans.ttf";
const FONT = "DejaVuSans";
const MARGIN = 40;
const HEADER_SPACE = 64; // place réservée en haut de page pour l'en-tête courant
const FOOTER_SPACE = 48;
const ACCENT: [number, number, number] = [43, 87, 151];
const MUTED: [number, number, number] = [95, 107, 122];

/** Police embarquée (base64) — aucun téléchargement externe à l'exécution. */
export function renderDashboardPdf(model: PdfModel, fontBase64: string): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.addFileToVFS(FONT_FILE, fontBase64);
  doc.addFont(FONT_FILE, FONT, "normal");
  doc.setFont(FONT, "normal");

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - 2 * MARGIN;
  const tableMargin = { top: HEADER_SPACE, bottom: FOOTER_SPACE, left: MARGIN, right: MARGIN };
  const baseStyles = {
    font: FONT,
    fontStyle: "normal" as const,
    fontSize: 9,
    overflow: "linebreak" as const, // retour à la ligne des textes longs
    cellPadding: 4,
  };

  let y = HEADER_SPACE;
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  /** Passe à la page suivante si la place manque. */
  function ensureSpace(needed: number) {
    if (y + needed > pageHeight - FOOTER_SPACE) {
      doc.addPage();
      y = HEADER_SPACE;
    }
  }

  function heading(text: string) {
    ensureSpace(40);
    doc.setFontSize(12);
    doc.setTextColor(...ACCENT);
    doc.text(text, MARGIN, y + 12);
    doc.setTextColor(0, 0, 0);
    y += 20;
  }

  function paragraph(text: string, size = 9, color: [number, number, number] = [0, 0, 0]) {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(text, contentWidth) as string[];
    const lineHeight = size * 1.35;
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, MARGIN, y + size);
      y += lineHeight;
    }
    doc.setTextColor(0, 0, 0);
    y += 6;
  }

  function keyValueTable(rows: Pair[]) {
    autoTable(doc, {
      startY: y,
      margin: tableMargin,
      theme: "plain",
      body: rows,
      rowPageBreak: "avoid",
      styles: baseStyles,
      columnStyles: { 0: { cellWidth: 130, textColor: MUTED } },
    });
    y = lastY() + 14;
  }

  function dataTable(head: string[], body: string[][], numericFrom: number, firstColumnMin = 75) {
    // Largeurs minimales : un nom très long ne doit pas écraser les colonnes de chiffres.
    const columnStyles: Record<number, { halign?: "right"; minCellWidth: number }> = {};
    for (let i = 0; i < head.length; i++) {
      columnStyles[i] =
        i < numericFrom
          ? { minCellWidth: i === 0 ? firstColumnMin : 75 }
          : { halign: "right", minCellWidth: 62 };
    }
    autoTable(doc, {
      startY: y,
      margin: tableMargin,
      theme: "striped",
      head: [head],
      body,
      showHead: "everyPage", // en-têtes de colonnes répétés à chaque page
      rowPageBreak: "avoid", // une ligne n'est jamais coupée entre deux pages
      styles: baseStyles,
      headStyles: { font: FONT, fontStyle: "normal", fillColor: ACCENT, textColor: 255 },
      columnStyles,
    });
    y = lastY() + 18;
  }

  // ---- Titre
  doc.setFontSize(20);
  doc.text(model.title, MARGIN, y + 16);
  y += 32;

  // ---- Métadonnées
  keyValueTable(model.metadata);

  // ---- Filtres
  heading("Filters");
  if (model.filters.length === 0) {
    paragraph(NO_FILTERS_TEXT);
    y += 4;
  } else {
    keyValueTable(model.filters);
  }

  // ---- Synthèse
  heading("Summary");
  keyValueTable(model.summary);

  // ---- Par modèle
  heading("Breakdown by model");
  if (model.models.length === 0) {
    paragraph(NO_MODEL_DATA_TEXT);
    y += 4;
  } else {
    dataTable(MODEL_HEAD, model.models, 2);
  }

  // ---- Série temporelle
  heading("Time series");
  dataTable(SERIES_HEAD, model.series, 1, 135); // un horodatage ISO tient sur une ligne

  // ---- Note
  paragraph(model.note, 8, MUTED);

  // ---- En-tête et pied de page sur chaque page
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(PDF_TITLE, MARGIN, 30);
    doc.text(`Snapshot ${model.snapshotId}`, pageWidth - MARGIN, 30, { align: "right" });
    doc.setDrawColor(210, 214, 220);
    doc.line(MARGIN, 38, pageWidth - MARGIN, 38);
    doc.text(`Page ${page} / ${total}`, pageWidth - MARGIN, pageHeight - 24, { align: "right" });
  }
  doc.setTextColor(0, 0, 0);

  return doc;
}

// ============================================================================
// 3. POINT D'ENTRÉE — appelé par le bouton avec la copie capturée
// ============================================================================

export function buildDashboardPdf(input: DashboardExportInput, fontBase64: string): Blob {
  return renderDashboardPdf(buildPdfModel(input), fontBase64).output("blob");
}

export function pdfFilename(at: Date): string {
  return exportFilename("pdf", at);
}
