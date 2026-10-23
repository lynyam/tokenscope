import type { IncomingMessage } from "node:http";
import { allowedRealtimeRequest, parseRealtimeOrigins } from "../../src/config/realtime-origins";

const origin = "http://localhost:5173";
const check = (headers: Record<string, string>, method = "GET", transport = "polling") =>
  allowedRealtimeRequest({ headers, method, url: `/socket.io/?transport=${transport}` } as IncomingMessage, [origin]);

describe("Realtime Origin policy", () => {
  it("parses exact origins and fails closed when unconfigured", () => {
    expect(parseRealtimeOrigins(undefined)).toEqual([]);
    expect(parseRealtimeOrigins(`${origin},https://localhost:8443`)).toEqual([origin, "https://localhost:8443"]);
  });
  it.each(["*", "null", "ftp://localhost", `${origin}/`, `${origin}/path`, "http://user:pass@localhost", "https://host,,https://other"])("rejects %s", value => {
    expect(() => parseRealtimeOrigins(value)).toThrow();
  });
  it("accepts allowed polling and websocket Origins", () => {
    expect(check({ origin })).toBe(true);
    expect(check({ origin, upgrade: "websocket" }, "GET", "websocket")).toBe(true);
  });
  it("allows only the explicit same-origin GET fallback", () => {
    const headers = { "sec-fetch-site": "same-origin", referer: `${origin}/organizations` };
    expect(check(headers)).toBe(true);
    expect(check(headers, "POST")).toBe(false);
    expect(check({ ...headers, upgrade: "websocket" }, "GET", "websocket")).toBe(false);
    expect(check({ ...headers, origin: "https://evil.test" })).toBe(false);
    expect(check({ ...headers, referer: "https://evil.test/" })).toBe(false);
    expect(check({ referer: `${origin}/` })).toBe(false);
    expect(check({})).toBe(false);
  });
});
