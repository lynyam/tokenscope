import { HttpStatus } from "@nestjs/common";
import { PDFParse } from "pdf-parse";
import { ApiException } from "../common/errors/api.exception";
import {
	DOCUMENT_MEDIA_TYPES,
	MAX_DOCUMENT_NAME_BYTES,
	type DocumentExtension,
	type DocumentMediaType,
} from "./documents.constants";

// Lone UTF-16 surrogates cannot be encoded as UTF-8.
const LONE_SURROGATE =
	/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function validationError(message: string): ApiException {
	return new ApiException(
		HttpStatus.BAD_REQUEST,
		"VALIDATION_ERROR",
		"Request validation failed.",
		[{ field: "file", messages: [message] }],
	);
}

function invalidContent(message: string): ApiException {
	return new ApiException(
		HttpStatus.UNPROCESSABLE_ENTITY,
		"INVALID_DOCUMENT_CONTENT",
		message,
	);
}

/** Validates the client file name and returns it unchanged. */
export function validateDocumentName(name: unknown): string {
	if (typeof name !== "string" || name.length === 0) {
		throw validationError("The file name is required.");
	}
	if (LONE_SURROGATE.test(name)) {
		throw validationError("The file name is not valid UTF-8.");
	}
	if (Buffer.byteLength(name, "utf8") > MAX_DOCUMENT_NAME_BYTES) {
		throw validationError("The file name must be at most 255 bytes.");
	}
	if (/[\p{Cc}/\\]/u.test(name) || name === "." || name === "..") {
		throw validationError("The file name contains forbidden characters.");
	}
	return name;
}

/** Maps the extension (case-insensitive) to the only media types we store. */
export function mediaTypeForName(name: string): DocumentMediaType {
	const dot = name.lastIndexOf(".");
	const extension = (dot > 0 ? name.slice(dot) : "").toLowerCase();

	if (!Object.hasOwn(DOCUMENT_MEDIA_TYPES, extension)) {
		throw new ApiException(
			HttpStatus.UNSUPPORTED_MEDIA_TYPE,
			"UNSUPPORTED_MEDIA_TYPE",
			"Only .pdf, .txt and .md files are supported.",
		);
	}
	return DOCUMENT_MEDIA_TYPES[extension as DocumentExtension];
}

function assertText(content: Buffer): void {
	if (content.includes(0)) {
		throw invalidContent("The text file contains NUL bytes.");
	}
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(content);
	} catch {
		throw invalidContent("The text file is not valid UTF-8.");
	}
}

async function assertPdf(content: Buffer): Promise<void> {
	if (!content.subarray(0, 1024).includes("%PDF-")) {
		throw invalidContent("The file is not a PDF document.");
	}

	// pdf-parse takes ownership of the array: give it a copy.
	const parser = new PDFParse({ data: new Uint8Array(content) });

	try {
		const info = await parser.getInfo();
		// Owner-password-only PDFs open without a password but are encrypted.
		if (info.permission != null) {
			throw invalidContent("Encrypted PDF files are not supported.");
		}
	} catch (error) {
		if (error instanceof ApiException) throw error;
		const name = (error as { name?: string }).name;
		if (name === "PasswordException") {
			throw invalidContent("Encrypted PDF files are not supported.");
		}
		throw invalidContent("The PDF file is damaged or unreadable.");
	} finally {
		await parser.destroy().catch(() => undefined);
	}
}

export async function validateDocumentContent(
	content: Buffer,
	mediaType: DocumentMediaType,
): Promise<void> {
	if (content.length === 0) {
		throw invalidContent("The file is empty.");
	}
	if (mediaType === "application/pdf") {
		await assertPdf(content);
	} else {
		assertText(content);
	}
}
