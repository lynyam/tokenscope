import {
	Controller,
	Delete,
	Get,
	Header,
	HttpCode,
	HttpStatus,
	Logger,
	Post,
	Query,
	Req,
	Res,
	StreamableFile,
} from "@nestjs/common";
import type { Request, Response } from "express";
import contentDisposition = require("content-disposition");
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { UuidParam } from "../common/decorators/uuid-param.decorators";
import type { AuthenticatedUser } from "../common/types/authenticated-user";
import { DocumentContentQuery } from "./dto/document-content-query.dto";
import { ListDocumentsQuery } from "./dto/list-documents-query.dto";
import { DocumentsService } from "./documents.service";

@Controller("organizations/:organizationId/projects/:projectId/documents")
export class DocumentsController {
	private readonly logger = new Logger(DocumentsController.name);

	constructor(private readonly documents: DocumentsService) {}

	@Post()
	@Header("Cache-Control", "no-store")
	upload(
		@CurrentUser() actor: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@Req() request: Request,
		@Res({ passthrough: true }) response: Response,
	) {
		// Status 201 is the default for @Post.
		return this.documents.upload(
			actor.id,
			organizationId,
			projectId,
			request,
			response,
		);
	}

	@Get()
	@Header("Cache-Control", "no-store")
	list(
		@CurrentUser() actor: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@Query() query: ListDocumentsQuery,
	) {
		return this.documents.list(actor.id, organizationId, projectId, query);
	}

	@Get(":documentId/content")
	async content(
		@CurrentUser() actor: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@UuidParam("documentId") documentId: string,
		@Query() query: DocumentContentQuery,
		@Res({ passthrough: true }) response: Response,
	): Promise<StreamableFile> {
		const content = await this.documents.openContent(
			actor.id,
			organizationId,
			projectId,
			documentId,
		);

		const onClose = () => content.stream.destroy();
		response.once("close", onClose);
		content.stream.once("close", () => response.off("close", onClose));
		if (response.destroyed) content.stream.destroy();

		response.setHeader("Cache-Control", "no-store");
		response.setHeader("X-Content-Type-Options", "nosniff");

		const file = new StreamableFile(content.stream, {
			// Text is validated as UTF-8 on upload; say so, or browsers may guess a legacy charset.
			type: content.mediaType.startsWith("text/")
				? `${content.mediaType}; charset=utf-8`
				: content.mediaType,
			length: content.sizeBytes,
			disposition: contentDisposition(content.originalName, {
				type: query.download === "true" ? "attachment" : "inline",
				// Always send an ASCII filename plus the UTF-8 filename* form.
				fallback: content.originalName.replace(/[^\x20-\x7e]|["\\%]/g, "_"),
			}),
		});

		// A read failure must never append a JSON body to partial file content and
		// must never leak the raw filesystem error.
		file.setErrorHandler((_error, handlerResponse) => {
			const res = handlerResponse as unknown as Response;
			if (res.headersSent) {
				res.destroy();
				return;
			}
			// The file headers were set before piping; the JSON body must not inherit them.
			res.removeHeader("Content-Disposition");
			res.removeHeader("Content-Length");
			res.removeHeader("Content-Type");
			const requestId = res.getHeader("X-Request-Id");
			res.status(503).json({
				statusCode: 503,
				code: "STORAGE_UNAVAILABLE",
				error: "Service Unavailable",
				message: "Document storage is temporarily unavailable.",
				requestId: typeof requestId === "string" ? requestId : undefined,
			});
		});
		file.setErrorLogger(() => {
			this.logger.error(JSON.stringify({ event: "document_content_failed",
				requestId: response.getHeader("X-Request-Id"), documentId,
				code: "STORAGE_UNAVAILABLE" }));
		});
		return file;
	}

	@Delete(":documentId")
	@HttpCode(HttpStatus.NO_CONTENT)
	@Header("Cache-Control", "no-store")
	delete(
		@CurrentUser() actor: AuthenticatedUser,
		@UuidParam("organizationId") organizationId: string,
		@UuidParam("projectId") projectId: string,
		@UuidParam("documentId") documentId: string,
	): Promise<void> {
		return this.documents.delete(
			actor.id,
			organizationId,
			projectId,
			documentId,
		);
	}
}
