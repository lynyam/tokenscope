import { Injectable, PipeTransform } from "@nestjs/common";
import { normalizeTracePayload } from "../trace-payload";

export type TraceMetadata = Record<
	string,
	string | number | boolean | null
>;

export interface CreateTraceDto {
	externalId: string;
	provider: string;
	model: string;
	workflow: string;
	inputTokens: number;
	outputTokens: number;
	latencyMs: number;
	status: "SUCCESS" | "ERROR";
	occurredAt: string;
	metadata?: TraceMetadata;
}

export type NormalizedTracePayload =
	Omit<CreateTraceDto, "metadata"> & {
		metadata: TraceMetadata;
	};

@Injectable()
export class TracePayloadPipe
	implements PipeTransform<unknown, NormalizedTracePayload>
{
	transform(value: unknown): NormalizedTracePayload {
		// Capture the server clock once for this validation operation.
		return normalizeTracePayload(value, new Date());
	}
}
