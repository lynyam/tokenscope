import type { AnalyticsSnapshot, ResolvedAnalyticsQuery } from "../analytics/analytics.types";

// The fixed facts used for ONE answer. Built once, never changed.
export type AssistantContext = Pick<
	AnalyticsSnapshot,
	"snapshotId" | "generatedAt" | "window" | "filters" | "summary" | "series" | "byModel"
> & {
	project: {
		id: string;
		name: string;
		description: string | null;
	};
	pricing: {
		currency: "USD";
		containsSyntheticPricing: boolean;
	};
};

// Everything the service needs for one question.
export interface AskAssistantCommand {
	requestId: string;
	userId: string;
	organizationId: string;
	projectId: string;
	tokenExpiresAt: number; // epoch ms, from the verified JWT
	question: string;
	query: ResolvedAnalyticsQuery;
}

// --- Provider side (internal, uses `type`) ---

export interface ProviderUsage {
	inputTokens: number;
	outputTokens: number;
}

export type ProviderFailureKind = "refused" | "unavailable" | "busy" | "provider_error";

export type ProviderEvent =
	| { type: "open" } // the provider accepted the request: the stream can start
	| { type: "delta"; text: string }
	| { type: "done"; finishReason: "stop" | "length"; usage: ProviderUsage | null }
	| { type: "failure"; kind: ProviderFailureKind };
