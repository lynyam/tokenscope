import { HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import multer = require("multer");
import { ApiException } from "../common/errors/api.exception";
import { MAX_DOCUMENT_BYTES } from "./documents.constants";

export type UploadedDocument = {
	originalName: string;
	content: Buffer;
};

const parser = multer({
	storage: multer.memoryStorage(),
	// Keep the raw name: we reject '/' and '\\' ourselves instead of silently
	// stripping a path.
	preservePath: true,
	// multer decodes names as latin1 by default, which corrupts accents.
	defParamCharset: "utf8",
	limits: {
		files: 1,
		fields: 0,
		// One byte of headroom: busboy flags a file that reaches the limit exactly.
		fileSize: MAX_DOCUMENT_BYTES + 1,
	},
}).single("file");

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

/** Runs multer by hand so access and quota checks happen before the body is read. */
export function parseSingleFileUpload(
	request: Request,
): Promise<UploadedDocument> {
	return new Promise((resolve, reject) => {
		parser(request, undefined as never, (error: unknown) => {
			if (error instanceof multer.MulterError) {
				if (error.code === "LIMIT_FILE_SIZE") {
					return reject(tooLarge());
				}
				return reject(
					invalidUpload(
						"Send exactly one file in a multipart field named 'file', and no other fields.",
					),
				);
			}
			if (error) {
				return reject(invalidUpload("The multipart body is malformed."));
			}

			const file = request.file;
			if (!file) {
				return reject(
					invalidUpload("A multipart field named 'file' is required."),
				);
			}
			if (file.buffer.length > MAX_DOCUMENT_BYTES) {
				return reject(tooLarge());
			}
			resolve({ originalName: file.originalname, content: file.buffer });
		});
	});
}
