import {
	HttpStatus,
	Injectable,
	Logger,
} from "@nestjs/common";
import { ApiKeyAuthService } from "../api-keys/api-key-auth.service";
import type { ApiKeyPrincipal } from "../api-keys/api-key.types";
import { ApiException } from "../common/errors/api.exception";
import { PrismaService } from "../database/prisma.service";
import {
	isTraceIdentityConflict,
	runSerializable,
} from "../database/run-serializable";
import { PricingService } from "../pricing/pricing.service";
import { calculateTraceCost } from "../pricing/calculate-trace-cost";
import type { NormalizedTracePayload } from "./dto/create-trace.dto";
import { hashTracePayload } from "./trace-payload";
import {
	mapTrace,
	traceResponseInclude,
	type TraceResponse,
} from "./trace.mapper";
import { TraceChangesService } from "./trace-changes.service";
import { invalidUsage } from "../common/validation/usage-values";
import { publicTraceScope } from "./trace-scope";
import {
	assertTraceVersion,
	assertVersionCanAdvance,
	parseTraceVersion,
} from "./trace-version";

export interface IngestResult {
	trace: TraceResponse;
	created: boolean;
}

@Injectable()
export class TracesService {
	private readonly logger = new Logger(TracesService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly apiKeyAuth: ApiKeyAuthService,
		private readonly pricing: PricingService,
		private readonly changes: TraceChangesService,
	) { }

	async ingest(
		principal: ApiKeyPrincipal,
		payload: NormalizedTracePayload,
	): Promise<IngestResult> {
		const payloadHash = hashTracePayload(payload);

		const result = await runSerializable(
			this.prisma,
			async tx => {
				// Executed again inside every fresh transaction attempt.
				await this.apiKeyAuth.assertActivePrincipal(principal, tx);

				const existing = await tx.trace.findUnique({
					where: {
						projectId_externalId: {
							projectId: principal.projectId,
							externalId: payload.externalId,
						},
					},
					include: traceResponseInclude,
				});

				if (existing) {
					if (existing.deletedAt !== null) {
						throw new ApiException(
							HttpStatus.CONFLICT,
							"TRACE_DELETED",
							"This external ID belongs to a deleted trace.",
						);
					}

					if (existing.payloadHash !== payloadHash) {
						throw new ApiException(
							HttpStatus.CONFLICT,
							"TRACE_EXTERNAL_ID_CONFLICT",
							"This external ID already exists with different trace data.",
						);
					}

					// Return persisted history without querying a new price.
					return {
						trace: mapTrace(existing),
						created: false,
					};
				}

				const occurredAt = new Date(payload.occurredAt);

				const price = await this.pricing.findEffectivePrice(
					tx,
					payload.provider,
					payload.model,
					occurredAt,
				);

				const costs = calculateTraceCost({
					inputTokens: payload.inputTokens,
					outputTokens: payload.outputTokens,
					inputUsdPerMillion: price.inputUsdPerMillion,
					outputUsdPerMillion: price.outputUsdPerMillion,
				});

				const row = await tx.trace.create({
					data: {
						projectId: principal.projectId,
						externalId: payload.externalId,
						provider: payload.provider,
						model: payload.model,
						workflow: payload.workflow,
						inputTokens: payload.inputTokens,
						outputTokens: payload.outputTokens,
						latencyMs: payload.latencyMs,
						status: payload.status,
						occurredAt,
						metadata: payload.metadata,
						priceVersionId: price.id,
						inputUsdPerMillion: price.inputUsdPerMillion,
						outputUsdPerMillion: price.outputUsdPerMillion,
						...costs,
						version: 1,
						payloadHash,
					},
					include: traceResponseInclude,
				});

				return {
					trace: mapTrace(row),
					created: true,
				};
			},
			isTraceIdentityConflict,
		);

		// The transaction has committed before execution reaches here.
		if (result.created) {
			try {
				await this.publishCommittedChange(principal.projectId);
			} catch {
				// Do not log raw errors, trace payloads, metadata or credentials.
				this.logger.warn(JSON.stringify({
					event: "trace_change_publication_failed",
					projectId: principal.projectId,
				}));
			}
		}

		return result;
	}

