import { HttpStatus } from "@nestjs/common";
import { Worker } from "node:worker_threads";
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
	if (typeof name !== "string" || name.trim().length === 0) {
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

export const PDF_VALIDATION_TIMEOUT_MS = 10_000;

export type PdfInspector = {
	getInfo(): Promise<{ permission?: unknown }>;
	destroy(): Promise<unknown> | unknown;
};

export type ContentValidationOptions = {
	pdfTimeoutMs?: number;
	openPdf?: (data: Uint8Array) => PdfInspector;
};

// PDF.js uses a same-thread fallback in Node. A dedicated worker makes the
// existing deadline enforceable even while PDF parsing is CPU-bound.
function openPdfInWorker(data: Uint8Array): PdfInspector {
	const worker = new Worker(`
		const { parentPort, workerData } = require("node:worker_threads");
		(async () => {
			try {
				const { PDFParse } = require(workerData.modulePath);
				const parser = new PDFParse({ data: workerData.data });
				const info = await parser.getInfo();
				parentPort.postMessage({ encrypted: info.permission != null });
			} catch (error) {
				parentPort.postMessage({ failure: error?.name === "PasswordException"
					? "PasswordException" : "InvalidPDFException" });
			}
		})();
	`, { eval: true, workerData: { modulePath: require.resolve("pdf-parse"), data },
		stdout: true, stderr: true });
	// Parser diagnostics may contain document content; never forward them.
	worker.stdout.resume();
	worker.stderr.resume();
	const result = new Promise<{ permission?: unknown }>((resolve, reject) => {
		worker.once("message", (message: { encrypted?: boolean; failure?: string }) => {
			if (message.failure) reject(Object.assign(new Error("Invalid PDF"), { name: message.failure }));
			else resolve({ permission: message.encrypted ? [] : null });
		});
		worker.once("error", () => reject(new Error("PDF worker failed")));
		worker.once("exit", () => reject(new Error("PDF worker exited")));
	});
	return { getInfo: () => result, destroy: () => worker.terminate() };
}

async function assertPdf(
	content: Buffer,
	options: ContentValidationOptions,
): Promise<void> {
	if (!content.subarray(0, 1024).includes("%PDF-")) {
		throw invalidContent("The file is not a PDF document.");
	}

	// pdf-parse takes ownership of the array: give it a copy.
	const data = new Uint8Array(content);
	const parser: PdfInspector = options.openPdf
		? options.openPdf(data)
		: openPdfInWorker(data);

	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(
			() => reject(invalidContent("The PDF could not be validated in time.")),
			options.pdfTimeoutMs ?? PDF_VALIDATION_TIMEOUT_MS,
		);
	});

	try {
		const info = await Promise.race([parser.getInfo(), deadline]);
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
		clearTimeout(timer);
		// Never wait for a parser that may be stuck.
		void Promise.resolve()
			.then(() => parser.destroy())
			.catch(() => undefined);
	}
}

export async function validateDocumentContent(
	content: Buffer,
	mediaType: DocumentMediaType,
	options: ContentValidationOptions = {},
): Promise<void> {
	if (content.length === 0) {
		throw validationError("The file must not be empty.");
	}
	if (mediaType === "application/pdf") {
		await assertPdf(content, options);
	} else {
		assertText(content);
	}
}
