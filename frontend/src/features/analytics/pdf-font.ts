/**
 * Charge la police Unicode embarquée dans l'application.
 *
 * Le fichier `fonts/dejavu-sans.font.ts` (≈1 Mo, généré par
 * scripts/generate-pdf-font.mjs) n'est importé qu'au premier export PDF :
 * grâce à l'import dynamique, il ne pèse pas sur le chargement du dashboard.
 * Il fait partie du bundle de l'application — aucun service externe n'est appelé.
 */
let cached: Promise<string> | null = null;

export function loadPdfFont(): Promise<string> {
  cached ??= import("./fonts/dejavu-sans.font")
    .then((m) => m.DEJAVU_SANS_BASE64)
    .catch((error) => {
      cached = null; // permet un vrai « Réessayer »
      throw error;
    });
  return cached;
}
