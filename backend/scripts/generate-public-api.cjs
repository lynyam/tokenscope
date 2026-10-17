const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { resolve, dirname } = require("node:path");

const ref = name => ({ $ref: `#/components/schemas/${name}` });
const integer = maximum => ({ type: "integer", minimum: 0, maximum });
const timestamp = {
	type: "string",
	format: "date-time",
	pattern: "Z$",
};
const rate = {
	type: "string",
	pattern: "^\\d+\\.\\d{6}$",
	examples: ["1.000000"],
};
const cost = {
	type: "string",
	pattern: "^\\d+\\.\\d{12}$",
	examples: ["0.001800000000"],
};
const uuid = { type: "string", format: "uuid" };

const inputProperties = {
	externalId: {
		type: "string",
		minLength: 1,
		maxLength: 128,
		pattern: "^[A-Za-z0-9._:-]+$",
		description: "Trimmed; case preserved. Immutable after creation.",
	},
	provider: {
		type: "string",
		minLength: 1,
		maxLength: 40,
		description: "Trimmed and lowercased provider identifier.",
	},
	model: {
		type: "string",
		minLength: 1,
		maxLength: 100,
		description: "Trimmed and lowercased model identifier.",
	},
	workflow: {
		type: "string",
		minLength: 1,
		maxLength: 80,
		description: "Trimmed, case-sensitive; control characters forbidden.",
	},
	inputTokens: integer(1000000000),
	outputTokens: integer(1000000000),
	latencyMs: integer(86400000),
	status: { type: "string", enum: ["SUCCESS", "ERROR"] },
	occurredAt: {
		...timestamp,
		description:
			"Real UTC instant, at most three fractional digits, no more than five minutes in the future.",
	},
	metadata: {
		type: "object",
		maxProperties: 20,
		propertyNames: { minLength: 1, maxLength: 64 },
		additionalProperties: {
			anyOf: [
				{ type: "string", maxLength: 400 },
				{ type: "number" },
				{ type: "boolean" },
				{ type: "null" },
			],
		},
		description:
			"Flat JSON object, maximum 4096 UTF-8 bytes. Omission means {}.",
	},
};

const requiredInput = Object.keys(inputProperties).filter(
	name => name !== "metadata",
);

const exampleInput = {
	externalId: "swagger-demo-001",
	provider: "fixture-a",
	model: "demo-fast",
	workflow: "support",
	inputTokens: 1000,
	outputTokens: 200,
	latencyMs: 500,
	status: "SUCCESS",
	occurredAt: "2026-10-01T10:00:00.000Z",
	metadata: {},
};

const traceProperties = {
	id: uuid,
	projectId: uuid,
	...inputProperties,
	priceVersionId: uuid,
	pricing: {
		type: "object",
		additionalProperties: false,
		required: [
			"inputUsdPerMillion",
			"outputUsdPerMillion",
			"currency",
			"isSynthetic",
		],
		properties: {
			inputUsdPerMillion: rate,
			outputUsdPerMillion: rate,
			currency: { type: "string", const: "USD" },
			isSynthetic: { type: "boolean" },
		},
	},
	inputCostUsd: cost,
	outputCostUsd: cost,
	estimatedCostUsd: cost,
	version: { type: "integer", minimum: 1, maximum: 2147483647 },
	createdAt: timestamp,
	updatedAt: timestamp,
};

const requestIdHeader = {
	description: "Request correlation identifier.",
	schema: { type: "string" },
};

const traceResponse = description => ({
	description,
	headers: {
		ETag: {
			description: "Quoted trace version. Supply this value in If-Match.",
			schema: { type: "string", examples: ['"1"'] },
		},
		"X-Request-Id": requestIdHeader,
	},
	content: {
		"application/json": { schema: ref("Trace") },
	},
});

const errorResponse = description => ({
	description,
	headers: { "X-Request-Id": requestIdHeader },
	content: {
		"application/json": { schema: ref("ApiError") },
	},
});

const commonErrors = {
	400: errorResponse("VALIDATION_ERROR or MODEL_PRICE_NOT_FOUND."),
	401: errorResponse(
		"INVALID_API_KEY: missing, invalid, revoked key or archived parent.",
	),
	429: {
		...errorResponse("RATE_LIMITED."),
		headers: {
			"X-Request-Id": requestIdHeader,
			"Retry-After": {
				description: "Seconds before a deliberate retry.",
				schema: { type: "integer", minimum: 1 },
			},
		},
	},
	500: errorResponse("Safe INTERNAL_SERVER_ERROR."),
};

