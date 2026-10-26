/**
 * tokenscope-dashboard-YYYYMMDDTHHmmssZ.<ext>
 * Ne contient jamais le nom du projet (pas de texte utilisateur dans un nom de fichier).
 */
export function exportFilename(extension: "csv" | "pdf", at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `tokenscope-dashboard-${stamp}.${extension}`;
}
