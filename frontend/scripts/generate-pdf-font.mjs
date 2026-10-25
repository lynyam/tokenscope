// Usage : node scripts/generate-pdf-font.mjs
// Régénère le module TypeScript contenant la police en base64 pour jsPDF.
import { readFileSync, writeFileSync } from "node:fs";

const dir = "src/features/analytics/fonts";
const base64 = readFileSync(`${dir}/DejaVuSans.ttf`).toString("base64");
writeFileSync(
  `${dir}/dejavu-sans.font.ts`,
  "// Fichier généré par scripts/generate-pdf-font.mjs — ne pas modifier à la main.\n" +
    "// DejaVu Sans — licence : DejaVuSans-LICENSE.txt\n" +
    `export const DEJAVU_SANS_BASE64 =\n  "${base64}";\n`,
);
console.log(`dejavu-sans.font.ts généré (${base64.length} caractères)`);
