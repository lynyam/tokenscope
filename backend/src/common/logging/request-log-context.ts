import { isUUID } from "class-validator";
import type { RequestWithRequestId } from "../types/request-with-request-id";

const RESOURCE_ID_PARAMS = [
	"organizationId",
	"projectId",
	"userId",
	"membershipId",
] as const;

export function requestLogContext(request: RequestWithRequestId) {
	const route: unknown = request.route?.path;
	const resourceIds: Record<string, string> = {};

	for (const name of RESOURCE_ID_PARAMS) {
		const value: unknown = request.params?.[name];
		if (typeof value === "string" && value.length === 36 && isUUID(value, "all")) {
			resourceIds[name] = value;
		}
	}
	return {
		requestId: request.requestId,
		method: request.method,
		route: typeof route === "string" ? route : "<unmatched>",
		...(Object.keys(resourceIds).length > 0 ? { resourceIds } : {}),
	};
}
