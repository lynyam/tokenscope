// Controlled XMLHttpRequest double: tests decide when progress, responses and failures happen.
export class FakeXhr {
  static instances: FakeXhr[] = [];
  static get last(): FakeXhr { return FakeXhr.instances[FakeXhr.instances.length - 1]; }

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;

  method = "";
  url = "";
  body: unknown;
  sent = false;
  aborted = false;
  status = 0;
  responseText = "";
  requestHeaders: Record<string, string> = {};
  private responseHeaders: Record<string, string> = {};

  constructor() { FakeXhr.instances.push(this); }

  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.requestHeaders[name.toLowerCase()] = value; }
  send(body: unknown) { this.sent = true; this.body = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  getResponseHeader(name: string) { return this.responseHeaders[name.toLowerCase()] ?? null; }

  progress(loaded: number, total?: number) {
    this.upload.onprogress?.({ loaded, total: total ?? 0, lengthComputable: total !== undefined } as ProgressEvent);
  }
  respond(status: number, body: string, headers: Record<string, string> = { "Content-Type": "application/json" }) {
    this.status = status;
    this.responseText = body;
    this.responseHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    this.onload?.();
  }
  networkFailure() { this.onerror?.(); }

  hasListeners() {
    return Boolean(this.upload.onprogress || this.onload || this.onerror || this.onabort || this.ontimeout);
  }
}
