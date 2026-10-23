import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardExportControls } from "@/features/analytics/DashboardExportControls";
import { downloadBlob } from "@/features/analytics/download";
import { buildDashboardPdf } from "@/features/analytics/export-pdf";
import type { AnalyticsSnapshot, DashboardExportInput } from "@/features/analytics/export.types";
import { clearAuthSession, saveAccessToken } from "@/api/auth-session";
import { loadPdfFont } from "@/features/analytics/pdf-font";
import { readEvaluationFixture } from "../../api/helpers/evaluation-fixtures";
const goldenJson = JSON.parse(readEvaluationFixture("responses/analytics-golden.json"));
const emptyJson = JSON.parse(readEvaluationFixture("responses/analytics-empty.json"));

// ---------------------------------------------------------------- doublures
// Téléchargement : on enregistre l'appel au lieu de télécharger.
vi.mock("@/features/analytics/download", () => ({ downloadBlob: vi.fn() }));
// Police : chaque test décide quand elle « finit de charger ».
vi.mock("@/features/analytics/pdf-font", () => ({ loadPdfFont: vi.fn() }));
// PDF : on remplace le rendu jsPDF par un Blob contenant l'entrée capturée,
// pour vérifier exactement QUELLES données ont été exportées.
vi.mock("@/features/analytics/export-pdf", () => ({
  buildDashboardPdf: vi.fn(
    (input: DashboardExportInput) =>
      new Blob([JSON.stringify(input)], { type: "application/pdf" }),
  ),
}));
// Le CSV, lui, est le vrai (synchrone et rapide).

// ---------------------------------------------------------------- fixtures
const golden = goldenJson as AnalyticsSnapshot;
const empty = emptyJson as AnalyticsSnapshot;
const project = { id: golden.projectId, name: "Support Golden" };
const otherProject = { id: empty.projectId, name: "Empty Project" };

/** Promesse contrôlée à la main depuis le test. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const csvButton = () => screen.getByRole("button", { name: /export csv/i });
const pdfButton = () => screen.getByRole("button", { name: /export pdf/i });

/** Contenu du dernier fichier « téléchargé ». */
async function lastDownload() {
  const [blob, filename] = vi.mocked(downloadBlob).mock.calls.at(-1)!;
  return { text: await blob.text(), filename };
}

beforeEach(() => {
  saveAccessToken("export-test-session");
  vi.mocked(downloadBlob).mockReset();
  vi.mocked(buildDashboardPdf).mockClear();
  vi.mocked(loadPdfFont).mockReset().mockResolvedValue("font-base64");
});

// ---------------------------------------------------------------- éligibilité

