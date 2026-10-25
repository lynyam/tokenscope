import type { DocumentMediaType } from "./documents.constants";

export type DocumentSummary = {
	id: string;
	projectId: string;
	originalName: string;
	mediaType: DocumentMediaType;
	sizeBytes: number;
	createdAt: string;
};

export type Page<T> = {
	items: T[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
};
