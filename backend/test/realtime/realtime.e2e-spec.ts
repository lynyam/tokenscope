import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Socket } from "socket.io-client";
import { ConfigService } from "@nestjs/config";
import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/database/prisma.service";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { TokenService } from "../../src/auth/token.service";
import { TraceChangesService } from "../../src/traces/trace-changes.service";
import { client, connected, event, subscribe, TEST_ORIGIN } from "../support/realtime-client";

// Real Nest + JWT + Socket.IO transports; DB reads are substituted here.
// realtime.integration.spec.ts verifies the actual PostgreSQL authorization.
describe("Realtime transport", () => {
  let app: INestApplication, url: string, token: string;
  const user = randomUUID(), org = randomUUID(), project = randomUUID();
  const sockets: Socket[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({ project: { findFirst: async () => ({ organization: { memberships: [{ userId: user }] } }) } })
      .overrideProvider(ProjectAccessService).useValue({ assertProjectAccess: async () => ({ id: project }) })
      .compile();
    const config = module.get(ConfigService);
    const get = config.get.bind(config);
    jest.spyOn(config, "get").mockImplementation((key: string, ...args: unknown[]) =>
      key === "REALTIME_ALLOWED_ORIGINS" ? [TEST_ORIGIN] : (get as Function)(key, ...args));
    app = module.createNestApplication({ logger: false });
    await app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    token = app.get(TokenService).signAccessToken(user).accessToken;
  });
  afterEach(() => { sockets.splice(0).forEach(socket => socket.disconnect()); });
  afterAll(async () => { await app?.close(); jest.restoreAllMocks(); });
  const make = (options = {}, auth: string | undefined = token) => {
    const socket = client(url, auth, options); sockets.push(socket); return socket;
  };

  it.each(["polling", "websocket"])("delivers through %s", async transport => {
    const socket = make({ transports: [transport] });
    await connected(socket);
    expect(await subscribe(socket, org, project)).toEqual({ ok: true, projectId: project });
    const received = event(socket, "traces.changed");
    await app.get(TraceChangesService).publish({ projectId: project });
    expect(await received).toMatchObject({ projectId: project });
  });
  it("upgrades polling to websocket", async () => {
    const socket = make();
    // Install the upgrade listener before initiating the connection.
    const upgraded = new Promise<void>(resolve => {
      socket.io.once("open", () => {
        if (socket.io.engine.transport.name === "websocket") resolve();
        else socket.io.engine.once("upgrade", () => resolve());
      });
    });
    await connected(socket);
    await upgraded;
    expect(socket.io.engine.transport.name).toBe("websocket");
  });
  it.each(["polling", "websocket"])("blocks missing and hostile Origin on %s", async transport => {
    for (const extraHeaders of [{}, { Origin: "https://evil.test" }]) {
      const socket = make({ transports: [transport], extraHeaders });
      const failure = event(socket, "connect_error");
      socket.connect();
      await failure;
      expect(socket.connected).toBe(false);
    }
  });
  it("accepts the browser's same-origin polling GET headers", async () => {
    const response = await fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
      headers: { "Sec-Fetch-Site": "same-origin", Referer: `${TEST_ORIGIN}/` },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/^0\{/);
  });
  it("rejects an invalid JWT with a safe code", async () => {
    const socket = make({}, "invalid");
    const failure = event<{ data: { code: string } }>(socket, "connect_error");
    socket.connect();
    expect((await failure).data.code).toBe("INVALID_ACCESS_TOKEN");
  });
  it("rejects unknown fields and accepts bodyless unsubscribe", async () => {
    const socket = make();
    await connected(socket);
    expect(await socket.timeout(3000).emitWithAck("project.subscribe", { organizationId: org, projectId: project, room: "forged" }))
      .toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(await socket.timeout(3000).emitWithAck("project.unsubscribe")).toEqual({ ok: true });
  });
});
