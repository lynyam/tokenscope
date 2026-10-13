import type { Prisma } from "../generated/prisma/client";
import {
	assertDatabaseText,
	invalidUsage,
	normalizeIdentifier,
	normalizeUtcInstant,
	plainObject,
	rejectUnknownFields,
} from "../common/validation/usage-values";

export const TRACE_FILTER_KEYS = [
	"from",
	"to",
	"q",
	"provider",
	"model",
	"workflow",
	"status",
] as const;

export interface ResolvedTraceFilters {
	from: Date;
	to: Date;
	q?: string;
	provider?: string;
	model?: string;
	workflow?: string;
	status?: "SUCCESS" | "ERROR";
}

const DAY_MS = 24 * 60 * 60 * 1000;

function text(
	value: unknown,
	field: string,
	maximum: number,
): string {
	if (typeof value !== "string") {
		invalidUsage(field, "Must be a string.");
	}

	assertDatabaseText(value, field);

	const normalized = value.trim();

	if ([...normalized].length > maximum) {
		invalidUsage(field, `Must contain at most ${maximum} characters.`);
	}

	return normalized;
}

export function resolveTraceFilters(
	input: unknown,
	now = new Date(),
	requireDates = false,
): ResolvedTraceFilters {
	const query = plainObject(input, "filters");
	rejectUnknownFields(query, TRACE_FILTER_KEYS);

	const hasFrom = query.from !== undefined;
	const hasTo = query.to !== undefined;

	if (hasFrom !== hasTo || (requireDates && !hasFrom)) {
		invalidUsage("from", "Supply both from and to.");
	}

	const to = hasTo
		? new Date(normalizeUtcInstant(query.to, "to"))
		: new Date(now.getTime());

	const from = hasFrom
		? new Date(normalizeUtcInstant(query.from, "from"))
		: new Date(to.getTime() - 7 * DAY_MS);

	const duration = to.getTime() - from.getTime();

	if (duration <= 0 || duration > 90 * DAY_MS) {
		invalidUsage(
			"to",
			"The interval must be positive and must not exceed 90 days.",
		);
	}

	const result: ResolvedTraceFilters = { from, to };

	if (query.q !== undefined) {
		const q = text(query.q, "q", 100);
		if (q !== "") result.q = q;
	}

	if (query.provider !== undefined) {
		result.provider = normalizeIdentifier(query.provider, "provider");
	}

	if (query.model !== undefined) {
		result.model = normalizeIdentifier(query.model, "model");
	}

	if (query.workflow !== undefined) {
		const workflow = text(query.workflow, "workflow", 80);

		if (
			workflow === "" ||
			/[\u0000-\u001f\u007f-\u009f]/u.test(workflow)
		) {
			invalidUsage(
				"workflow",
				"Use 1–80 characters without control characters.",
			);
		}

		result.workflow = workflow;
	}

	if (query.status !== undefined) {
		if (query.status !== "SUCCESS" && query.status !== "ERROR") {
			invalidUsage("status", "Must be SUCCESS or ERROR.");
		}

		result.status = query.status;
	}

	return result;
}

// PostgreSQL LIKE/ILIKE treats these characters specially.
// Escape the escape character itself before using literal search.
export function escapeTraceSearch(value: string): string {
	return value.replace(/[\\%_]/g, character => "\\" + character);
}

export function traceMatchingWhere(
	filters: ResolvedTraceFilters,
): Prisma.TraceWhereInput {
	const where: Prisma.TraceWhereInput = {
		deletedAt: null,
		occurredAt: {
			gte: filters.from,
			lt: filters.to,
		},
	};

	if (filters.provider !== undefined) where.provider = filters.provider;
	if (filters.model !== undefined) where.model = filters.model;
	if (filters.workflow !== undefined) where.workflow = filters.workflow;
	if (filters.status !== undefined) where.status = filters.status;

	if (filters.q !== undefined) {
		const contains = escapeTraceSearch(filters.q);

		where.OR = [
			{ workflow: { contains, mode: "insensitive" } },
			{ externalId: { contains, mode: "insensitive" } },
			{ model: { contains, mode: "insensitive" } },
		];
	}

	return where;
}