	async replace(
		principal: ApiKeyPrincipal,
		traceId: string,
		ifMatch: string | undefined,
		payload: NormalizedTracePayload,
	): Promise<TraceResponse> {
		const payloadHash = hashTracePayload(payload);

		const result = await runSerializable(this.prisma, async tx => {
			await this.apiKeyAuth.assertActivePrincipal(principal, tx);

			const scope = publicTraceScope(principal);

			const existing = await tx.trace.findFirst({
				where: { AND: [scope, { id: traceId }] },
				include: traceResponseInclude,
			});

			if (!existing) {
				throw new ApiException(404, "TRACE_NOT_FOUND", "Trace not found.");
			}

			// Parse after the scoped lookup so inaccessible resources do not
			// reveal their current version or existence.
			const expected = parseTraceVersion(ifMatch);
			assertTraceVersion(existing.version, expected);

			if (payload.externalId !== existing.externalId) {
				invalidUsage("externalId", "A trace externalId cannot be changed.");
			}

			if (existing.payloadHash === payloadHash) {
				return {
					trace: mapTrace(existing),
					changed: false,
				};
			}

			assertVersionCanAdvance(existing.version);

			const occurredAt = new Date(payload.occurredAt);

			const price = await this.pricing.findEffectivePrice(
				tx,
				payload.provider,
				payload.model,
				occurredAt,
			);

			const costs = calculateTraceCost({
				inputTokens: payload.inputTokens,
				outputTokens: payload.outputTokens,
				inputUsdPerMillion: price.inputUsdPerMillion,
				outputUsdPerMillion: price.outputUsdPerMillion,
			});

			const changed = await tx.trace.updateMany({
				where: {
					AND: [
						scope,
						{ id: traceId, version: expected },
					],
				},
				data: {
					provider: payload.provider,
					model: payload.model,
					workflow: payload.workflow,
					inputTokens: payload.inputTokens,
					outputTokens: payload.outputTokens,
					latencyMs: payload.latencyMs,
					status: payload.status,
					occurredAt,
					metadata: payload.metadata,
					priceVersionId: price.id,
					inputUsdPerMillion: price.inputUsdPerMillion,
					outputUsdPerMillion: price.outputUsdPerMillion,
					...costs,
					payloadHash,
					version: { increment: 1 },
					updatedAt: new Date(),
				},
			});

			if (changed.count !== 1) {
				throw new ApiException(
					412,
					"TRACE_VERSION_CONFLICT",
					"The trace changed. Read it again before deciding on a correction.",
				);
			}

			const row = await tx.trace.findFirstOrThrow({
				where: { AND: [scope, { id: traceId }] },
				include: traceResponseInclude,
			});

			return {
				trace: mapTrace(row),
				changed: true,
			};
		});

		if (result.changed) {
			await this.publishCommittedChange(principal.projectId);
		}

		return result.trace;
	}

	async remove(
		principal: ApiKeyPrincipal,
		traceId: string,
		ifMatch: string | undefined,
	): Promise<void> {
		await runSerializable(this.prisma, async tx => {
			await this.apiKeyAuth.assertActivePrincipal(principal, tx);

			const scope = publicTraceScope(principal);

			const existing = await tx.trace.findFirst({
				where: { AND: [scope, { id: traceId }] },
				select: { id: true, version: true },
			});

			if (!existing) {
				throw new ApiException(404, "TRACE_NOT_FOUND", "Trace not found.");
			}

			const expected = parseTraceVersion(ifMatch);
			assertTraceVersion(existing.version, expected);
			assertVersionCanAdvance(existing.version);

			const now = new Date();

			const removed = await tx.trace.updateMany({
				where: {
					AND: [
						scope,
						{ id: traceId, version: expected },
					],
				},
				data: {
					deletedAt: now,
					updatedAt: now,
					version: { increment: 1 },
				},
			});

			if (removed.count !== 1) {
				throw new ApiException(
					412,
					"TRACE_VERSION_CONFLICT",
					"The trace changed. Read it again before deciding on deletion.",
				);
			}
		});

		await this.publishCommittedChange(principal.projectId);
	}

	private async publishCommittedChange(projectId: string): Promise<void> {
		try {
			await this.changes.publish({ projectId });
		} catch {
			// The database mutation is already committed.
			this.logger.warn(JSON.stringify({
				event: "trace_change_publication_failed",
				projectId,
			}));
		}
	}
}
