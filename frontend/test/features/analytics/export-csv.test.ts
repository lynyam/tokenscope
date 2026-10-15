import { describe, expect, it } from "vitest";
import {
  CSV_COLUMNS,
  buildDashboardCsv,
  csvFilename,
  escapeCsvCell,
  neutralizeFormula,
} from "../../../src/features/analytics/export-csv";
import type {
  AnalyticsSnapshot,
  DashboardExportInput,
} from "../../../src/features/analytics/export.types";
import goldenJson from "./fixtures/analytics-golden.json";
import emptyJson from "./fixtures/analytics-empty.json";

// ---------------------------------------------------------------- helpers

const golden = goldenJson as AnalyticsSnapshot;
const empty = emptyJson as AnalyticsSnapshot;

// Noms tirés de identities.json
const goldenInput: DashboardExportInput = {
  project: { id: golden.projectId, name: "Support Golden" },
  snapshot: golden,
};
const emptyInput: DashboardExportInput = {
  project: { id: empty.projectId, name: "Empty Project" },
  snapshot: empty,
};

function clone<T>(v: T): T {
  return structuredClone(v);
}

function deepFreeze<T>(obj: T): T {
  Object.values(obj as object).forEach((v) => {
    if (v && typeof v === "object") deepFreeze(v);
  });
  return Object.freeze(obj);
}

/** Parseur CSV minimal (RFC 4180) utilisé uniquement pour vérifier la sortie. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else {
      cell += c;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Renvoie les lignes sous forme d'objets { colonne: valeur }. */
function records(csv: string): Record<string, string>[] {
  const [header, ...data] = parseCsv(csv);
  return data.map((cells) =>
    Object.fromEntries(header.map((h, i) => [h, cells[i]])),
  );
}

// ---------------------------------------------------------------- tests

