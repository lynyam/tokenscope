import { createHash } from "node:crypto";
import {
	assertDatabaseText,
	boundedInteger,
	invalidUsage,
	normalizeIdentifier,
	normalizeUtcInstant,
	plainObject,
	rejectUnknownFields,
} from "../common/validation/usage-values";
import type {
	NormalizedTracePayload,
	TraceMetadata,
} from "./dto/create-trace.dto";

const WRITABLE_FIELDS = [
	"externalId",
	"provider",
	"model",
	"workflow",
	"inputTokens",
	"outputTokens",
	"latencyMs",
	"status",
	"occurredAt",
	"metadata",
] as const;

function normalizeMetadata(value: unknown): TraceMetadata {
	const object = plainObject(value, "metadata");
	const entries = Object.entries(object);

	if (entries.length > 20) {
		invalidUsage("metadata", "Must contain at most 20 keys.");
	}

	for (const [key, entry] of entries) {
		assertDatabaseText(key, "metadata");

		if ([...key].length < 1 || [...key].length > 64) {
			invalidUsage(
				"metadata",
				"Each key must contain 1–64 characters.",
			);
		}

		if (typeof entry === "string") {
			assertDatabaseText(entry, "metadata");

			if ([...entry].length > 400) {
				invalidUsage(
					"metadata",
					"String values must contain at most 400 characters.",
				);
			}
		} else if (typeof entry === "number") {
			if (!Number.isFinite(entry)) {
				invalidUsage("metadata", "Numbers must be finite.");
			}
		} else if (
			entry !== null &&
			typeof entry !== "boolean"
		) {
			invalidUsage(
				"metadata",
				"Values must be strings, finite numbers, booleans or null.",
			);
		}
	}

	const serialized = JSON.stringify(object);

	if (Buffer.byteLength(serialized, "utf8") > 4096) {
		invalidUsage("metadata", "Must not exceed 4096 UTF-8 bytes.");
	}

	// Copy JSON data without assigning attacker-controlled property names.
	return JSON.parse(serialized) as TraceMetadata;
}

export function normalizeTracePayload(
	input: unknown,
	now = new Date(),
): NormalizedTracePayload {
	const body = plainObject(input, "body");
	rejectUnknownFields(body, WRITABLE_FIELDS);

	if (typeof body.externalId !== "string") {
		invalidUsage("externalId", "Must be a string.");
	}

	const externalId = body.externalId.trim();

	if (!/^[A-Za-z0-9._:-]{1,128}$/.test(externalId)) {
		invalidUsage(
			"externalId",
			"Use 1–128 ASCII letters, digits, dots, underscores, colons or hyphens.",
		);
	}

	if (typeof body.workflow !== "string") {
		invalidUsage("workflow", "Must be a string.");
	}

	assertDatabaseText(body.workflow, "workflow");

	if (/[\u0000-\u001f\u007f-\u009f]/u.test(body.workflow)) {
		invalidUsage("workflow", "Control characters are not allowed.");
	}

	const workflow = body.workflow.trim();

	if ([...workflow].length < 1 || [...workflow].length > 80) {
		invalidUsage("workflow", "Must contain 1–80 characters.");
	}

	if (body.status !== "SUCCESS" && body.status !== "ERROR") {
		invalidUsage("status", "Must be SUCCESS or ERROR.");
	}

	const occurredAt = normalizeUtcInstant(
		body.occurredAt,
		"occurredAt",
	);

	if (
		new Date(occurredAt).getTime() >
		now.getTime() + 5 * 60_000
	) {
		invalidUsage(
			"occurredAt",
			"Must not be more than five minutes in the future.",
		);
	}

	return {
		externalId,
		provider: normalizeIdentifier(body.provider, "provider"),
		model: normalizeIdentifier(body.model, "model"),
		workflow,
		inputTokens: boundedInteger(
			body.inputTokens,
			"inputTokens",
			1_000_000_000,
		),
		outputTokens: boundedInteger(
			body.outputTokens,
			"outputTokens",
			1_000_000_000,
		),
		latencyMs: boundedInteger(
			body.latencyMs,
			"latencyMs",
			86_400_000,
		),
		status: body.status,
		occurredAt,
		metadata: body.metadata === undefined
			? {}
			: normalizeMetadata(body.metadata),
	};
}

export function hashTracePayload(
	payload: NormalizedTracePayload,
): string {
	const metadata = Object.entries(payload.metadata)
		.sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		);

	// An ordered tuple avoids depending on incoming object property order.
	// Metadata entries preserve keys safely, including "__proto__".
	const canonical = JSON.stringify([
		payload.externalId,
		payload.provider,
		payload.model,
		payload.workflow,
		payload.inputTokens,
		payload.outputTokens,
		payload.latencyMs,
		payload.status,
		payload.occurredAt,
		metadata,
	]);

	return createHash("sha256").update(canonical).digest("hex");
}
