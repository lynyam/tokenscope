// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
  COST_LABEL,
  NO_FILTERS_TEXT,
  NO_MODEL_DATA_TEXT,
  NO_OBSERVATIONS_TEXT,
  PDF_TITLE,
  REPORT_NOTE,
  buildDashboardPdf,
  buildPdfModel,
  formatCostForPdf,
  pdfFilename,
  renderDashboardPdf,
} from "../../../src/features/analytics/export-pdf";
import type {
  AnalyticsSnapshot,
  DashboardExportInput,
} from "../../../src/features/analytics/export.types";
import goldenJson from "./fixtures/analytics-golden.json";
import emptyJson from "./fixtures/analytics-empty.json";

// ---------------------------------------------------------------- helpers

// Ce fichier tourne dans Node (lecture de la police + pdf.js), où localStorage
// n'existe pas. Le setup global du projet appelle localStorage.clear() après
// chaque test : on lui fournit un localStorage vide pour ce fichier seulement.
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      key: (index: number) => [...store.keys()][index] ?? null,
    } satisfies Storage,
  });
}

const golden = goldenJson as AnalyticsSnapshot;
const empty = emptyJson as AnalyticsSnapshot;

const goldenInput: DashboardExportInput = {
  project: { id: golden.projectId, name: "Support Golden" },
  snapshot: golden,
};
const emptyInput: DashboardExportInput = {
  project: { id: empty.projectId, name: "Empty Project" },
  snapshot: empty,
};

// Police lue depuis le disque : en test on n'a pas besoin de l'import dynamique.
const FONT = readFileSync(
  fileURLToPath(new URL("../../../src/features/analytics/fonts/DejaVuSans.ttf", import.meta.url)),
).toString("base64");

const clone = <T>(v: T): T => structuredClone(v);

function deepFreeze<T>(obj: T): T {
  Object.values(obj as object).forEach((v) => {
    if (v && typeof v === "object") deepFreeze(v);
  });
  return Object.freeze(obj);
}

/** Fixture longue : 300 buckets, 40 modèles, textes longs → plusieurs pages. */
function longInput(): DashboardExportInput {
  const snapshot = clone(golden);
  snapshot.window.bucket = "minute";
  snapshot.filters = {
    q: "refund <script>alert(1)</script>",
    provider: "fixture-a",
    model: null,
    workflow: "very-long-workflow-name-".repeat(8),
    status: "ERROR",
  };
  snapshot.series = Array.from({ length: 300 }, (_, i) => ({
    bucketStart: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(),
    traceCount: i % 3,
    inputTokens: String(i * 1000),
    outputTokens: "123456789012345678901234567890",
    estimatedCostUsd: i === 5 ? "0.000000000001" : "0.000100000000",
  }));
  snapshot.byModel = Array.from({ length: 40 }, (_, i) => ({
    provider: `provider-${i}`,
    model: `Modèle Ελληνικά Кириллица ${"x".repeat(60)}-${i}`,
    traceCount: i,
    inputTokens: "1",
    outputTokens: "2",
    estimatedCostUsd: "1.500000000000",
  }));
  return {
    project: {
      id: snapshot.projectId,
      name: `Équipe Ünïcødé — Ελληνικά — Кириллица — ${"nom-sans-espace-".repeat(8)}`,
    },
    snapshot,
  };
}

/** Rend le PDF puis relit son texte réel, page par page, avec pdf.js. */
async function renderAndRead(input: DashboardExportInput) {
  const bytes = renderDashboardPdf(buildPdfModel(input), FONT).output("arraybuffer");
  const pdf = await getDocument({ data: new Uint8Array(bytes), disableFontFace: true }).promise;
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join("\n"));
  }
  const all = pages.join("\n");
  return { pages, all, compact: all.replace(/\s+/g, "") };
}

// ---------------------------------------------------------------- modèle

describe("formatCostForPdf", () => {
  it.each([
    ["0.015350000000", "0.01535"],
    ["0.001800000000", "0.0018"],
    ["0.000000000001", "0.000000000001"],
    ["0.000000000000", "0.00"],
    ["12.500000000000", "12.50"],
    ["123456789012345678.120000000000", "123456789012345678.12"],
  ])("%s → %s", (input, expected) => {
    expect(formatCostForPdf(input)).toBe(expected);
  });

  it("ne transforme pas une valeur inattendue", () => {
    expect(formatCostForPdf("n/a")).toBe("n/a");
  });
});

describe("buildPdfModel — fixture golden", () => {
  const model = buildPdfModel(goldenInput);
  const meta = Object.fromEntries(model.metadata);
  const summary = Object.fromEntries(model.summary);

  it("contient le projet, le snapshot, la génération et la période capturés", () => {
    expect(model.title).toBe(PDF_TITLE);
    expect(meta["Project"]).toBe("Support Golden");
    expect(meta["Project ID"]).toBe(golden.projectId);
    expect(meta["Snapshot ID"]).toBe(golden.snapshotId);
    expect(meta["Generated at"]).toBe("2026-10-02T08:00:00.000Z");
    expect(meta["Period (UTC)"]).toContain("2026-10-01T00:00:00.000Z");
    expect(meta["Period (UTC)"]).toContain("2026-10-02T00:00:00.000Z");
    expect(meta["Bucket"]).toBe("hour");
    expect(meta["Timezone"]).toBe("UTC");
  });

  it("n'a aucun filtre actif", () => {
    expect(model.filters).toEqual([]);
  });

  it("donne les valeurs de synthèse exactes", () => {
    expect(summary["Traces"]).toBe("6");
    expect(summary["Input tokens"]).toBe("6000");
    expect(summary["Output tokens"]).toBe("1200");
    expect(summary["Total tokens"]).toBe("7200");
    expect(summary[COST_LABEL]).toBe("0.01535");
    expect(summary["Errors"]).toBe("2");
    expect(summary["Error rate (%)"]).toBe("33.33");
    expect(summary["Average latency (ms)"]).toBe("1833.333");
  });

  it("inclut les 24 buckets dans l'ordre et les 2 modèles", () => {
    expect(model.series).toHaveLength(24);
    expect(model.series.map((r) => r[0])).toEqual(golden.series.map((b) => b.bucketStart));
    expect(model.series[10]).toEqual(["2026-10-01T10:00:00.000Z", "1", "1000", "200", "0.0018"]);
    expect(model.models).toEqual([
      ["fixture-b", "demo-large", "3", "2500", "400", "0.0082"],
      ["fixture-a", "demo-fast", "3", "3500", "800", "0.00715"],
    ]);
  });

  it("ajoute la note neutre sur les coûts", () => {
    expect(model.note).toBe(REPORT_NOTE);
  });

  it("ne modifie pas l'entrée capturée", () => {
    expect(() => buildPdfModel(deepFreeze(clone(goldenInput)))).not.toThrow();
  });
});

