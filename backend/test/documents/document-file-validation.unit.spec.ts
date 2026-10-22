import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiException } from "../../src/common/errors/api.exception";
import {
	mediaTypeForName,
	validateDocumentContent,
	validateDocumentName,
} from "../../src/documents/document-file-validation";

const fixture = (name: string) =>
	readFileSync(join(__dirname, "../fixtures/documents", name));

async function failure(promise: Promise<unknown> | (() => unknown)) {
	try {
		await (typeof promise === "function" ? promise() : promise);
	} catch (error) {
		expect(error).toBeInstanceOf(ApiException);
		const e = error as ApiException;
		return { status: e.getStatus(), code: e.code };
	}
	throw new Error("expected an ApiException");
}

describe("validateDocumentName", () => {
	it.each(["a.pdf", "notes.TXT", "é日本.md", "x".repeat(251) + ".pdf"])(
		"accepts %s",
		(name) => expect(validateDocumentName(name)).toBe(name),
	);

	it.each([
		["empty", ""],
		["blank", "   "],
		["slash", "a/b.pdf"],
		["backslash", "a\\b.pdf"],
		["NUL", "a\0.pdf"],
		["newline", "a\n.pdf"],
		["dot", "."],
		["dotdot", ".."],
		["256 bytes", "x".repeat(252) + ".pdf"],
		["multibyte over 255 bytes", "é".repeat(128)],
		["lone surrogate", "a\ud800.pdf"],
	])("rejects %s with 400 VALIDATION_ERROR", async (_label, name) => {
		expect(await failure(() => validateDocumentName(name))).toEqual({
			status: 400,
			code: "VALIDATION_ERROR",
		});
	});

	it("rejects a non-string", async () => {
		expect((await failure(() => validateDocumentName(undefined))).code).toBe(
			"VALIDATION_ERROR",
		);
	});
});

describe("mediaTypeForName", () => {
	it.each([
		["a.pdf", "application/pdf"],
		["a.PDF", "application/pdf"],
		["a.txt", "text/plain"],
		["a.Md", "text/markdown"],
		["a.b.txt", "text/plain"],
	])("%s -> %s", (name, type) => expect(mediaTypeForName(name)).toBe(type));

	it.each(["a.docx", "a", ".pdf", "a.pdf.exe", "a.constructor", "a.toString"])(
		"rejects %s with 415",
		async (name) => {
			expect(await failure(() => mediaTypeForName(name))).toEqual({
				status: 415,
				code: "UNSUPPORTED_MEDIA_TYPE",
			});
		},
	);
});

describe("validateDocumentContent", () => {
	const invalid = { status: 422, code: "INVALID_DOCUMENT_CONTENT" };

	it("accepts a valid PDF", async () => {
		await expect(
			validateDocumentContent(fixture("valid.pdf"), "application/pdf"),
		).resolves.toBeUndefined();
	});

	it.each([
		["user-password PDF", () => fixture("enc_user.pdf")],
		["owner-password PDF", () => fixture("enc_owner_only.pdf")],
		["truncated PDF", () => fixture("valid.pdf").subarray(0, 600)],
		["header only", () => Buffer.from("%PDF-1.4")],
		["not a PDF", () => Buffer.from("hello")],
	])("rejects %s", async (_label, make) => {
		expect(
			await failure(validateDocumentContent(make(), "application/pdf")),
		).toEqual(invalid);
	});

	it("answers 400 for an empty file of any type", async () => {
		for (const type of ["application/pdf", "text/plain", "text/markdown"] as const) {
			expect(await failure(validateDocumentContent(Buffer.alloc(0), type))).toEqual({
				status: 400,
				code: "VALIDATION_ERROR",
			});
		}
	});

	it("gives up on a PDF that takes too long to inspect", async () => {
		const destroy = jest.fn();
		const stuck = {
			getInfo: () => new Promise<never>(() => undefined),
			destroy,
		};
		const started = Date.now();

		expect(
			await failure(
				validateDocumentContent(fixture("valid.pdf"), "application/pdf", {
					pdfTimeoutMs: 50,
					openPdf: () => stuck,
				}),
			),
		).toEqual(invalid);
		expect(Date.now() - started).toBeLessThan(2000);
		await new Promise((resolve) => setImmediate(resolve));
		expect(destroy).toHaveBeenCalled();
	});

	it.each(["text/plain", "text/markdown"] as const)(
		"accepts UTF-8 as %s",
		async (type) => {
			await expect(
				validateDocumentContent(Buffer.from("# héllo 日本\n"), type),
			).resolves.toBeUndefined();
		},
	);

	it.each([
		["invalid UTF-8", Buffer.from([0xff, 0xfe, 0x41])],
		["NUL byte", Buffer.from("a\0b")],
	])("rejects text with %s", async (_label, content) => {
		expect(await failure(validateDocumentContent(content, "text/plain"))).toEqual(
			invalid,
		);
	});
});
