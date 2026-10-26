/**
 * Déclenche le téléchargement d'un fichier local dans le navigateur.
 * Servira aussi pour le PDF (en passant directement un Blob).
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // On laisse au navigateur le temps de démarrer le téléchargement avant de libérer.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
