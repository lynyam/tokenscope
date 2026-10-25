import type { IncomingMessage } from "node:http";

export function parseRealtimeOrigins(value: unknown): string[] {
	if (value === undefined || value === "") return [];
	if (typeof value !== "string") throw new Error("Invalid REALTIME_ALLOWED_ORIGINS.");
	return [...new Set(value.split(",").map(part => {
		const origin = part.trim();
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new Error("Invalid REALTIME_ALLOWED_ORIGINS.");
		}
		if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
			throw new Error("REALTIME_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths.");
		}
		return origin;
	}))];
}

export function allowedRealtimeRequest(req: IncomingMessage, origins: readonly string[]): boolean {
	const origin = req.headers.origin;
	if (origin !== undefined) return typeof origin === "string" && origins.includes(origin);

	// Browsers may omit Origin on same-origin polling GETs. WebSocket upgrades
	// and requests without both same-origin signals remain forbidden.
	if (req.method !== "GET" || req.headers.upgrade !== undefined ||
		req.headers["sec-fetch-site"] !== "same-origin") {
			return false;
	}
	try {
		const url = new URL(req.url ?? "", "http://internal");
		const referer = req.headers.referer;
		return url.searchParams.get("transport") === "polling" &&
			typeof referer === "string" && origins.includes(new URL(referer).origin);
	} catch { return false; }
}
