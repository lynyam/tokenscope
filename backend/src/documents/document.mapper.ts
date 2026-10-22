import type { DocumentMediaType } from "./documents.constants";
import type { DocumentSummary } from "./documents.types";

// Never select storageKey or sha256 for API responses.
export const DOCUMENT_SUMMARY_SELECT = {
	id: true,
	projectId: true,
	originalName: true,
	mediaType: true,
	sizeBytes: true,
	createdAt: true,
} as const;

export function toDocumentSummary(row: {
	id: string;
	projectId: string;
	originalName: string;
	mediaType: string;
	sizeBytes: number;
	createdAt: Date;
}): DocumentSummary {
	return {
		id: row.id,
		projectId: row.projectId,
		originalName: row.originalName,
		mediaType: row.mediaType as DocumentMediaType,
		sizeBytes: row.sizeBytes,
		createdAt: row.createdAt.toISOString(),
	};
}
