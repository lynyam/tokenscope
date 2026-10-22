/** TSE-78 contract. docs/API.md is the canonical description of these shapes. */
export type DocumentMediaType = "application/pdf" | "text/plain" | "text/markdown";

export interface DocumentSummary {
  id: string;
  projectId: string;
  originalName: string;
  mediaType: DocumentMediaType;
  sizeBytes: number;
  createdAt: string;
}

export interface DocumentListResponse {
  items: DocumentSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface DocumentListParams {
  page?: number;
  pageSize?: number;
}
