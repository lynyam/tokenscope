import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { sign } from "jsonwebtoken";
import request = require("supertest");
import type { Socket } from "socket.io-client";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { TokenService } from "../../src/auth/token.service";
import { PricingService } from "../../src/pricing/pricing.service";
import { TraceChangesService } from "../../src/traces/trace-changes.service";
import { TracesService } from "../../src/traces/traces.service";
import { normalizeTracePayload } from "../../src/traces/trace-payload";
import { ProjectAccessService } from "../../src/projects/project-access.service";
import { ApiKeyAuthService } from "../../src/api-keys/api-key-auth.service";
import { RateLimitClock } from "../../src/common/rate-limit/rate-limit.service";
import { resetTestDatabase } from "../support/reset-test-database";
import { client, connected, event, subscribe, settleWindow } from "../support/realtime-client";

const directory = existsSync("/fixtures/evaluation") ? "/fixtures/evaluation" : resolve(process.cwd(), "../fixtures/evaluation");
const fixture = (name: string) => JSON.parse(readFileSync(resolve(directory, name), "utf8"));
const body: Record<string, unknown> = fixture("realtime/live-trace-request.json");
const ids = { owner: randomUUID(), admin: randomUUID(), member: randomUUID(), outsider: randomUUID(), org: randomUUID(), foreignOrg: randomUUID(), project: randomUUID(), other: randomUUID() };
const orgPath = `/api/v1/organizations/${ids.org}`;
const projectPath = `${orgPath}/projects/${ids.project}`;