const mutationErrors = {
	...commonErrors,
	404: errorResponse("TRACE_NOT_FOUND."),
	409: errorResponse(
		"CONCURRENT_MODIFICATION or TRACE_VERSION_EXHAUSTED.",
	),
	412: errorResponse("TRACE_VERSION_CONFLICT."),
	428: errorResponse("TRACE_VERSION_REQUIRED."),
};

const traceIdParameter = {
	name: "traceId",
	in: "path",
	required: true,
	schema: uuid,
};

const ifMatchParameter = {
	name: "If-Match",
	in: "header",
	required: true,
	description:
		'Exactly one quoted positive version, such as "1". Weak tags, lists and wildcard are rejected.',
	schema: {
		type: "string",
		pattern: '^"[1-9][0-9]*"$',
		examples: ['"1"'],
	},
};

const body = {
	required: true,
	description:
		"Maximum actual JSON body size: 16384 bytes. Unknown/server-owned fields are rejected.",
	content: {
		"application/json": {
			schema: ref("TraceInput"),
			example: exampleInput,
		},
	},
};

function queryParameter(name, schema, description) {
	return { name, in: "query", required: false, schema, description };
}

const document = {
	openapi: "3.1.2",
	info: {
		title: "TokenScope Public Trace API",
		version: "1.0.0",
		description:
			"Project-scoped trace API. Obtain a project key using the authenticated workspace API. " +
			"Keep keys in your server environment. All five operations share quotas: " +
			"60 requests/minute/IP before authentication and 120 requests/minute/key. " +
			"Documentation endpoints do not count as trace operations.",
	},
	servers: [{ url: "/api/v1" }],
	security: [{ ProjectApiKey: [] }],
	tags: [{ name: "Traces", description: "Stored project usage traces." }],
	paths: {
		"/public/traces": {
			post: {
				tags: ["Traces"],
				operationId: "createTrace",
				summary: "Create a trace or replay identical normalized content",
				description:
					"The key determines the project. Stored historical pricing is selected from occurredAt. " +
					"An identical replay does not reprice or change timestamps. Deleted identities remain reserved.",
				requestBody: body,
				responses: {
					201: traceResponse("Created."),
					200: traceResponse("Identical replay."),
					...commonErrors,
					409: errorResponse(
						"TRACE_EXTERNAL_ID_CONFLICT, TRACE_DELETED or CONCURRENT_MODIFICATION.",
					),
					413: errorResponse("PAYLOAD_TOO_LARGE."),
					415: errorResponse("UNSUPPORTED_MEDIA_TYPE."),
				},
			},
			get: {
				tags: ["Traces"],
				operationId: "listTraces",
				summary: "Search and paginate traces",
				description:
					"Both dates or neither. Default: last seven days resolved once. " +
					"Maximum interval 90 days; from <= occurredAt < to. " +
					"Unknown/repeated parameters are rejected. Search fields use OR; filters use AND. " +
					"Deleted traces are excluded. Count and rows share a snapshot; separate pages remain live.",
				parameters: [
					queryParameter("from", timestamp, "Inclusive UTC start; requires to."),
					queryParameter("to", timestamp, "Exclusive UTC end; requires from."),
					queryParameter(
						"q",
						{ type: "string", maxLength: 100 },
						"Trimmed literal case-insensitive substring over workflow, externalId and model. Empty means absent.",
					),
					queryParameter("provider", { type: "string", maxLength: 40 }, "Exact normalized provider."),
					queryParameter("model", { type: "string", maxLength: 100 }, "Exact normalized model."),
					queryParameter("workflow", { type: "string", minLength: 1, maxLength: 80 }, "Exact trimmed case-sensitive workflow."),
					queryParameter("status", { type: "string", enum: ["SUCCESS", "ERROR"] }, "Exact status."),
					queryParameter("page", { type: "integer", minimum: 1, default: 1 }, "Positive decimal integer; safe calculated offset required."),
					queryParameter("pageSize", { type: "integer", minimum: 1, maximum: 100, default: 25 }, "Maximum 100."),
					queryParameter("sortBy", {
						type: "string",
						enum: ["occurredAt", "estimatedCostUsd", "latencyMs", "inputTokens", "outputTokens"],
						default: "occurredAt",
					}, "Always followed by id ASC."),
					queryParameter("sortOrder", {
						type: "string",
						enum: ["asc", "desc"],
						default: "desc",
					}, "Primary sort direction."),
				],
				responses: {
					200: {
						description:
							"Page. Empty results have totalPages 0. An out-of-range page retains actual totals.",
						headers: { "X-Request-Id": requestIdHeader },
						content: {
							"application/json": { schema: ref("TracePage") },
						},
					},
					...commonErrors,
				},
			},
		},
		"/public/traces/{traceId}": {
			parameters: [traceIdParameter],
			get: {
				tags: ["Traces"],
				operationId: "getTrace",
				summary: "Read a trace and its version",
				description:
					"No default date window is applied. Costs and rates are stored historical values.",
				responses: {
					200: traceResponse("Trace found."),
					...commonErrors,
					404: errorResponse("TRACE_NOT_FOUND, including another project's trace."),
				},
			},
			put: {
				tags: ["Traces"],
				operationId: "replaceTrace",
				summary: "Replace writable content using the current version",
				description:
					"Full replacement; externalId is immutable. Omitted metadata becomes {}. " +
					"A current-version no-op preserves prices, version and timestamps. " +
					"A changed replacement reprices using its occurredAt and increments version. " +
					"Stale requests return 412 even if their content matches. Refetch and reconsider; do not blindly overwrite.",
				parameters: [ifMatchParameter],
				requestBody: body,
				responses: {
					200: traceResponse("Replaced or unchanged."),
					...mutationErrors,
					413: errorResponse("PAYLOAD_TOO_LARGE."),
					415: errorResponse("UNSUPPORTED_MEDIA_TYPE."),
				},
			},
			delete: {
				tags: ["Traces"],
				operationId: "deleteTrace",
				summary: "Soft-delete a trace using the current version",
				description:
					"Retains the row and externalId. Later GET/DELETE returns 404. " +
					"POST with the same identity returns TRACE_DELETED. No request body is required.",
				parameters: [ifMatchParameter],
				responses: {
					204: {
						description: "Deleted; no response body.",
						headers: { "X-Request-Id": requestIdHeader },
					},
					...mutationErrors,
				},
			},
		},
	},
	components: {
		securitySchemes: {
			ProjectApiKey: {
				type: "apiKey",
				in: "header",
				name: "X-API-Key",
				description: "Project key. A user JWT does not authorize this API.",
			},
		},
		schemas: {
			TraceInput: {
				type: "object",
				additionalProperties: false,
				required: requiredInput,
				properties: inputProperties,
			},
			Trace: {
				type: "object",
				additionalProperties: false,
				required: Object.keys(traceProperties),
				properties: traceProperties,
			},
			TracePage: {
				type: "object",
				additionalProperties: false,
				required: ["items", "page", "pageSize", "total", "totalPages"],
				properties: {
					items: { type: "array", items: ref("Trace") },
					page: { type: "integer", minimum: 1 },
					pageSize: { type: "integer", minimum: 1, maximum: 100 },
					total: { type: "integer", minimum: 0 },
					totalPages: { type: "integer", minimum: 0 },
				},
			},
			ApiError: {
				type: "object",
				additionalProperties: false,
				required: ["statusCode", "code", "error", "message", "requestId"],
				properties: {
					statusCode: { type: "integer", minimum: 400, maximum: 599 },
					code: { type: "string" },
					error: { type: "string" },
					message: { type: "string" },
					requestId: { type: "string" },
					details: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["field", "messages"],
							properties: {
								field: { type: "string" },
								messages: { type: "array", items: { type: "string" } },
							},
						},
					},
				},
			},
		},
	},
};

const output = JSON.stringify(document, null, 2) + "\n";
const backendFile = resolve(
	__dirname,
	"../src/public-docs/public-api.json",
);
const repositoryFile = resolve(
	__dirname,
	"../../docs/openapi/public-api.json",
);

const files = process.argv.includes("--backend-only")
	? [backendFile]
	: [backendFile, repositoryFile];

for (const file of files) {
	if (process.argv.includes("--check")) {
		if (readFileSync(file, "utf8") !== output) {
			throw new Error(`Generated specification is outdated: ${file}`);
		}
	} else {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, output);
	}
}