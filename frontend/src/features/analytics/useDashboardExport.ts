import { useCallback, useEffect, useRef, useState } from "react";
import { buildDashboardCsv } from "./export-csv";
import { exportFilename } from "./export-filename";
import { buildDashboardPdf } from "./export-pdf";
import type { AnalyticsSnapshot } from "./export.types";
import { downloadBlob } from "./download";
import { loadPdfFont } from "./pdf-font";

export type ExportFormat = "csv" | "pdf";

export const EXPORT_ERROR_MESSAGE = "Export failed. Your dashboard was not changed.";

type Options = {
  project: { id: string; name: string } | null;
  snapshot: AnalyticsSnapshot | null;
  /** Décidé par le dashboard (TSE-76) : sélection appliquée, accès valide, pas de chargement. */
  canExport: boolean;
};

/**
 * Logique des boutons d'export (TSE-77) :
 * - capture une copie figée au clic, puis n'utilise plus que cette copie ;
 * - un seul export à la fois (verrou par ref, comme dans ProjectDetailPage) ;
 * - un export devenu obsolète (projet changé, export plus autorisé, composant
 *   démonté) est jeté au lieu d'être téléchargé ;
 * - une erreur n'affecte que l'export : message + Retry.
 */
export function useDashboardExport({ project, snapshot, canExport }: Options) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [failed, setFailed] = useState<ExportFormat | null>(null);

  const pending = useRef(false);
  // Change à chaque fois qu'un export en cours doit être abandonné.
  const generation = useRef(0);

  const projectId = project?.id ?? null;

  useEffect(() => {
    // Au changement de projet, à la perte du droit d'exporter (déconnexion,
    // perte d'accès, changement de sélection) ou au démontage :
    // l'export en cours devient obsolète.
    return () => {
      generation.current += 1;
      pending.current = false;
      setBusy(null);
      setFailed(null);
    };
  }, [projectId, canExport]);

  const run = useCallback(
    async (format: ExportFormat) => {
      if (pending.current || !canExport || !project || !snapshot) return;

      pending.current = true;
      setBusy(format);
      setFailed(null);
      const myGeneration = generation.current;
      const isCurrent = () => myGeneration === generation.current;

      try {
        // 1. Capture : plus rien de ce qui change à l'écran n'est lu ensuite.
        const input = structuredClone({
          project: { id: project.id, name: project.name },
          snapshot,
        });

        // 2. Génération à partir de la copie uniquement.
        const blob =
          format === "csv"
            ? new Blob([buildDashboardCsv(input)], { type: "text/csv;charset=utf-8" })
            : buildDashboardPdf(input, await loadPdfFont());

        // 3. Projet changé, accès perdu ou page quittée entre-temps : on jette.
        if (!isCurrent()) return;

        // 4. Téléchargement local.
        downloadBlob(blob, exportFilename(format, new Date()));
      } catch {
        if (isCurrent()) setFailed(format);
      } finally {
        if (isCurrent()) {
          pending.current = false;
          setBusy(null);
        }
      }
    },
    [canExport, project, snapshot],
  );

  const exportCsv = useCallback(() => void run("csv"), [run]);
  const exportPdf = useCallback(() => void run("pdf"), [run]);
  const retry = useCallback(() => {
    if (failed) void run(failed);
  }, [failed, run]);

  return { busy, failed, exportCsv, exportPdf, retry };
}