describe("Realtime with PostgreSQL", () => {
  let app: INestApplication, db: PrismaService, tokens: TokenService, url: string, key: string;
  let now = 0;
  const sockets: Socket[] = [];
  const bearer = (userId = ids.owner) => `Bearer ${tokens.signAccessToken(userId).accessToken}`;
  const post = (payload: Record<string, unknown> = body) => request(app.getHttpServer())
    .post("/api/v1/public/traces").set("X-API-Key", key).send(payload);
  async function open(userId = ids.owner, token = tokens.signAccessToken(userId).accessToken) {
    const socket = client(url, token, { transports: ["websocket"] });
    sockets.push(socket); await connected(socket); return socket;
  }
  async function viewer(userId = ids.owner, projectId = ids.project) {
    const socket = await open(userId);
    expect(await subscribe(socket, ids.org, projectId)).toEqual({ ok: true, projectId });
    return socket;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(RateLimitClock).useValue({ now: () => now }).compile();
    app = module.createNestApplication({ logger: false, rawBody: true });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    db = app.get(PrismaService); tokens = app.get(TokenService);
  });
  beforeEach(async () => {
    now += 60_001;
    await resetTestDatabase(db);
    await db.user.createMany({ data: (["owner", "admin", "member", "outsider"] as const)
      .map(name => ({ id: ids[name], email: `${name}@realtime.test`, displayName: name, passwordHash: "fixture-only" })) });
    await db.organization.createMany({ data: [
      { id: ids.org, name: "Realtime", slug: "realtime" },
      { id: ids.foreignOrg, name: "Foreign", slug: "foreign" },
    ] });
    await db.membership.createMany({ data: [
      { userId: ids.owner, organizationId: ids.org, role: "OWNER" },
      { userId: ids.admin, organizationId: ids.org, role: "ADMIN" },
      { userId: ids.member, organizationId: ids.org, role: "MEMBER" },
      { userId: ids.outsider, organizationId: ids.foreignOrg, role: "OWNER" },
    ] });
    await db.project.createMany({ data: [
      { id: ids.project, organizationId: ids.org, name: "A", slug: "a" },
      { id: ids.other, organizationId: ids.org, name: "B", slug: "b" },
    ] });
    await app.get(PricingService).loadCatalogue(fixture("model-prices.json"));
    key = (await request(app.getHttpServer()).post(`${projectPath}/api-keys`)
      .set("Authorization", bearer()).send({ name: "Realtime tests" }).expect(201)).body.key;
  });
  afterEach(async () => {
    sockets.splice(0).forEach(socket => socket.disconnect());
    await settleWindow();
    jest.restoreAllMocks();
  });
  afterAll(async () => { await app?.close(); });

  it.each(["owner", "admin", "member"] as const)("allows %s", async role => { await viewer(ids[role]); });

  it("hides outsiders, wrong organizations and archived parents", async () => {
    const outsider = await open(ids.outsider), owner = await open();
    const denied = { ok: false, error: { code: "PROJECT_NOT_FOUND" } };
    expect(await subscribe(outsider, ids.org, ids.project)).toMatchObject(denied);
    expect(await subscribe(owner, ids.foreignOrg, ids.project)).toMatchObject(denied);
    await db.project.update({ where: { id: ids.project }, data: { archivedAt: new Date() } });
    expect(await subscribe(owner, ids.org, ids.project)).toMatchObject(denied);
    await db.organization.update({ where: { id: ids.org }, data: { archivedAt: new Date() } });
    expect(await subscribe(owner, ids.org, ids.other)).toMatchObject(denied);
  });

  it("notifies two viewers for actual POST, PUT and DELETE; isolates another project", async () => {
    const a = await viewer(), b = await viewer(ids.member), other = await viewer(ids.admin, ids.other);
    const unrelated = jest.fn(); other.on("traces.changed", unrelated);
    async function mutation(run: () => PromiseLike<unknown>) {
      const received = [event(a, "traces.changed"), event(b, "traces.changed")];
      const result = await run();
      const [one, two] = await Promise.all(received);
      expect(one).toEqual(two);
      expect(one).toMatchObject({ projectId: ids.project });
      expect(Object.keys(one as object).sort()).toEqual(["eventId", "occurredAt", "projectId"]);
      return result;
    }
    let traceId = "";
    await mutation(async () => { traceId = (await post().expect(201)).body.id; });
    const replacement = { ...body, inputTokens: 2000 };
    await mutation(() => request(app.getHttpServer()).put(`/api/v1/public/traces/${traceId}`)
      .set("X-API-Key", key).set("If-Match", '"1"').send(replacement).expect(200));
    const noEvent = jest.fn(); a.on("traces.changed", noEvent);
    await post(replacement).expect(200); // Replay.
    await request(app.getHttpServer()).put(`/api/v1/public/traces/${traceId}`)
      .set("X-API-Key", key).set("If-Match", '"2"').send(replacement).expect(200); // No-op.
    await settleWindow(); expect(noEvent).not.toHaveBeenCalled();
    await mutation(() => request(app.getHttpServer()).delete(`/api/v1/public/traces/${traceId}`)
      .set("X-API-Key", key).set("If-Match", '"2"').expect(204));
    expect(unrelated).not.toHaveBeenCalled();
  });

  it.each(["membership", "project", "organization"])("revokes after committed %s removal/archive", async kind => {
    const socket = await viewer(ids.member);
    const revoked = event(socket, "access.revoked");
    const changed = jest.fn(); socket.on("traces.changed", changed);
    if (kind === "membership") await request(app.getHttpServer()).delete(`${orgPath}/members/${ids.member}`).set("Authorization", bearer()).expect(204);
    if (kind === "project") await request(app.getHttpServer()).delete(projectPath).set("Authorization", bearer()).expect(204);
    if (kind === "organization") await request(app.getHttpServer()).delete(orgPath).set("Authorization", bearer()).send({ confirmSlug: "realtime" }).expect(204);
    expect(await revoked).toEqual({ projectId: ids.project, code: "PROJECT_NOT_FOUND" });
    expect(socket.connected).toBe(true);
    await app.get(TraceChangesService).publish({ projectId: ids.project });
    await settleWindow(); expect(changed).not.toHaveBeenCalled();
    expect(await subscribe(socket, ids.org, ids.project)).toMatchObject({ error: { code: "PROJECT_NOT_FOUND" } });
  });

  it("demotion to MEMBER retains read access", async () => {
    const socket = await viewer(ids.admin), revoked = jest.fn();
    socket.on("access.revoked", revoked);
    await request(app.getHttpServer()).patch(`${orgPath}/members/${ids.admin}`)
      .set("Authorization", bearer()).send({ role: "MEMBER" }).expect(200);
    const received = event(socket, "traces.changed");
    await post().expect(201); await received;
    expect(revoked).not.toHaveBeenCalled();
  });

  it("a delayed real authorization cannot undo unsubscribe or removal", async () => {
    const access = app.get(ProjectAccessService);
    const original = access.assertProjectAccess.bind(access);
    const socket = await open(ids.member);
    for (const action of ["unsubscribe", "remove"]) {
      let release!: () => void, entered!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const reading = new Promise<void>(resolve => { entered = resolve; });
      const spy = jest.spyOn(access, "assertProjectAccess").mockImplementationOnce(async (...args) => {
        const result = await original(...args); entered(); await gate; return result;
      });
      const pending = subscribe(socket, ids.org, ids.project);
      await reading;
      if (action === "unsubscribe") await socket.timeout(3000).emitWithAck("project.unsubscribe");
      else await request(app.getHttpServer()).delete(`${orgPath}/members/${ids.member}`).set("Authorization", bearer()).expect(204);
      release();
      expect(await pending).toMatchObject({ ok: false });
      spy.mockRestore();
    }
  });

  it("disconnects without sending data when the authorization batch fails", async () => {
    const socket = await viewer();
    const changed = jest.fn(); socket.on("traces.changed", changed);
    const failure = event<{ code: string }>(socket, "realtime.error");
    const disconnected = event(socket, "disconnect");
    jest.spyOn(db.project, "findFirst").mockRejectedValueOnce(new Error("database unavailable"));
    await post().expect(201);
    expect((await failure).code).toBe("INTERNAL_SERVER_ERROR");
    await disconnected; expect(changed).not.toHaveBeenCalled();
  });

  it("rejects an expired JWT and disconnects at verified expiry", async () => {
    const signed = (exp: number) => sign({ sub: ids.owner, exp }, process.env.JWT_SECRET!, {
      algorithm: "HS256", issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE,
    });
    const expired = client(url, signed(Math.floor(Date.now() / 1000) - 10)); sockets.push(expired);
    const rejected = event<{ data: { code: string } }>(expired, "connect_error"); expired.connect();
    expect((await rejected).data.code).toBe("ACCESS_TOKEN_EXPIRED");
    const socket = await open(ids.owner, signed(Math.floor(Date.now() / 1000) + 2));
    const failure = event<{ code: string }>(socket, "realtime.error");
    const disconnected = event(socket, "disconnect");
    expect((await failure).code).toBe("ACCESS_TOKEN_EXPIRED");
    await disconnected;
  }, 8000);

  it("coalesces 100 committed writes and batches authorization for two viewers", async () => {
    const a = await viewer(), b = await viewer(ids.member);
    const first = jest.fn(), second = jest.fn(); a.on("traces.changed", first); b.on("traces.changed", second);
    const principal = await app.get(ApiKeyAuthService).authenticate(key);
    const reads = jest.spyOn(db.project, "findFirst");
    const traces = app.get(TracesService);
    // Exercise real ingestion transactions without exceeding the separate
    // HTTP quota (60/IP/minute). HTTP wiring is tested above and in TSE-69.
    for (let index = 0; index < 100; index++) {
      await traces.ingest(principal, normalizeTracePayload({ ...body, externalId: `burst-${index}` }));
    }
    await settleWindow();
    expect(await db.trace.count({ where: { projectId: ids.project } })).toBe(100);
    expect(first.mock.calls.length).toBeGreaterThan(0);
    expect(first.mock.calls.length).toBeLessThan(100);
    expect(first.mock.calls).toEqual(second.mock.calls);
    expect(reads).toHaveBeenCalledTimes(first.mock.calls.length);
  }, 30_000);

  it("reconnection requires a new subscription; missed events are not replayed", async () => {
    const socket = await viewer();
    socket.disconnect(); await settleWindow();
    await post().expect(201);
    const received = jest.fn(); socket.on("traces.changed", received);
    await connected(socket); await settleWindow(); expect(received).not.toHaveBeenCalled();
    await post({ ...body, externalId: "before-subscribe" }).expect(201);
    await settleWindow(); expect(received).not.toHaveBeenCalled();
    expect(await subscribe(socket, ids.org, ids.project)).toMatchObject({ ok: true });
    const changed = event(socket, "traces.changed");
    await post({ ...body, externalId: "after-subscribe" }).expect(201); await changed;
  });
});
