import { ApiError } from "../../api/http-client";
import type { DocumentMediaType } from "../../types/document.types";

export const MAX_DOCUMENT_BYTES = 10_485_760;
export const MAX_FILENAME_BYTES = 255;
export const PREVIEW_TEXT_BYTES = 100 * 1024;
export const FILE_INPUT_ACCEPT = ".pdf,.txt,.md";
export const SCOPE_STATEMENT = "Documents are stored privately for project members. They are not used by the assistant.";

const EXTENSIONS = [".pdf", ".txt", ".md"];
const MEDIA_TYPE_LABELS: Record<DocumentMediaType, string> = {
  "application/pdf": "PDF",
  "text/plain": "Text",
  "text/markdown": "Markdown",
};
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARACTERS = /[\u0000-\u001f\u007f/\\]/;

/** Basic selection checks only: the backend validates content authoritatively. */
export function validateDocumentFile(file: File): string | null {
  const name = file.name;
  if (name.trim() === "") return "The file name must not be blank.";
  if (name === "." || name === "..") return "This file name is not allowed.";
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) return "The file name must not contain path separators or control characters.";
  if (new TextEncoder().encode(name).length > MAX_FILENAME_BYTES) return "The file name is too long (255 bytes maximum).";
  const lower = name.toLowerCase();
  // File.type is deliberately ignored: it may be empty or inconsistent for valid files.
  if (!EXTENSIONS.some(extension => lower.endsWith(extension))) return "Choose a PDF, TXT or Markdown (.md) file.";
  if (file.size === 0) return "This file is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return "This file is larger than the 10 MiB limit.";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

export function mediaTypeLabel(mediaType: DocumentMediaType): string {
  return MEDIA_TYPE_LABELS[mediaType];
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function blobMatchesMediaType(blob: Blob, expected: DocumentMediaType): boolean {
  return blob.type.split(";")[0].trim().toLowerCase() === expected;
}

export interface PreviewText {
  text: string;
  truncated: boolean;
}

/**
 * Decodes at most the first 100 KiB as UTF-8. A multi-byte character cut by the limit is dropped
 * (stream mode buffers it); genuinely invalid bytes throw a TypeError (fatal decoding).
 */
export async function readPreviewText(blob: Blob): Promise<PreviewText> {
  const truncated = blob.size > PREVIEW_TEXT_BYTES;
  const bytes = await blob.slice(0, PREVIEW_TEXT_BYTES).arrayBuffer();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return { text: decoder.decode(bytes, { stream: truncated }), truncated };
}

/** Maps API failures to meaningful messages; never exposes raw server text beyond the safe envelope. */
export function documentErrorMessage(error: unknown, action: "upload" | "list" | "preview" | "download" | "delete"): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "VALIDATION_ERROR": {
        const detail = error.details?.flatMap(item => item.messages).join(" ");
        return detail || "The server rejected this file. Choose a different file.";
      }
      case "PAYLOAD_TOO_LARGE": return "This file is larger than the 10 MiB limit.";
      case "UNSUPPORTED_MEDIA_TYPE": return "Only PDF, TXT and Markdown files are supported.";
      case "INVALID_DOCUMENT_CONTENT": return "The file could not be read or its content is not supported. Choose another file.";
      case "RATE_LIMITED": return "Too many uploads. Wait a moment, then try again.";
      case "STORAGE_UNAVAILABLE": return "Document storage is temporarily unavailable. Please try again shortly.";
      case "CONCURRENT_MODIFICATION": return "The project changed while this was in progress. Please try again.";
      case "DOCUMENT_NOT_FOUND": return "This document is no longer available.";
      case "PROJECT_NOT_FOUND": return "This project is no longer available.";
      case "INSUFFICIENT_ORGANIZATION_ROLE": return "Your role no longer allows managing documents.";
      case "NETWORK_ERROR": return "Unable to reach the server. Please try again.";
    }
  }
  const fallback = {
    upload: "The upload failed. Please try again.",
    list: "Failed to load documents.",
    preview: "Failed to load the preview.",
    download: "Failed to download the document.",
    delete: "Failed to delete the document.",
  } as const;
  return fallback[action];
}

export function isApiError(error: unknown, code: string, status?: number): boolean {
  return error instanceof ApiError && error.code === code && (status === undefined || error.statusCode === status);
}
