import { ApiError, apiDelete, apiGet, requestBlob, uploadMultipart, type UploadProgress } from "./http-client";
import type { DocumentListParams, DocumentListResponse, DocumentMediaType, DocumentSummary } from "../types/document.types";

const MEDIA_TYPES: readonly string[] = ["application/pdf", "text/plain", "text/markdown"];

function documentsPath(organizationId: string, projectId: string): string {
  return "/organizations/" + encodeURIComponent(organizationId) +
    "/projects/" + encodeURIComponent(projectId) + "/documents";
}

function documentPath(organizationId: string, projectId: string, documentId: string): string {
  return documentsPath(organizationId, projectId) + "/" + encodeURIComponent(documentId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDocumentSummary(value: unknown): value is DocumentSummary {
  return isRecord(value) &&
    typeof value.id === "string" && value.id !== "" &&
    typeof value.projectId === "string" &&
    typeof value.originalName === "string" &&
    typeof value.mediaType === "string" && MEDIA_TYPES.includes(value.mediaType) &&
    isCount(value.sizeBytes) &&
    typeof value.createdAt === "string";
}

// The shared transport proves "JSON"; only this adapter can prove the document shapes.
function invalidResponse(): ApiError {
  return new ApiError(undefined, "INVALID_API_RESPONSE", "The server returned an unexpected response.");
}

function parseSummary(value: unknown): DocumentSummary {
  if (!isDocumentSummary(value)) throw invalidResponse();
  return value;
}

function parseList(value: unknown): DocumentListResponse {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(isDocumentSummary) ||
      !isCount(value.page) || !isCount(value.pageSize) || !isCount(value.total) || !isCount(value.totalPages)) {
    throw invalidResponse();
  }
  return value as unknown as DocumentListResponse;
}

export async function listDocuments(
  organizationId: string,
  projectId: string,
  params: DocumentListParams = {},
  signal?: AbortSignal,
): Promise<DocumentListResponse> {
  const query = new URLSearchParams();
  // Only the supported pagination parameters are ever serialized.
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.pageSize !== undefined) query.set("pageSize", String(params.pageSize));
  const suffix = query.size > 0 ? "?" + query.toString() : "";
  return parseList(await apiGet<unknown>(documentsPath(organizationId, projectId) + suffix, { signal }));
}

export interface UploadDocumentOptions {
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

export async function uploadDocument(
  organizationId: string,
  projectId: string,
  file: File,
  options: UploadDocumentOptions = {},
): Promise<DocumentSummary> {
  // Exactly one field named "file"; the browser adds the multipart boundary.
  const body = new FormData();
  body.append("file", file);
  return parseSummary(await uploadMultipart<unknown>(documentsPath(organizationId, projectId), body, options));
}

export interface DocumentContentOptions {
  download?: boolean;
  signal?: AbortSignal;
}

export function getDocumentContent(
  organizationId: string,
  projectId: string,
  documentId: string,
  options: DocumentContentOptions = {},
): Promise<Blob> {
  return requestBlob(
    documentPath(organizationId, projectId, documentId) + "/content?download=" + (options.download ? "true" : "false"),
    { signal: options.signal },
  );
}

export function deleteDocument(
  organizationId: string,
  projectId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<void> {
  return apiDelete(documentPath(organizationId, projectId, documentId), { signal });
}

export type { DocumentMediaType };
