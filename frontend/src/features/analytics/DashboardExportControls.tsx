import { Button } from "@/components/ui/button";
import type { AnalyticsSnapshot } from "./export.types";
import { EXPORT_ERROR_MESSAGE, useDashboardExport } from "./useDashboardExport";

type Props = {
  /** Projet chargé et autorisé (jamais un paramètre d'URL). */
  project: { id: string; name: string } | null;
  /** Snapshot confirmé actuellement affiché. */
  snapshot: AnalyticsSnapshot | null;
  /** Éligibilité calculée par le dashboard (TSE-76). */
  canExport: boolean;
  selectionKey: string | null;
  /** Données du même périmètre marquées obsolètes. */
  isStale?: boolean;
};

export function DashboardExportControls({ project, snapshot, canExport, selectionKey, isStale = false }: Props) {
  const { busy, failed, exportCsv, exportPdf, retry } = useDashboardExport({
    project,
    snapshot,
    canExport,
    selectionKey,
  });

  const disabled = !canExport || !selectionKey || !project || !snapshot ||
    project.id !== snapshot.projectId || busy !== null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={disabled} aria-busy={busy === "csv"} onClick={exportCsv}>
          {busy === "csv" ? "Exporting…" : "Export CSV"}
        </Button>
        <Button variant="outline" size="sm" disabled={disabled} aria-busy={busy === "pdf"} onClick={exportPdf}>
          {busy === "pdf" ? "Exporting…" : "Export PDF"}
        </Button>
      </div>

      {isStale && snapshot && (
        <p className="text-xs text-muted-foreground">
          Displayed data may be out of date. Exports use the data shown, generated at {snapshot.generatedAt}.
        </p>
      )}

      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {EXPORT_ERROR_MESSAGE}{" "}
          <Button variant="link" size="xs" disabled={disabled} onClick={retry}>
            Retry
          </Button>
        </p>
      )}
    </div>
  );
}
