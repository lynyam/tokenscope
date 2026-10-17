import { HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import multer = require("multer");
import { ApiException } from "../common/errors/api.exception";
import { MAX_DOCUMENT_BYTES } from "./documents.constants";

export type ReceivedUpload = {
	originalName: string;
	/** Temporary file inside the private incoming directory. */
	temporaryPath: string;
	sizeBytes: number;
};

function tooLarge(): ApiException {
	return new ApiException(
		HttpStatus.PAYLOAD_TOO_LARGE,
		"PAYLOAD_TOO_LARGE",
		"The file must be at most 10 MiB.",
	);
}

function invalidUpload(message: string): ApiException {
	return new ApiException(
		HttpStatus.BAD_REQUEST,
		"VALIDATION_ERROR",
		"Request validation failed.",
		[{ field: "file", messages: [message] }],
	);
}

type Tracker = { settled: Promise<unknown>[]; paths: string[] };

function createParser(directory: string, tracker: Tracker) {
	const disk = multer.diskStorage({
		destination: directory,
		filename: (_request, _file, callback) => {
			const name = `${randomUUID()}.tmp`;
			tracker.paths.push(join(directory, name));
			callback(null, name);
		},
	});
	// Wraps diskStorage so that, on any error, we can wait until every started
	// write has ended before deleting its file (multer aborts without waiting).
	const storage: multer.StorageEngine = {
		_handleFile(request, file, callback) {
			tracker.settled.push(
				new Promise((done) => {
					disk._handleFile(request, file, (error, info) => {
						done(undefined);
						callback(error, info);
					});
				}),
			);
		},
		_removeFile(request, file, callback) {
			disk._removeFile(request, file, callback);
		},
	};
	return multer({
		storage,
		// multer decodes names as latin1 by default, which corrupts accents.
		defParamCharset: "utf8",
		// Keep the raw name: '/' and '\' are rejected later, never stripped.
		preservePath: true,
		limits: {
			files: 1,
			fields: 0,
			headerPairs: 20,
			fieldNameSize: 100,
			// One byte of headroom: busboy flags a file that reaches the limit exactly.
			fileSize: MAX_DOCUMENT_BYTES + 1,
		},
	}).single("file");
}

async function discard(tracker: Tracker): Promise<void> {
	await Promise.race([
		Promise.allSettled(tracker.settled),
		new Promise((resolve) => setTimeout(resolve, 5000).unref()),
	]);
	await Promise.all(tracker.paths.map((path) => rm(path, { force: true })));
}

/**
 * Runs multer by hand so access and quota checks happen before the body is read.
 * The returned file is a temporary file the caller must adopt or remove.
 */
export function receiveSingleFile(
	request: Request,
	directory: string,
): Promise<ReceivedUpload> {
	const tracker: Tracker = { settled: [], paths: [] };
	const parser = createParser(directory, tracker);

	return new Promise((resolve, reject) => {
		const fail = (exception: ApiException) => {
			void discard(tracker).then(
				() => reject(exception),
				() => reject(exception),
			);
		};
		parser(request, undefined as never, (error: unknown) => {
			if (error instanceof multer.MulterError) {
				if (error.code === "LIMIT_FILE_SIZE") return fail(tooLarge());
				return fail(
					invalidUpload(
						"Send exactly one file in a multipart field named 'file', and no other fields.",
					),
				);
			}
			if (error) {
				return fail(invalidUpload("The multipart body is malformed."));
			}

			const file = request.file;
			if (!file) {
				return fail(
					invalidUpload("A multipart field named 'file' is required."),
				);
			}
			if (file.size > MAX_DOCUMENT_BYTES) {
				return fail(tooLarge());
			}
			resolve({
				originalName: file.originalname,
				temporaryPath: file.path,
				sizeBytes: file.size,
			});
		});
	});
}
