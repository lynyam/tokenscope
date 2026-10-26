/** Display helpers. Money is formatted by string manipulation only: never parsed into a float. */

/** "0.001800000000" -> "$0.0018"; zero -> "$0.00"; a small positive cost is never shown as "$0.00". */
export function formatCostUsd(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return "$" + whole + "." + (trimmed.length >= 2 ? trimmed : trimmed.padEnd(2, "0"));
}

/** "2026-10-01T10:00:00.250Z" -> "2026-10-01 10:00:00 UTC". */
export function formatUtcTime(iso: string): string {
  return iso.slice(0, 19).replace("T", " ") + " UTC";
}
