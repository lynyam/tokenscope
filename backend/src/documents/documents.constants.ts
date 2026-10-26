export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10,485,760
export const MAX_DOCUMENT_NAME_BYTES = 255;

export const DOCUMENT_MEDIA_TYPES = {
	".pdf": "application/pdf",
	".txt": "text/plain",
	".md": "text/markdown",
} as const;

export type DocumentExtension = keyof typeof DOCUMENT_MEDIA_TYPES;
export type DocumentMediaType =
	(typeof DOCUMENT_MEDIA_TYPES)[DocumentExtension];
