import { vi } from "vitest";

export class FakeXHR extends EventTarget {
	static instances: FakeXHR[] = [];

	readonly upload = new EventTarget();
	readonly requestHeaders = new Headers();

	method = "";
	url = "";
	body: unknown;
	status = 0;
	responseText = "";
	responseURL = "";

	private responseHeaders = new Headers();

	constructor() {
		super();
		FakeXHR.instances.push(this);
	}

	open(method: string, url: string): void {
		this.method = method;
		this.url = url;
	}

	setRequestHeader(name: string, value: string): void {
		this.requestHeaders.set(name, value);
	}

	getResponseHeader(name: string): string | null {
		return this.responseHeaders.get(name);
	}

	send = vi.fn((body: unknown) => {
		this.body = body;
	});

	abort = vi.fn(() => {
		this.status = 0;
		this.dispatchEvent(new Event("abort"));
	});

	respond(
		status: number,
		body: string,
		headers: Record<string, string> = {
			"Content-Type": "application/json",
		},
		responseUrl?: string,
	): void {
		this.status = status;
		this.responseText = body;
		this.responseHeaders = new Headers(headers);
		this.responseURL =
			responseUrl ?? new URL(this.url, window.location.origin).href;

		this.dispatchEvent(new Event("load"));
	}

	progress(loaded: number, total?: number): void {
		this.upload.dispatchEvent(
			new ProgressEvent("progress", {
				loaded,
				total: total ?? 0,
				lengthComputable: total !== undefined,
			}),
		);
	}
}

export function lastXHR(): FakeXHR {
	const xhr = FakeXHR.instances.at(-1);

	if (!xhr) {
		throw new Error("The test expected an XMLHttpRequest to be created.");
	}

	return xhr;
}
