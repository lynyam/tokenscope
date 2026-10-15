/**
 * Déclenche le téléchargement d'un fichier local dans le navigateur.
 * Servira aussi pour le PDF (en passant directement un Blob).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // On laisse au navigateur le temps de démarrer le téléchargement avant de libérer.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function downloadCsv(csv: string, filename: string): void {
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}