describe("buildPdfModel — autres cas", () => {
  it("snapshot vide : « No observations » pour les valeurs null, aucune ligne modèle", () => {
    const model = buildPdfModel(emptyInput);
    const summary = Object.fromEntries(model.summary);
    expect(summary["Error rate (%)"]).toBe(NO_OBSERVATIONS_TEXT);
    expect(summary["Average latency (ms)"]).toBe(NO_OBSERVATIONS_TEXT);
    expect(summary[COST_LABEL]).toBe("0.00");
    expect(model.models).toEqual([]);
    expect(model.series).toHaveLength(24);
  });

  it("liste chaque filtre actif", () => {
    const input = clone(goldenInput);
    input.snapshot.filters = {
      q: "refund",
      provider: "fixture-a",
      model: null,
      workflow: "batch",
      status: "ERROR",
    };
    expect(buildPdfModel(input).filters).toEqual([
      ["Search", "refund"],
      ["Provider", "fixture-a"],
      ["Workflow", "batch"],
      ["Status", "ERROR"],
    ]);
  });

  it("refuse un projet qui ne correspond pas au snapshot", () => {
    expect(() =>
      buildPdfModel({ ...goldenInput, project: { id: "other", name: "X" } }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------- rendu réel

describe("PDF généré — fixture golden", () => {
  it("contient réellement les métadonnées, la synthèse et toutes les lignes", async () => {
    const { all, compact, pages } = await renderAndRead(goldenInput);
    expect(all).toContain(PDF_TITLE);
    expect(all).toContain("Support Golden");
    expect(all).toContain(golden.projectId);
    expect(all).toContain(golden.snapshotId);
    expect(all).toContain("2026-10-02T08:00:00.000Z");
    expect(all).toContain(NO_FILTERS_TEXT);
    expect(all).toContain(COST_LABEL);
    expect(all).toContain("0.01535");
    expect(all).toContain("1833.333");
    for (const b of golden.series) expect(all).toContain(b.bucketStart);
    for (const m of golden.byModel) {
      expect(all).toContain(m.provider);
      expect(all).toContain(m.model);
    }
    expect(compact).toContain(REPORT_NOTE.replace(/\s+/g, ""));
    pages.forEach((text, i) => expect(text).toContain(`Page ${i + 1} / ${pages.length}`));
  });

  it("buildDashboardPdf renvoie un Blob PDF", async () => {
    const blob = buildDashboardPdf(goldenInput, FONT);
    expect(blob.type).toBe("application/pdf");
    const head = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()).slice(0, 5));
    expect(head).toBe("%PDF-");
  });
});

describe("PDF généré — cas difficiles", () => {
  it("snapshot vide lisible", async () => {
    const { all } = await renderAndRead(emptyInput);
    expect(all).toContain("Empty Project");
    expect(all).toContain(NO_OBSERVATIONS_TEXT);
    expect(all).toContain(NO_MODEL_DATA_TEXT);
  });

  it("fixture longue : plusieurs pages, aucune ligne perdue, Unicode et texte brut", async () => {
    const input = longInput();
    const { pages, compact } = await renderAndRead(input);

    expect(pages.length).toBeGreaterThan(5);
    pages.forEach((text, i) => {
      expect(text).toContain(`Page ${i + 1} / ${pages.length}`);
      expect(text).toContain(PDF_TITLE); // en-tête courant
    });

    // Chaque bucket et chaque modèle est présent (texte compacté : les cellules longues passent à la ligne)
    for (const b of input.snapshot.series) expect(compact).toContain(b.bucketStart);
    for (const m of input.snapshot.byModel) expect(compact).toContain(m.model.replace(/\s+/g, ""));

    // Unicode du nom de projet rendu par la police embarquée
    expect(compact).toContain("ÉquipeÜnïcødé—Ελληνικά—Кириллица");
    // Texte utilisateur affiché tel quel, jamais interprété
    expect(compact).toContain("refund<script>alert(1)</script>");
    // Petite valeur non nulle toujours visible
    expect(compact).toContain("0.000000000001");
    // Grand entier intact
    expect(compact).toContain("123456789012345678901234567890");
  });
});

describe("pdfFilename", () => {
  it("suit le format tokenscope-dashboard-YYYYMMDDTHHmmssZ.pdf", () => {
    expect(pdfFilename(new Date("2026-10-15T17:05:09.123Z"))).toBe(
      "tokenscope-dashboard-20261015T170509Z.pdf",
    );
  });
});