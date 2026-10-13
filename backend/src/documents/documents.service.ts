import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ReadStream } from "node:fs";
import type { Request, Response } from "express";
import { MembershipRole, Prisma } from "../generated/prisma/client";
import { ApiException } from "../common/errors/api.exception";
import { RateLimitService } from "../common/rate-limit/rate-limit.service";
import { PrismaService } from "../database/prisma.service";
import { ProjectAccessService } from "../projects/project-access.service";
import { DocumentCleanupService } from "./document-cleanup.service";
import { DocumentStorageService } from "./document-storage.service";
import {
	mediaTypeForName,
	validateDocumentContent,
	validateDocumentName,
} from "./document-file-validation";
import {
	DOCUMENT_SUMMARY_SELECT,
	toDocumentSummary,
} from "./document.mapper";
import { parseSingleFileUpload } from "./document-upload-parser";
import type { DocumentSummary, Page } from "./documents.types";

const MANAGEMENT_ROLES = [MembershipRole.OWNER, MembershipRole.ADMIN] as const;
const ALL_ROLES = [
	MembershipRole.OWNER,
	MembershipRole.ADMIN,
	MembershipRole.MEMBER,
] as const;

const MAX_TRANSACTION_ATTEMPTS = 3;
const UPLOADS_PER_MINUTE = 5;
const DEFAULT_PAGE_SIZE = 25;

export type DocumentContent = {
	stream: ReadStream;
	originalName: string;
	mediaType: string;
	sizeBytes: number;
};

