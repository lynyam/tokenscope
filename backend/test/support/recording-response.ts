import { EventEmitter } from "node:events";
import type { Response } from "express";

// A tiny fake Express response for unit tests. Records what was written.
export class RecordingResponse extends EventEmitter {
	statusCode = 200;
	headers: Record<string, string> = {};
	chunks: string[] = [];
	headersSent = false;
	writableEnded = false;
	writableFinished = false;
	destroyed = false;
	// When false, write() reports "buffer full" (to test backpressure).
	hasRoom = true;

	status(code: number): this {
		this.statusCode = code;
		return this;
	}

	setHeader(name: string, value: string): this {
		this.headers[name.toLowerCase()] = value;
		return this;
	}

	flushHeaders(): void {
		this.headersSent = true;
	}

	write(chunk: string): boolean {
		this.headersSent = true;
		this.chunks.push(chunk);
		return this.hasRoom;
	}

	end(chunk?: string): this {
		if (chunk !== undefined) this.write(chunk);
		this.writableEnded = true;
		this.writableFinished = true;
		this.emit("finish");
		this.emit("close");
		return this;
	}

	destroy(): this { this.disconnect(); return this; }

	// Simulates the browser closing the connection.
	disconnect(): void {
		this.destroyed = true;
		this.emit("close");
	}

	// Parsed SSE events written so far.
	events(): Array<{ event: string; data: any }> {
		return this.chunks.join("").split("\n\n").filter(Boolean).map(frame => {
			const [eventLine, dataLine] = frame.split("\n");
			return { event: eventLine.slice("event: ".length), data: JSON.parse(dataLine.slice("data: ".length)) };
		});
	}

	asResponse(): Response {
		return this as unknown as Response;
	}
}
