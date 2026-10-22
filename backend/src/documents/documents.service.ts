import { HttpStatus, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { ReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
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
import { receiveSingleFile } from "./document-upload-parser";
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
		const decision = this.limits.consumeRolling([
			{ namespace: "document-upload", identity: userId, limit: UPLOADS_PER_MINUTE },
		]);
		if (decision.allowed === false) {
			response.setHeader("Retry-After", String(decision.retryAfterSeconds));
			throw new ApiException(
				HttpStatus.TOO_MANY_REQUESTS,
				"RATE_LIMITED",
				"Too many uploads. Please try again later.",
			);
		}

		// 3. Receive the file into a private temporary file (disk, not memory).
		let directory: string;
		try {
			directory = await this.storage.incomingDirectory();
		} catch {
			throw this.storageUnavailable();
		}
		const received = await receiveSingleFile(
			request,
			directory,
			(path) => this.storage.protectTemporary(path),
		);

		try {
			// 4. Validate name, then actual content.
			const originalName = validateDocumentName(received.originalName);
			const mediaType = mediaTypeForName(originalName);
			let content: Buffer;
			try {
				content = await readFile(received.temporaryPath);
			} catch {
				throw this.storageUnavailable();
			}
			await validateDocumentContent(content, mediaType);
			const sha256 = createHash("sha256").update(content).digest("hex");

			// 5. Finalize: move + metadata commit run inside the storage critical
			// section so the orphan sweep cannot delete the file in between.
			const storageKey = this.storage.newKey();
			const row = await this.storage.runExclusive(async () => {
				try {
					await this.storage.adopt(received.temporaryPath, storageKey);
				} catch {
					// A rename may have succeeded before a subsequent fsync failed.
					await this.storage.delete(storageKey).catch(() => undefined);
					throw this.storageUnavailable();
				}
				return this.commitMetadata(
					{ userId, organizationId, projectId },
					{
						originalName,
						storageKey,
						mediaType,
						sizeBytes: content.length,
						sha256,
					},
				);
			});
			return toDocumentSummary(row);
		} finally {
			// Nothing to remove when the file was moved.
			await this.storage.removeTemporary(received.temporaryPath);
			received.release();
		}
	}

	/**
	 * Inserts the metadata in one short transaction that re-checks access. The
	 * final file is removed only when the rollback is certain (the callback or a
	 * known API error failed). An unknown commit outcome keeps the bytes: the
	 * database is the source of truth and the orphan sweep decides later.
	 */
	private async commitMetadata(
		actor: { userId: string; organizationId: string; projectId: string },
		data: {
			originalName: string;
			storageKey: string;
			mediaType: string;
			sizeBytes: number;
			sha256: string;
		},
	) {
		let callbackFailed = false;

		try {
			return await this.runSerializable(async (tx) => {
				callbackFailed = false;
				try {
					// Access may have changed while the body was uploading.
					await this.projectAccess.assertProjectAccess(
						actor.userId,
						actor.organizationId,
						actor.projectId,
						MANAGEMENT_ROLES,
						tx,
					);
					return await tx.projectDocument.create({
						data: {
							projectId: actor.projectId,
							uploadedByUserId: actor.userId,
							...data,
						},
						select: DOCUMENT_SUMMARY_SELECT,
					});
				} catch (error) {
					callbackFailed = true;
					throw error;
				}
			});
		} catch (error) {
			if (error instanceof ApiException || callbackFailed) {
				await this.storage.delete(data.storageKey).catch(() => undefined);
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
			// Open and verify the same file descriptor before committing headers.
			const stream = await this.storage.read(document.storageKey, document.sizeBytes);
			return { stream, originalName: document.originalName,
				mediaType: document.mediaType, sizeBytes: document.sizeBytes };
		} catch {
			throw this.storageUnavailable();
		}
	}

	async delete(
		userId: string,
		organizationId: string,
		projectId: string,
		documentId: string,
	): Promise<void> {
		// One transaction: authorize, queue the byte deletion, delete the metadata.
		await this.runSerializable(async (tx) => {
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
		});

		// After commit. A failure here is retried by the cleanup worker.
		void this.cleanup.runOnce();
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
			// P2034: serialization failure. P2002: two deletes of the same document
			// both inserted its cleanup job; the retry then finds it already gone.
			return error.code === "P2034" || error.code === "P2002";
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