@Injectable()
export class DocumentsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly projectAccess: ProjectAccessService,
		private readonly storage: DocumentStorageService,
		private readonly cleanup: DocumentCleanupService,
		private readonly limits: RateLimitService,
	) {}

	async upload(
		userId: string,
		organizationId: string,
		projectId: string,
		request: Request,
		response: Response,
	): Promise<DocumentSummary> {
		// 1. Authorize before reading a single body byte.
		await this.projectAccess.assertProjectAccess(
			userId,
			organizationId,
			projectId,
			MANAGEMENT_ROLES,
		);

		// 2. Only authorized uploads consume the quota.
		const decision = this.limits.consume(
			"document-upload",
			userId,
			UPLOADS_PER_MINUTE,
		);
		if (decision.allowed === false) {
			response.setHeader("Retry-After", String(decision.retryAfterSeconds));
			throw new ApiException(
				HttpStatus.TOO_MANY_REQUESTS,
				"RATE_LIMITED",
				"Too many uploads. Please try again later.",
			);
		}

		// 3. Read and validate the file.
		const file = await parseSingleFileUpload(request);
		const originalName = validateDocumentName(file.originalName);
		const mediaType = mediaTypeForName(originalName);
		await validateDocumentContent(file.content, mediaType);

		// 4. Bytes first, metadata second: a row never points at missing bytes.
		const storageKey = this.storage.newKey();
		try {
			await this.storage.write(storageKey, file.content);
		} catch {
			throw this.storageUnavailable();
		}

		try {
			const row = await this.runSerializable(async (tx) => {
				// Access may have changed while the body was uploading.
				await this.projectAccess.assertProjectAccess(
					userId,
					organizationId,
					projectId,
					MANAGEMENT_ROLES,
					tx,
				);
				return tx.projectDocument.create({
					data: {
						projectId,
						uploadedByUserId: userId,
						originalName,
						storageKey,
						mediaType,
						sizeBytes: file.content.length,
						sha256: createHash("sha256").update(file.content).digest("hex"),
					},
					select: DOCUMENT_SUMMARY_SELECT,
				});
			});
			return toDocumentSummary(row);
		} catch (error) {
			// Only a known rollback may delete the bytes. For any other failure the
			// commit outcome is unknown (lost response), so the orphan sweep decides.
			if (error instanceof ApiException) {
				await this.storage.delete(storageKey).catch(() => undefined);
			}
			throw error;
		}
	}

	async list(
		userId: string,
		organizationId: string,
		projectId: string,
		query: { page?: number; pageSize?: number },
	): Promise<Page<DocumentSummary>> {
		const page = query.page ?? 1;
		const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

		const { total, rows } = await this.runSerializable(async (tx) => {
			await this.projectAccess.assertProjectAccess(
				userId,
				organizationId,
				projectId,
				ALL_ROLES,
				tx,
			);
			const total = await tx.projectDocument.count({ where: { projectId } });
			const rows = await tx.projectDocument.findMany({
				where: { projectId },
				orderBy: [{ createdAt: "desc" }, { id: "asc" }],
				skip: (page - 1) * pageSize,
				take: pageSize,
				select: DOCUMENT_SUMMARY_SELECT,
			});
			return { total, rows };
		});

		return {
			items: rows.map(toDocumentSummary),
			page,
			pageSize,
			total,
			totalPages: Math.ceil(total / pageSize),
		};
	}

	async openContent(
		userId: string,
		organizationId: string,
		projectId: string,
		documentId: string,
	): Promise<DocumentContent> {
		const document = await this.runSerializable(async (tx) => {
			await this.projectAccess.assertProjectAccess(
				userId,
				organizationId,
				projectId,
				ALL_ROLES,
				tx,
			);
			const found = await tx.projectDocument.findFirst({
				where: { id: documentId, projectId },
				select: {
					originalName: true,
					mediaType: true,
					sizeBytes: true,
					storageKey: true,
				},
			});
			if (!found) throw this.documentNotFound();
			return found;
		});

		try {
			// Fails now (not mid-stream) when the bytes are missing.
			await this.storage.size(document.storageKey);
		} catch {
			throw this.storageUnavailable();
		}

		return {
			stream: this.storage.read(document.storageKey),
			originalName: document.originalName,
			mediaType: document.mediaType,
			sizeBytes: document.sizeBytes,
		};
	}

	async delete(
		userId: string,
		organizationId: string,
		projectId: string,
		documentId: string,
	): Promise<void> {
		// One transaction: authorize, queue the byte deletion, delete the metadata.
		const storageKey = await this.runSerializable(async (tx) => {
			await this.projectAccess.assertProjectAccess(
				userId,
				organizationId,
				projectId,
				MANAGEMENT_ROLES,
				tx,
			);
			const document = await tx.projectDocument.findFirst({
				where: { id: documentId, projectId },
				select: { storageKey: true },
			});
			if (!document) throw this.documentNotFound();

			await tx.fileDeletionJob.create({
				data: { storageKey: document.storageKey, nextAttemptAt: new Date() },
			});
			await tx.projectDocument.delete({ where: { id: documentId } });
			return document.storageKey;
		});

		// After commit. A failure here is retried by the cleanup worker.
		await this.cleanup.processKey(storageKey).catch(() => undefined);
	}

	private documentNotFound(): ApiException {
		return new ApiException(
			HttpStatus.NOT_FOUND,
			"DOCUMENT_NOT_FOUND",
			"Document not found.",
		);
	}

	private storageUnavailable(): ApiException {
		return new ApiException(
			HttpStatus.SERVICE_UNAVAILABLE,
			"STORAGE_UNAVAILABLE",
			"Document storage is temporarily unavailable.",
		);
	}

	private async runSerializable<T>(
		operation: (tx: Prisma.TransactionClient) => Promise<T>,
	): Promise<T> {
		for (let attempt = 1; ; attempt += 1) {
			try {
				return await this.prisma.$transaction(operation, {
					isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
				});
			} catch (error) {
				if (!this.isTransactionConflict(error)) throw error;

				if (attempt >= MAX_TRANSACTION_ATTEMPTS) {
					throw new ApiException(
						HttpStatus.CONFLICT,
						"CONCURRENT_MODIFICATION",
						"The resource changed concurrently. Please try again.",
					);
				}
			}
		}
	}

	private isTransactionConflict(error: unknown): boolean {
		if (error instanceof Prisma.PrismaClientKnownRequestError) {
			return error.code === "P2034";
		}
		if (
			typeof error !== "object" ||
			error === null ||
			!("name" in error) ||
			error.name !== "DriverAdapterError" ||
			!("cause" in error)
		) {
			return false;
		}
		const cause = error.cause;
		return (
			typeof cause === "object" &&
			cause !== null &&
			"kind" in cause &&
			cause.kind === "TransactionWriteConflict"
		);
	}
}
