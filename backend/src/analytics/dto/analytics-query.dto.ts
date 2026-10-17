import {
	Injectable,
	type PipeTransform,
} from "@nestjs/common";

import {
	invalidUsage,
	plainObject,
	rejectUnknownFields,
} from "../../common/validation/usage-values";

import {
	resolveTraceFilters,
	TRACE_FILTER_KEYS,
} from "../../traces/trace-filters";

import type {
	AnalyticsBucket,
	ResolvedAnalyticsQuery,
} from "../analytics.types";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

export function bucketWidth(bucket: AnalyticsBucket): number {
	return bucket === "hour" ? HOUR_MS : DAY_MS;
}

export function bucketStart(
	time: Date,
	bucket: AnalyticsBucket,
): number {
	const width = bucketWidth(bucket);
	return Math.floor(time.getTime() / width) * width;
}

export function parseAnalyticsQuery(
	input: unknown,
	now = new Date(),
	requireDates = false,
): ResolvedAnalyticsQuery {
	const query = plainObject(input, "query");

	rejectUnknownFields(query, [
		...TRACE_FILTER_KEYS,
		"bucket",
	]);

	// Do not send bucket to the shared filter parser:
	// it correctly rejects fields outside its own contract.
	const filterInput: Record<string, unknown> = {};

	for (const key of TRACE_FILTER_KEYS) {
		if (query[key] !== undefined) {
			filterInput[key] = query[key];
		}
	}

	const filters = resolveTraceFilters(
		filterInput,
		now,
		requireDates,
	);

	const duration =
		filters.to.getTime() - filters.from.getTime();

	const bucket =
		query.bucket ??
		(duration <= 48 * HOUR_MS ? "hour" : "day");

	if (bucket !== "hour" && bucket !== "day") {
		invalidUsage("bucket", "Must be hour or day.");
	}

	// Count intersecting UTC buckets, including partial first/last buckets.
	const count = Math.ceil(
		(
			filters.to.getTime() -
			bucketStart(filters.from, bucket)
		) / bucketWidth(bucket),
	);

	if (bucket === "hour" && count > 2160) {
		invalidUsage(
			"bucket",
			"The interval intersects more than 2160 hourly buckets. " +
			"Use day or shorten it.",
		);
	}

	return { filters, bucket };
}

@Injectable()
export class AnalyticsQueryPipe implements PipeTransform {
	transform(value: unknown): ResolvedAnalyticsQuery {
		return parseAnalyticsQuery(value);
	}
}
