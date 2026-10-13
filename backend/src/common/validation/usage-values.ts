import { HttpStatus } from "@nestjs/common";
import { ApiException } from "../errors/api.exception";

export function invalidUsage(
	field: string,
	message: string,
): never {
	throw new ApiException(
		HttpStatus.BAD_REQUEST,
		"VALIDATION_ERROR",
		"Request validation failed.",
		[{ field, messages: [message] }],
	);
}

export function plainObject(
	value: unknown,
	field: string,
): Record<string, unknown> {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value)
	) {
		invalidUsage(field, "Must be a JSON object.");
	}

	const prototype = Object.getPrototypeOf(value);

	if (
		prototype !== Object.prototype &&
		prototype !== null
	) {
		invalidUsage(field, "Must be a plain JSON object.");
	}

	return value as Record<string, unknown>;
}

export function rejectUnknownFields(
	value: Record<string, unknown>,
	allowed: readonly string[],
): void {
	const permitted = new Set(allowed);

	for (const key of Object.keys(value)) {
		if (!permitted.has(key)) {
			invalidUsage(key, "Unknown field.");
		}
	}
}

export function normalizeIdentifier(
	value: unknown,
	field: "provider" | "model",
): string {
	if (typeof value !== "string") {
		invalidUsage(field, "Must be a string.");
	}

	const normalized = value.trim().toLowerCase();
	const maximum = field === "provider" ? 40 : 100;
	const pattern = field === "provider"
		? /^[a-z0-9][a-z0-9._-]*$/
		: /^[a-z0-9][a-z0-9._:/-]*$/;

	if (
		normalized.length > maximum ||
		!pattern.test(normalized)
	) {
		invalidUsage(
			field,
			`Must be a valid ${field} identifier of 1–${maximum} characters.`,
		);
	}

	return normalized;
}

export function normalizeUtcInstant(
	value: unknown,
	field: string,
): string {
	if (typeof value !== "string") {
		invalidUsage(field, "Must be an ISO UTC timestamp.");
	}

	const match =
		/^(?!0000)(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/
			.exec(value);

	if (!match) {
		invalidUsage(
			field,
			"Use a UTC timestamp ending in Z, with at most three fractional digits.",
		);
	}

	const canonical =
		`${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`;

	const date = new Date(canonical);

	// The round trip rejects impossible dates such as February 30.
	if (
		!Number.isFinite(date.getTime()) ||
		date.toISOString() !== canonical
	) {
		invalidUsage(field, "Must identify a real UTC instant.");
	}

	return canonical;
}

export function boundedInteger(
	value: unknown,
	field: string,
	maximum: number,
): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > maximum
	) {
		invalidUsage(
			field,
			`Must be a JSON integer between 0 and ${maximum}.`,
		);
	}

	return value;
}

export function assertDatabaseText(
	value: string,
	field: string,
): void {
	// PostgreSQL text/JSONB cannot represent U+0000.
	if (value.includes("\u0000")) {
		invalidUsage(field, "Null characters are not supported.");
	}

	// Reject unpaired UTF-16 surrogates instead of allowing replacement
	// characters to change the value between hashing and persistence.
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);

		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);

			if (!(next >= 0xdc00 && next <= 0xdfff)) {
				invalidUsage(field, "Must contain valid Unicode.");
			}

			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			invalidUsage(field, "Must contain valid Unicode.");
		}
	}
}
