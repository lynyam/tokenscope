import { HttpStatus, Injectable } from "@nestjs/common";
import {
	Prisma,
	type ModelPrice,
} from "../generated/prisma/client";
import { PrismaService } from "../database/prisma.service";
import { runSerializable } from "../database/run-serializable";
import { ApiException } from "../common/errors/api.exception";
import {
	MAX_CATALOGUE_ROWS,
	parsePriceCatalogue,
	priceIdentity,
} from "./price-catalogue";

export interface PriceFilters {
	provider?: string;
	model?: string;
}

export function mapModelPrice(row: ModelPrice) {
	return {
		id: row.id,
		provider: row.provider,
		model: row.model,
		effectiveFrom: row.effectiveFrom.toISOString(),
		inputUsdPerMillion: row.inputUsdPerMillion.toFixed(6),
		outputUsdPerMillion: row.outputUsdPerMillion.toFixed(6),
		currency: row.currency,
		isSynthetic: row.isSynthetic,
		sourceUrl: row.sourceUrl,
	};
}

@Injectable()
export class PricingService {
	constructor(private readonly prisma: PrismaService) { }

	async findEffectivePrice(
		tx: Prisma.TransactionClient,
		provider: string,
		model: string,
		occurredAt: Date,
	): Promise<ModelPrice> {
		const price = await tx.modelPrice.findFirst({
			where: {
				provider,
				model,
				effectiveFrom: { lte: occurredAt },
			},
			orderBy: { effectiveFrom: "desc" },
		});

		if (!price) {
			throw new ApiException(
				HttpStatus.BAD_REQUEST,
				"MODEL_PRICE_NOT_FOUND",
				"No applicable historical price exists for this provider and model.",
			);
		}

		return price;
	}

	async list(filters: PriceFilters) {
		const rows = await this.prisma.modelPrice.findMany({
			where: filters,
			orderBy: [
				{ provider: "asc" },
				{ model: "asc" },
				{ effectiveFrom: "asc" },
			],
		});

		return rows.map(mapModelPrice);
	}

	async loadCatalogue(input: unknown) {
		// Validate the entire input before opening a write transaction.
		const entries = parsePriceCatalogue(input);

		try {
			return await runSerializable(this.prisma, async tx => {
				const existing = await tx.modelPrice.findMany();
				const byIdentity = new Map(
					existing.map(row => [priceIdentity(row), row]),
				);
				const byId = new Map(existing.map(row => [row.id, row]));

				const additions: Prisma.ModelPriceCreateManyInput[] = [];
				let unchanged = 0;

				for (const entry of entries) {
					const found = byIdentity.get(priceIdentity(entry));

					if (found) {
						const identical =
							(entry.id === undefined || entry.id === found.id) &&
							found.inputUsdPerMillion.toFixed(6) ===
							entry.inputUsdPerMillion &&
							found.outputUsdPerMillion.toFixed(6) ===
							entry.outputUsdPerMillion &&
							found.currency === entry.currency &&
							found.isSynthetic === entry.isSynthetic &&
							found.sourceUrl === entry.sourceUrl;

						if (!identical) {
							throw this.catalogueConflict();
						}

						unchanged += 1;
						continue;
					}

					if (entry.id && byId.has(entry.id)) {
						throw this.catalogueConflict();
					}

					additions.push({
						...entry,
						effectiveFrom: new Date(entry.effectiveFrom),
					});
				}

				if (existing.length + additions.length > MAX_CATALOGUE_ROWS) {
					throw new ApiException(
						HttpStatus.BAD_REQUEST,
						"VALIDATION_ERROR",
						"The complete price catalogue cannot exceed 1000 rows.",
					);
				}

				if (additions.length > 0) {
					// Never use skipDuplicates: conflicting data must be reported.
					await tx.modelPrice.createMany({ data: additions });
				}

				return {
					inserted: additions.length,
					unchanged,
				};
			});
		} catch (error) {
			// A concurrent catalogue import may have claimed an identity/ID.
			// Do not overwrite it or expose the database exception.
			if (
				error &&
				typeof error === "object" &&
				"code" in error &&
				error.code === "P2002"
			) {
				throw this.catalogueConflict();
			}

			throw error;
		}
	}

	private catalogueConflict(): ApiException {
		return new ApiException(
			HttpStatus.CONFLICT,
			"MODEL_PRICE_CONFLICT",
			"A catalogue identity or ID already exists with different data. No prices were changed.",
		);
	}
}
