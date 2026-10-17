import { Injectable, type PipeTransform } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import {
	invalidUsage,
	plainObject,
	rejectUnknownFields,
} from "../../common/validation/usage-values";
import {
	resolveTraceFilters,
	TRACE_FILTER_KEYS,
	type ResolvedTraceFilters,
} from "../trace-filters";

const SORT_FIELDS = [
	"occurredAt",
	"estimatedCostUsd",
	"latencyMs",
	"inputTokens",
	"outputTokens",
] as const;

type SortField = typeof SORT_FIELDS[number];

export interface TraceListQuery {
	filters: ResolvedTraceFilters;
	page: number;
	pageSize: number;
	skip: number;
	sortBy: SortField;
	sortOrder: "asc" | "desc";
}

function positiveInteger(
	value: unknown,
	field: string,
	fallback: number,
	maximum: number,
): number {
	if (value === undefined) return fallback;

	if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
		invalidUsage(field, "Must be a positive decimal integer.");
	}

	const parsed = Number(value);

	if (!Number.isSafeInteger(parsed) || parsed > maximum) {
		invalidUsage(field, `Must not exceed ${maximum}.`);
	}

	return parsed;
}

export function parseTraceListQuery(
	input: unknown,
	now = new Date(),
): TraceListQuery {
	const query = plainObject(input, "query");

	rejectUnknownFields(query, [
		...TRACE_FILTER_KEYS,
		"page",
		"pageSize",
		"sortBy",
		"sortOrder",
	]);

	const filterInput: Record<string, unknown> = {};

	for (const key of TRACE_FILTER_KEYS) {
		if (query[key] !== undefined) filterInput[key] = query[key];
	}

	const filters = resolveTraceFilters(filterInput, now);

	const page = positiveInteger(
		query.page,
		"page",
		1,
		Number.MAX_SAFE_INTEGER,
	);

	const pageSize = positiveInteger(query.pageSize, "pageSize", 25, 100);

	const skip = (page - 1) * pageSize;

	if (!Number.isSafeInteger(skip)) {
		invalidUsage("page", "The calculated pagination offset is too large.");
	}

	const sortBy = query.sortBy ?? "occurredAt";

	if (
		typeof sortBy !== "string" ||
		!SORT_FIELDS.includes(sortBy as SortField)
	) {
		invalidUsage("sortBy", "Unsupported sort field.");
	}

	const sortOrder = query.sortOrder ?? "desc";

	if (sortOrder !== "asc" && sortOrder !== "desc") {
		invalidUsage("sortOrder", "Must be asc or desc.");
	}

	return {
		filters,
		page,
		pageSize,
		skip,
		sortBy: sortBy as SortField,
		sortOrder,
	};
}

export function traceOrderBy(
	query: TraceListQuery,
): Prisma.TraceOrderByWithRelationInput[] {
	return [
		{ [query.sortBy]: query.sortOrder },
		{ id: "asc" },
	];
}

@Injectable()
export class TraceQueryPipe implements PipeTransform {
	transform(value: unknown): TraceListQuery {
		return parseTraceListQuery(value);
	}
}