/// <reference types="node" />
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Test-only browser client from the backend's installed dependency. No CDN and
// no Socket.IO code added to the production frontend before TSE-76.
const bundle = () => readFileSync(resolve(process.cwd(), "../backend/node_modules/socket.io-client/dist/socket.io.min.js"), "utf8");
const trace = JSON.parse(readFileSync(resolve(process.cwd(), "../fixtures/evaluation/realtime/live-trace-request.json"), "utf8"));
interface Notice { eventId: string; projectId: string; occurredAt: string }
interface ProbeSocket {
  on(name: string, listener: (...args: any[]) => void): ProbeSocket;
  timeout(ms: number): { emitWithAck(name: string, payload: unknown): Promise<{ ok: boolean; projectId?: string }> };
  io: { engine: { transport: { name: string } } };
}
declare global {
  interface Window {
    io: (namespace: string, options: Record<string, unknown>) => ProbeSocket;
    realtimeProbe: { events: Notice[]; socket: ProbeSocket };
  }
}
async function account(request: APIRequestContext) {
  const email = `rt-${crypto.randomUUID()}@e2e.tokenscope.test`;
  const response = await request.post("/api/v1/auth/signup", {
    data: { email, displayName: "Realtime QA", password: "E2e-Passw0rd!2026" },
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()), email };
}
async function watch(page: Page, token: string, organizationId: string, projectId: string, mode: string) {
  await page.goto("/");
  await page.addScriptTag({ content: bundle() });
  const ack = await page.evaluate(async args => {
    const socket = window.io("/realtime", {
      path: "/socket.io", auth: { token: args.token }, reconnection: false,
      transports: args.mode === "upgrade" ? ["polling", "websocket"] : [args.mode],
    });
    window.realtimeProbe = { socket, events: [] };
    socket.on("traces.changed", (notice: Notice) => window.realtimeProbe.events.push(notice));
    return new Promise<{ ok: boolean; projectId?: string }>((resolve, reject) => {
      socket.on("connect_error", reject);
      socket.on("connect", () => {
        socket.timeout(5000).emitWithAck("project.subscribe", {
          organizationId: args.organizationId, projectId: args.projectId,
        }).then(resolve, reject);
      });
    });
  }, { token, organizationId, projectId, mode });
  expect(ack).toEqual({ ok: true, projectId });
  await expect.poll(() => page.evaluate(() => window.realtimeProbe.socket.io.engine.transport.name))
    .toBe(mode === "polling" ? "polling" : "websocket");
}

for (const mode of ["polling", "websocket", "upgrade"]) {
  test(`two real browser clients receive a change through ${mode}`, async ({ browser, request, baseURL }) => {
    const owner = await account(request), member = await account(request);
    const headers = { Authorization: `Bearer ${owner.accessToken}` };
    const created = await request.post("/api/v1/organizations", { headers, data: { name: `Realtime ${crypto.randomUUID()}` } });
    expect(created.status()).toBe(201);
    const org = await created.json();
    const path = `/api/v1/organizations/${org.id}`;
    const contexts = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
    try {
      expect((await request.post(`${path}/members`, { headers, data: { email: member.email, role: "MEMBER" } })).status()).toBe(201);
      const projectResponse = await request.post(`${path}/projects`, { headers, data: { name: "Realtime QA" } });
      expect(projectResponse.status()).toBe(201);
      const project = await projectResponse.json();
      const keyResponse = await request.post(`${path}/projects/${project.id}/api-keys`, { headers, data: { name: "Disposable realtime QA" } });
      expect(keyResponse.status()).toBe(201);
      const apiKey = (await keyResponse.json()).key;
      const pages = [await contexts[0].newPage(), await contexts[1].newPage()];
      await Promise.all(pages.map((page, index) => watch(page, index === 0 ? owner.accessToken : member.accessToken, org.id, project.id, mode)));
      const response = await request.post("/api/v1/public/traces", {
        headers: { "X-API-Key": apiKey }, data: { ...trace, externalId: crypto.randomUUID() },
      });
      expect(response.status()).toBe(201);
      for (const page of pages) {
        await expect.poll(() => page.evaluate(() => window.realtimeProbe.events.length)).toBe(1);
        const [notice] = await page.evaluate(() => window.realtimeProbe.events);
        expect(Object.keys(notice).sort()).toEqual(["eventId", "occurredAt", "projectId"]);
        expect(notice.projectId).toBe(project.id);
      }
    } finally {
      await Promise.all(contexts.map(context => context.close()));
      expect((await request.delete(path, { headers, data: { confirmSlug: org.slug } })).status()).toBe(204);
    }
  });
}
