import { describe, expect, it } from "vitest";
import {
  MAX_DOCUMENT_BYTES, PREVIEW_TEXT_BYTES, formatBytes, readPreviewText, validateDocumentFile,
} from "@/pages/documents/document-file";

const file = (name: string, size = 10, type = "") => {
  const result = new File(["x"], name, { type });
  Object.defineProperty(result, "size", { value: size });
  return result;
};

describe("validateDocumentFile", () => {
  it.each(["a.pdf", "A.PDF", "notes.txt", "README.MD", "résumé.md", "double.name.txt"])("accepts %s", name => {
    expect(validateDocumentFile(file(name))).toBeNull();
  });

  it("does not reject a valid file only because File.type is empty or inconsistent", () => {
    expect(validateDocumentFile(file("a.pdf", 10, ""))).toBeNull();
    expect(validateDocumentFile(file("a.pdf", 10, "image/png"))).toBeNull();
  });

  it("accepts the exact size limit and rejects zero and over-limit sizes", () => {
    expect(validateDocumentFile(file("a.txt", MAX_DOCUMENT_BYTES))).toBeNull();
    expect(validateDocumentFile(file("a.txt", MAX_DOCUMENT_BYTES + 1))).toMatch(/10 MiB/);
    expect(validateDocumentFile(file("a.txt", 0))).toMatch(/empty/);
  });

  it.each([
    ["", /blank/], ["   ", /blank/], [".", /not allowed/], ["..", /not allowed/],
    ["a/b.txt", /path separators/], ["a\\b.txt", /path separators/], ["a\u0000.txt", /control/], ["a\n.txt", /control/],
    ["a.exe", /PDF, TXT/], ["noextension", /PDF, TXT/], ["a.pdf.html", /PDF, TXT/],
  ])("rejects the name %j", (name, message) => {
    expect(validateDocumentFile(file(name))).toMatch(message);
  });

  it("limits the filename to 255 UTF-8 bytes, not characters", () => {
    expect(validateDocumentFile(file("a".repeat(251) + ".txt"))).toBeNull();      // 255 bytes
    expect(validateDocumentFile(file("a".repeat(252) + ".txt"))).toMatch(/too long/);
    expect(validateDocumentFile(file("é".repeat(126) + ".txt"))).toMatch(/too long/); // 252 + 4 = 256 bytes
  });
});

describe("formatBytes", () => {
  it.each([[0, "0 B"], [1023, "1023 B"], [1024, "1 KiB"], [1536, "1.5 KiB"], [10_485_760, "10 MiB"]])("%i → %s", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("readPreviewText", () => {
  it("returns short text whole", async () => {
    await expect(readPreviewText(new Blob(["héllo\n<b>x</b>"]))).resolves.toEqual({ text: "héllo\n<b>x</b>", truncated: false });
  });

  it("truncates to 100 KiB and drops a multi-byte character cut at the boundary", async () => {
    // 'é' is 2 bytes: starting at an odd offset puts its first byte exactly on the last allowed byte.
    const text = "a" + "é".repeat(PREVIEW_TEXT_BYTES);
    const result = await readPreviewText(new Blob([text]));
    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain("�");
    expect(result.text.startsWith("aé")).toBe(true);
    expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(PREVIEW_TEXT_BYTES);
  });

  it("treats genuinely invalid UTF-8 as an error", async () => {
    await expect(readPreviewText(new Blob([new Uint8Array([0x61, 0xff, 0xfe, 0x62])]))).rejects.toBeInstanceOf(TypeError);
  });
});
