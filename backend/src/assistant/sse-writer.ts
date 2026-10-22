import type { Response } from "express";

import { REQUEST_ID_HEADER } from "../common/constants/http.constants";

// A delta never carries more than this many characters (keeps frames < 64 KiB).
const MAX_DELTA_CHARS = 4000;

// Sends the 200 headers that start a Server-Sent Events stream.
export function openStream(res: Response, requestId: string): void {
	res.status(200);
	res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.setHeader(REQUEST_ID_HEADER, requestId);
	res.flushHeaders();
}

// Writes one SSE event. Waits when the client reads slowly (backpressure).
export async function sendEvent(res: Response, event: string, data: unknown, signal?: AbortSignal,): Promise<void> {
	if (signal?.aborted || res.writableEnded || res.destroyed) {
		return; // nobody to write to: ignore late events
	}

	const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

	if (!res.write(frame)) {
		await waitForDrain(res, signal);
	}
}

// Writes a text delta, split in small pieces if it is very long.
export async function sendDelta(res: Response, text: string, signal?: AbortSignal,): Promise<void> {
	const characters = [...text]; // split by characters, never inside an emoji
	for (let start = 0; start < characters.length; start += MAX_DELTA_CHARS) {
		if (signal?.aborted || res.writableEnded || res.destroyed) return;
		const piece = characters.slice(start, start + MAX_DELTA_CHARS).join("");
		await sendEvent(res, "delta", { text: piece }, signal);
	}
}

// A terminal frame must not retain the user's slot while waiting for drain.
// Allow buffered bytes to flush, then destroy an unresponsive connection.
export function sendFinalEvent(
	res: Response,
	event: "done" | "error",
	data: unknown,
  ): void {
	if (res.writableEnded || res.destroyed) return;

	const timer = setTimeout(() => {
	  if (!res.writableFinished && !res.destroyed) res.destroy();
	}, 5000);
	timer.unref();

	const cleanup = () => {
	  clearTimeout(timer);
	  res.off("finish", cleanup);
	  res.off("close", cleanup);
	};

	res.once("finish", cleanup);
	res.once("close", cleanup);

	res.end(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Resolves when the socket can take more data, or when it closes.
function waitForDrain(res: Response, signal?: AbortSignal): Promise<void> {
	return new Promise(resolve => {
		const done = () => {
			res.off("drain", done);
			res.off("close", done);
			signal?.removeEventListener("abort", done);
			resolve();
		};
		res.on("drain", done);
		res.on("close", done);
		signal?.addEventListener("abort", done, { once: true });
		if (signal?.aborted || res.destroyed || res.writableEnded) done();
	});
}
