import { request as httpRequest, type ClientRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface SseEvent {
	event: string;
	data: any;
}

// A streaming HTTP client: gives events as soon as they arrive (no buffering).
export class SseConnection {
	status = 0;
	headers: IncomingMessage["headers"] = {};
	events: SseEvent[] = [];
	body = "";
	ended = false;
	response: IncomingMessage | null = null;
	// Resolves when the response headers arrive.
	ready: Promise<void> = Promise.resolve();

	private buffer = "";
	private waiters: Array<() => void> = [];
	private request: ClientRequest | null = null;

	// Sends the POST now. Use `await connection.ready` to wait for the headers.
	static start(server: Server, path: string, token: string, body: unknown, rawBody?: string): SseConnection {
		const connection = new SseConnection();
		const payload = rawBody ?? JSON.stringify(body);
		const { port } = server.address() as AddressInfo;

		connection.ready = new Promise((resolve, reject) => {
			const req = httpRequest({
				host: "127.0.0.1",
				port,
				path,
				method: "POST",
				headers: {
					"Authorization": `Bearer ${token}`,
					"Content-Type": "application/json",
					"Accept": "text/event-stream",
					"Content-Length": Buffer.byteLength(payload),
				},
			}, res => {
				connection.status = res.statusCode ?? 0;
				connection.headers = res.headers;
				connection.response = res;
				res.setEncoding("utf8");
				res.on("data", (text: string) => connection.receive(text));
				res.on("end", () => connection.finish());
				res.on("close", () => connection.finish());
				resolve();
			});

			req.on("error", error => {
				connection.finish();
				if (connection.status === 0) reject(error);
			});
			connection.request = req;
			req.end(payload);
		});
		connection.ready.catch(() => undefined);
		return connection;
	}

	// Sends the POST and waits for the response headers.
	static async open(server: Server, path: string, token: string, body: unknown, rawBody?: string): Promise<SseConnection> {
		const connection = SseConnection.start(server, path, token, body, rawBody);
		await connection.ready;
		return connection;
	}

	// Waits until at least `count` events arrived (or the stream ended).
	async waitForEvents(count: number, timeoutMs = 5000): Promise<SseEvent[]> {
		const deadline = Date.now() + timeoutMs;
		while (this.events.length < count && !this.ended) {
			if (Date.now() > deadline) throw new Error(`Timed out waiting for ${count} events`);
			await new Promise<void>(resolve => {
				this.waiters.push(resolve);
				setTimeout(resolve, 50);
			});
		}
		return this.events;
	}

	// Waits until the server closes the stream.
	async waitForEnd(timeoutMs = 5000): Promise<void> {
		await this.waitForEvents(Number.MAX_SAFE_INTEGER, timeoutMs).catch(() => undefined);
		if (!this.ended) throw new Error("Stream did not end");
	}

	// Simulates the user pressing Stop / closing the tab (works before or after headers).
	disconnect(): void {
		this.request?.destroy();
	}

	// Simulates a slow reader: stop / restart reading from the socket.
	pause(): void {
		this.response?.pause();
	}

	resume(): void {
		this.response?.resume();
	}

	json(): any {
		return JSON.parse(this.body);
	}

	private receive(text: string): void {
		this.body += text;
		this.buffer += text;
		let end = this.buffer.indexOf("\n\n");
		while (end !== -1) {
			const frame = this.buffer.slice(0, end);
			this.buffer = this.buffer.slice(end + 2);
			const lines = frame.split("\n");
			const event = lines.find(line => line.startsWith("event: "))?.slice(7) ?? "message";
			const data = lines.find(line => line.startsWith("data: "))?.slice(6);
			if (data !== undefined) this.events.push({ event, data: JSON.parse(data) });
			end = this.buffer.indexOf("\n\n");
		}
		this.wake();
	}

	private finish(): void {
		this.ended = true;
		this.wake();
	}

	private wake(): void {
		const waiters = this.waiters;
		this.waiters = [];
		for (const resolve of waiters) resolve();
	}
}