describe("éligibilité", () => {
  it("désactive les boutons sans snapshot correspondant", () => {
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={null} canExport={false} />);
    expect(csvButton()).toBeDisabled();
    expect(pdfButton()).toBeDisabled();
  });

  it("n'exporte pas l'ancien périmètre après un échec de changement de filtre", () => {
    // Le dashboard garde l'ancien snapshot affiché, mais l'export n'est plus autorisé.
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport={false} />);
    fireEvent.click(csvButton());
    fireEvent.click(pdfButton());
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("autorise l'export d'un snapshot vide valide", async () => {
    render(<DashboardExportControls selectionKey="golden" project={otherProject} snapshot={empty} canExport />);
    fireEvent.click(csvButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect((await lastDownload()).text).toContain("Empty Project");
  });

  it("signale les données obsolètes mais permet l'export du snapshot affiché", async () => {
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport isStale />);
    expect(screen.getByText(/may be out of date/i)).toHaveTextContent(golden.generatedAt);
    fireEvent.click(csvButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  });
});

// ---------------------------------------------------------------- export

describe("export", () => {
  it("télécharge un CSV avec les données affichées et le bon nom de fichier", async () => {
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />);
    fireEvent.click(csvButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    const { text, filename } = await lastDownload();
    expect(filename).toMatch(/^tokenscope-dashboard-\d{8}T\d{6}Z\.csv$/);
    expect(text).toContain("0.015350000000");
    expect(text).toContain("Support Golden");
  });

  it("affiche « Exporting… » pendant la génération du PDF puis télécharge", async () => {
    const font = deferred<string>();
    vi.mocked(loadPdfFont).mockReturnValue(font.promise);
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />);

    fireEvent.click(pdfButton());
    expect(screen.getByRole("button", { name: /exporting/i })).toHaveAttribute("aria-busy", "true");
    expect(csvButton()).toBeDisabled();

    await act(async () => font.resolve("font-base64"));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect((await lastDownload()).filename).toMatch(/\.pdf$/);
    expect(pdfButton()).toBeEnabled();
  });

  it("ne lance qu'un seul export malgré des clics répétés", async () => {
    const font = deferred<string>();
    vi.mocked(loadPdfFont).mockReturnValue(font.promise);
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />);

    fireEvent.click(pdfButton());
    fireEvent.click(screen.getByRole("button", { name: /exporting/i }));
    fireEvent.click(csvButton());

    await act(async () => font.resolve("font-base64"));
    expect(loadPdfFont).toHaveBeenCalledTimes(1);
    expect(buildDashboardPdf).toHaveBeenCalledTimes(1);
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("exporte le snapshot capturé même si une mise à jour arrive pendant la génération", async () => {
    const font = deferred<string>();
    vi.mocked(loadPdfFont).mockReturnValue(font.promise);
    const { rerender } = render(
      <DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />,
    );

    fireEvent.click(pdfButton());

    // Rafraîchissement temps réel de la même sélection pendant la génération.
    const refreshed: AnalyticsSnapshot = {
      ...structuredClone(golden),
      snapshotId: "80000000-0000-4000-8000-000000000099",
      summary: { ...golden.summary, traceCount: 7, estimatedCostUsd: "0.017450000000" },
    };
    rerender(<DashboardExportControls selectionKey="golden" project={project} snapshot={refreshed} canExport />);

    await act(async () => font.resolve("font-base64"));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const exported = JSON.parse((await lastDownload()).text) as DashboardExportInput;
    expect(exported.snapshot.snapshotId).toBe(golden.snapshotId);
    expect(exported.snapshot.summary.estimatedCostUsd).toBe("0.015350000000");
  });
});

// ---------------------------------------------------------------- erreurs

describe("erreurs", () => {
  it("affiche une erreur avec Retry, sans téléchargement, puis réussit au nouvel essai", async () => {
    vi.mocked(buildDashboardPdf).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />);

    fireEvent.click(pdfButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/export failed/i);
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(pdfButton()).toBeEnabled();
    expect(csvButton()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("affiche une erreur si la police ne se charge pas", async () => {
    vi.mocked(loadPdfFont).mockRejectedValueOnce(new Error("chunk load failed"));
    render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />);
    fireEvent.click(pdfButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(/export failed/i);
    expect(csvButton()).toBeEnabled();
    expect(pdfButton()).toBeEnabled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("ne télécharge jamais si le projet ne correspond pas au snapshot", async () => {
    render(<DashboardExportControls selectionKey="golden" project={otherProject} snapshot={golden} canExport />);
    fireEvent.click(csvButton());
    expect(csvButton()).toBeDisabled();
    expect(pdfButton()).toBeDisabled();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------- abandon

describe("abandon d'un export en attente", () => {
  async function startPdfThen(change: (r: ReturnType<typeof render>) => void) {
    const font = deferred<string>();
    vi.mocked(loadPdfFont).mockReturnValue(font.promise);
    const view = render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />);
    fireEvent.click(pdfButton());
    change(view);
    await act(async () => font.resolve("font-base64"));
    return view;
  }

  it("après navigation vers un autre projet", async () => {
    await startPdfThen(({ rerender }) =>
      rerender(<DashboardExportControls selectionKey="golden" project={otherProject} snapshot={empty} canExport />),
    );
    expect(downloadBlob).not.toHaveBeenCalled();
    // Les boutons du nouveau projet sont utilisables tout de suite.
    expect(pdfButton()).toBeEnabled();
  });

  it("après déconnexion ou perte d'accès (export plus autorisé)", async () => {
    await startPdfThen(({ rerender }) =>
      rerender(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport={false} />),
    );
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(pdfButton()).toBeDisabled();
  });

  it("après démontage du composant", async () => {
    await startPdfThen(({ unmount }) => unmount());
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});

// These cases use the shared session store, not a simulated canExport=false prop.
it.each(["logout", "replacement login"])("discards a pending PDF after %s before a rerender", async action => {
  const font = deferred<string>();
  vi.mocked(loadPdfFont).mockReturnValue(font.promise);
  render(<DashboardExportControls selectionKey="golden" project={project} snapshot={golden} canExport />);
  fireEvent.click(pdfButton());
  await act(async () => {
    if (action === "logout") clearAuthSession();
    else saveAccessToken("another-session");
    font.resolve("font-base64");
  });
  expect(buildDashboardPdf).not.toHaveBeenCalled();
  expect(downloadBlob).not.toHaveBeenCalled();
});

it("discards a pending PDF when the applied selection changes even if eligibility stays true", async () => {
  const font = deferred<string>();
  vi.mocked(loadPdfFont).mockReturnValue(font.promise);
  const { rerender } = render(
    <DashboardExportControls selectionKey="selection-a" project={project} snapshot={golden} canExport />,
  );
  fireEvent.click(pdfButton());
  rerender(<DashboardExportControls selectionKey="selection-b" project={project} snapshot={golden} canExport />);
  await act(async () => font.resolve("font-base64"));
  expect(downloadBlob).not.toHaveBeenCalled();
  expect(pdfButton()).toBeEnabled();
});