describe("buildDashboardCsv — fixture golden", () => {
  const csv = buildDashboardCsv(goldenInput);
  const rows = records(csv);

  it("utilise exactement l'en-tête du ticket", () => {
    expect(parseCsv(csv)[0]).toEqual([...CSV_COLUMNS]);
  });

  it("contient 1 summary, 24 lignes de série et 2 lignes de modèle", () => {
    expect(rows).toHaveLength(27);
    expect(rows.filter((r) => r.section === "summary")).toHaveLength(1);
    expect(rows.filter((r) => r.section === "series")).toHaveLength(24);
    expect(rows.filter((r) => r.section === "model")).toHaveLength(2);
  });

  it("chaque ligne a le même nombre de cellules que l'en-tête", () => {
    for (const cells of parseCsv(csv)) {
      expect(cells).toHaveLength(CSV_COLUMNS.length);
    }
  });

  it("conserve exactement les valeurs du summary", () => {
    const s = rows.find((r) => r.section === "summary")!;
    expect(s.estimatedCostUsd).toBe("0.015350000000");
    expect(s.inputTokens).toBe("6000");
    expect(s.outputTokens).toBe("1200");
    expect(s.traceCount).toBe("6");
    expect(s.errorCount).toBe("2");
    expect(s.errorRatePct).toBe("33.33");
    expect(s.averageLatencyMs).toBe("1833.333");
    expect(s.bucketStart).toBe("");
    expect(s.provider).toBe("");
    expect(s.model).toBe("");
  });

  it("répète les métadonnées sur toutes les lignes", () => {
    for (const r of rows) {
      expect(r.snapshotId).toBe(golden.snapshotId);
      expect(r.projectId).toBe(golden.projectId);
      expect(r.projectName).toBe("Support Golden");
      expect(r.from).toBe("2026-10-01T00:00:00.000Z");
      expect(r.to).toBe("2026-10-02T00:00:00.000Z");
      expect(r.generatedAt).toBe("2026-10-02T08:00:00.000Z");
      expect(r.timezone).toBe("UTC");
      expect(r.bucket).toBe("hour");
      // Aucun filtre actif dans la golden
      expect(r.q).toBe("");
      expect(r.filterProvider).toBe("");
      expect(r.filterModel).toBe("");
      expect(r.filterWorkflow).toBe("");
      expect(r.filterStatus).toBe("");
    }
  });

  it("recopie chaque bucket de la série dans l'ordre, y compris ceux à zéro", () => {
    const series = rows.filter((r) => r.section === "series");
    golden.series.forEach((b, i) => {
      expect(series[i].bucketStart).toBe(b.bucketStart);
      expect(series[i].traceCount).toBe(String(b.traceCount));
      expect(series[i].inputTokens).toBe(b.inputTokens);
      expect(series[i].outputTokens).toBe(b.outputTokens);
      expect(series[i].estimatedCostUsd).toBe(b.estimatedCostUsd);
      // Pas de valeurs d'erreur/latence par bucket dans le snapshot → vide
      expect(series[i].errorCount).toBe("");
      expect(series[i].errorRatePct).toBe("");
      expect(series[i].averageLatencyMs).toBe("");
    });
    expect(series[0].estimatedCostUsd).toBe("0.000000000000");
    expect(series[10].estimatedCostUsd).toBe("0.001800000000");
  });

  it("recopie les lignes byModel dans provider/model, pas dans les filtres", () => {
    const models = rows.filter((r) => r.section === "model");
    expect(models.map((m) => [m.provider, m.model, m.estimatedCostUsd])).toEqual([
      ["fixture-b", "demo-large", "0.008200000000"],
      ["fixture-a", "demo-fast", "0.007150000000"],
    ]);
    for (const m of models) {
      expect(m.filterProvider).toBe("");
      expect(m.filterModel).toBe("");
      expect(m.bucketStart).toBe("");
    }
  });

  it("utilise CRLF entre les lignes et termine par CRLF", () => {
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("ne modifie pas l'entrée capturée", () => {
    const frozen = deepFreeze(clone(goldenInput));
    expect(() => buildDashboardCsv(frozen)).not.toThrow();
  });
});

describe("buildDashboardCsv — snapshot vide", () => {
  const rows = records(buildDashboardCsv(emptyInput));

  it("fonctionne : 1 summary, 24 buckets à zéro, aucune ligne modèle", () => {
    expect(rows).toHaveLength(25);
    expect(rows.filter((r) => r.section === "model")).toHaveLength(0);
  });

  it("laisse vides les moyennes/taux null (pas de 0)", () => {
    const s = rows[0];
    expect(s.errorRatePct).toBe("");
    expect(s.averageLatencyMs).toBe("");
    expect(s.estimatedCostUsd).toBe("0.000000000000");
    expect(s.errorCount).toBe("0");
  });
});

describe("buildDashboardCsv — filtres actifs", () => {
  it("écrit chaque filtre dans sa colonne sur toutes les lignes", () => {
    const input = clone(goldenInput);
    input.snapshot.filters = {
      q: "refund",
      provider: "fixture-a",
      model: "demo-fast",
      workflow: "batch",
      status: "ERROR",
    };
    for (const r of records(buildDashboardCsv(input))) {
      expect(r.q).toBe("refund");
      expect(r.filterProvider).toBe("fixture-a");
      expect(r.filterModel).toBe("demo-fast");
      expect(r.filterWorkflow).toBe("batch");
      expect(r.filterStatus).toBe("ERROR");
    }
  });
});

describe("buildDashboardCsv — texte difficile", () => {
  it("échappe guillemets, virgules, sauts de ligne et garde l'Unicode", () => {
    const input = clone(goldenInput);
    const name = 'Équipe "東京", v2\nligne 2';
    (input.project as { name: string }).name = name;
    input.snapshot.byModel[0].model = "modèle, \"spécial\"";
    const rows = records(buildDashboardCsv(input));
    expect(rows[0].projectName).toBe(name);
    expect(rows.find((r) => r.section === "model")!.model).toBe('modèle, "spécial"');
  });

  it.each([
    ["=HYPERLINK(\"http://x\")"],
    ["+1+1"],
    ["-2+3"],
    ["@SUM(A1)"],
    ["\tcmd"],
    ["\rcmd"],
    ["   =1+1"],
    ["\u0001=1+1"],
    [" \t@x"],
  ])("neutralise le texte de type formule %j", (evil) => {
    const input = clone(goldenInput);
    (input.project as { name: string }).name = evil;
    input.snapshot.filters.workflow = evil;
    input.snapshot.byModel[0].provider = evil;
    const rows = records(buildDashboardCsv(input));
    expect(rows[0].projectName).toBe(`'${evil}`);
    expect(rows[0].filterWorkflow).toBe(`'${evil}`);
    expect(rows.find((r) => r.section === "model")!.provider).toBe(`'${evil}`);
  });

  it("ne touche pas au texte normal", () => {
    expect(neutralizeFormula("Support Golden")).toBe("Support Golden");
    expect(neutralizeFormula("a=b")).toBe("a=b");
    expect(neutralizeFormula("")).toBe("");
  });
});

describe("buildDashboardCsv — précision", () => {
  it("conserve les très grands entiers de tokens sans perte", () => {
    const input = clone(goldenInput);
    input.snapshot.summary.inputTokens = "123456789012345678901234567890";
    const s = records(buildDashboardCsv(input))[0];
    expect(s.inputTokens).toBe("123456789012345678901234567890");
  });

  it("conserve les 12 décimales des petits coûts", () => {
    const input = clone(goldenInput);
    input.snapshot.series[0].estimatedCostUsd = "0.000000000001";
    const series = records(buildDashboardCsv(input)).filter((r) => r.section === "series");
    expect(series[0].estimatedCostUsd).toBe("0.000000000001");
  });
});

describe("garde-fous", () => {
  it("refuse un projet qui ne correspond pas au snapshot", () => {
    const input = { ...goldenInput, project: { id: "other", name: "X" } };
    expect(() => buildDashboardCsv(input)).toThrow();
  });

  it("escapeCsvCell ne met des guillemets que si nécessaire", () => {
    expect(escapeCsvCell("abc")).toBe("abc");
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });
});

describe("csvFilename", () => {
  it("suit le format tokenscope-dashboard-YYYYMMDDTHHmmssZ.csv", () => {
    expect(csvFilename(new Date("2026-10-15T17:05:09.123Z"))).toBe(
      "tokenscope-dashboard-20261015T170509Z.csv",
    );
  });
});
