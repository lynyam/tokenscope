import { isUUID } from "class-validator";
import { Prisma } from "../generated/prisma/client";
import {
	invalidUsage,
	normalizeIdentifier,
	normalizeUtcInstant,
	plainObject,
	rejectUnknownFields,
} from "../common/validation/usage-values";

export const MAX_CATALOGUE_ROWS = 1000;
export const MAX_CATALOGUE_BYTES = 1024 * 1024;

export interface CatalogueEntry {
	id?: string;
	provider: string;
	model: string;
	effectiveFrom: string;
	inputUsdPerMillion: string;
	outputUsdPerMillion: string;
	currency: "USD";
	isSynthetic: boolean;
	sourceUrl: string | null;
}

export function priceIdentity(entry: {
	provider: string;
	model: string;
	effectiveFrom: string | Date;
}): string {
	const date = typeof entry.effectiveFrom === "string"
		? entry.effectiveFrom
		: entry.effectiveFrom.toISOString();

	return JSON.stringify([entry.provider, entry.model, date]);
}

function normalizeRate(value: unknown, field: string): string {
	if (
		typeof value !== "string" ||
		!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(value)
	) {
		invalidUsage(
			field,
			"Use a decimal string between 0 and 999999.999999, with at most six decimal places.",
		);
	}

	return new Prisma.Decimal(value).toFixed(6);
}

export function parsePriceCatalogue(input: unknown): CatalogueEntry[] {
	if (!Array.isArray(input) || input.length > MAX_CATALOGUE_ROWS) {
		invalidUsage(
			"catalogue",
			`Must be an array of at most ${MAX_CATALOGUE_ROWS} entries.`,
		);
	}

	if (
		Buffer.byteLength(JSON.stringify(input), "utf8") >
		MAX_CATALOGUE_BYTES
	) {
		invalidUsage("catalogue", "Must not exceed 1 MiB.");
	}

	const identities = new Set<string>();
	const ids = new Set<string>();

	return input.map((raw, index) => {
		const row = plainObject(raw, `catalogue.${index}`);

		rejectUnknownFields(row, [
			"id",
			"provider",
			"model",
			"effectiveFrom",
			"inputUsdPerMillion",
			"outputUsdPerMillion",
			"currency",
			"isSynthetic",
			"sourceUrl",
		]);

		if (
			row.id !== undefined &&
			(typeof row.id !== "string" || !isUUID(row.id))
		) {
			invalidUsage("id", "Must be a UUID when supplied.");
		}

		if (row.currency !== "USD") {
			invalidUsage("currency", "Only USD is supported.");
		}

		if (typeof row.isSynthetic !== "boolean") {
			invalidUsage("isSynthetic", "Must be a boolean.");
		}

		let sourceUrl: string | null = null;

		if (row.sourceUrl !== undefined && row.sourceUrl !== null) {
			if (
				typeof row.sourceUrl !== "string" ||
				row.sourceUrl.length > 2048
			) {
				invalidUsage("sourceUrl", "Must be an HTTPS URL.");
			}

			try {
				const url = new URL(row.sourceUrl);

				if (
					url.protocol !== "https:" ||
					url.username ||
					url.password
				) {
					invalidUsage("sourceUrl", "Must be an HTTPS URL without credentials.");
				}
			} catch {
				invalidUsage("sourceUrl", "Must be an HTTPS URL.");
			}

			sourceUrl = row.sourceUrl;
		}

		if (!row.isSynthetic && sourceUrl === null) {
			invalidUsage(
				"sourceUrl",
				"A real price requires its official pricing source.",
			);
		}

		const entry: CatalogueEntry = {
			...(row.id === undefined ? {} : { id: row.id as string }),
			provider: normalizeIdentifier(row.provider, "provider"),
			model: normalizeIdentifier(row.model, "model"),
			effectiveFrom: normalizeUtcInstant(
				row.effectiveFrom,
				"effectiveFrom",
			),
			inputUsdPerMillion: normalizeRate(
				row.inputUsdPerMillion,
				"inputUsdPerMillion",
			),
			outputUsdPerMillion: normalizeRate(
				row.outputUsdPerMillion,
				"outputUsdPerMillion",
			),
			currency: "USD",
			isSynthetic: row.isSynthetic,
			sourceUrl,
		};

		const identity = priceIdentity(entry);

		if (identities.has(identity)) {
			invalidUsage("catalogue", "Duplicate price identity in the input.");
		}

		if (entry.id && ids.has(entry.id)) {
			invalidUsage("catalogue", "Duplicate price ID in the input.");
		}

		identities.add(identity);
		if (entry.id) ids.add(entry.id);

		return entry;
	});
}
