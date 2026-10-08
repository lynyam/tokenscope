import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request = require("supertest");

import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { ApiException } from "../../src/common/errors/api.exception";
import { configureApp } from "../../src/configure-app";
import { PrismaService } from "../../src/database/prisma.service";
import { ProjectsService } from "../../src/projects/projects.service";

const actorId = randomUUID();
const organizationId = randomUUID();
const projectId = randomUUID();
const base = `/api/v1/organizations/${organizationId}/projects`;
const detail = `${base}/${projectId}`;
const requestId = "tse41-http";

const project = {
  id: projectId,
  organizationId,
  name: "Support AI",
  slug: "support-ai",
  description: null,
  archivedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const routes = {
  list: { method: "get", path: base, body: undefined },
  create: {
    method: "post",
    path: base,
    body: { name: "Support AI" },
  },
  detail: { method: "get", path: detail, body: undefined },
  update: {
    method: "patch",
    path: detail,
    body: { name: "Renamed" },
  },
  archive: { method: "delete", path: detail, body: undefined },
} as const;

type Operation = keyof typeof routes;

describe("Project HTTP contract", () => {
  let app: INestApplication;
  let bearer: string;

  const projects = {
    findAllForOrganization: jest.fn(),
    create: jest.fn(),
    findOneForOrganization: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
  };

  beforeAll(async () => {
    const context = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(ProjectsService)
      .useValue(projects)
      .compile();

    app = context.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();

    // This is a genuine token issued by the application's TokenService.
    bearer =
      "Bearer " +
      app.get(TokenService).signAccessToken(actorId).accessToken;
  });

  beforeEach(() => {
    Object.values(projects).forEach(mock => mock.mockReset());
    projects.findAllForOrganization.mockResolvedValue([project]);
    projects.create.mockResolvedValue(project);
    projects.findOneForOrganization.mockResolvedValue(project);
    projects.update.mockResolvedValue({
      ...project,
      name: "Renamed",
    });
    projects.archive.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app?.close();
  });

  function send(
    operation: Operation,
    options: {
      path?: string;
      body?: Record<string, unknown>;
      authorization?: string | null;
    } = {},
  ) {
    const route = routes[operation];
    const call = request(app.getHttpServer())[route.method](
      options.path ?? route.path,
    ).set("X-Request-Id", requestId);

    const authorization =
      options.authorization === undefined
        ? bearer
        : options.authorization;

    if (authorization !== null) {
      call.set("Authorization", authorization);
    }

    const body = options.body ?? route.body;
    if (body !== undefined) {
      call.send(body);
    }

    return call;
  }

  function expectNoProjectCall() {
    Object.values(projects).forEach(mock =>
      expect(mock).not.toHaveBeenCalled(),
    );
  }

  it("lists through the verified actor and returns the resource array", async () => {
    await send("list")
      .expect(200)
      .expect("X-Request-Id", requestId)
      .expect([project]);

    expect(projects.findAllForOrganization).toHaveBeenCalledWith(
      actorId,
      organizationId,
    );
  });

  it("creates with normalized DTO values and returns 201", async () => {
    await send("create", {
      body: {
        name: "  Support AI  ",
        description: "  Observability  ",
      },
    }).expect(201).expect(project);

    expect(projects.create).toHaveBeenCalledWith(
      actorId,
      organizationId,
      expect.objectContaining({
        name: "Support AI",
        description: "Observability",
      }),
    );
  });

  it("reads detail with the verified actor and both route IDs", async () => {
    await send("detail").expect(200).expect(project);

    expect(projects.findOneForOrganization).toHaveBeenCalledWith(
      actorId,
      organizationId,
      projectId,
    );
  });

  it("passes null through PATCH so the service can clear description", async () => {
    projects.update.mockResolvedValueOnce({
      ...project,
      description: null,
    });

    await send("update", {
      body: { description: null },
    }).expect(200);

    expect(projects.update).toHaveBeenCalledWith(
      actorId,
      organizationId,
      projectId,
      expect.objectContaining({ description: null }),
    );
  });

  it("returns 204 with no response body when archiving", async () => {
    const response = await send("archive")
      .expect(204)
      .expect("X-Request-Id", requestId);

    expect(response.text).toBe("");
    expect(projects.archive).toHaveBeenCalledWith(
      actorId,
      organizationId,
      projectId,
    );
  });

  it.each(Object.keys(routes) as Operation[])(
    "requires authentication for %s",
    async operation => {
      const response = await send(operation, {
        authorization: null,
      }).expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        code: "AUTHENTICATION_REQUIRED",
        requestId,
      });
      expect(response.headers["x-request-id"]).toBe(requestId);
      expectNoProjectCall();
    },
  );

  it("rejects an invalid JWT before calling the service", async () => {
    const response = await send("list", {
      authorization: "Bearer not-a-token",
    }).expect(401);

    expect(response.body.code).toBe("INVALID_ACCESS_TOKEN");
    expectNoProjectCall();
  });

  it.each([
    ["list", `/api/v1/organizations/invalid/projects`, "organizationId"],
    ["create", `/api/v1/organizations/invalid/projects`, "organizationId"],
    ["detail", `/api/v1/organizations/invalid/projects/${projectId}`, "organizationId"],
    ["update", `/api/v1/organizations/invalid/projects/${projectId}`, "organizationId"],
    ["archive", `/api/v1/organizations/invalid/projects/${projectId}`, "organizationId"],
    ["detail", `${base}/invalid`, "projectId"],
    ["update", `${base}/invalid`, "projectId"],
    ["archive", `${base}/invalid`, "projectId"],
  ] as const)(
    "validates route IDs for %s at %s",
    async (operation, path, field) => {
      const response = await send(operation, { path }).expect(400);

      expect(response.body.code).toBe("VALIDATION_ERROR");
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field }),
        ]),
      );
      expectNoProjectCall();
    },
  );

  it.each([
    {},
    { name: "" },
    { name: "   " },
    { name: "x".repeat(101) },
    { name: 42 },
    { name: "Valid", description: "x".repeat(2001) },
    { name: "Valid", description: null },
    { name: "Valid", slug: "injected" },
    { name: "Valid", organizationId: randomUUID() },
    { name: "Valid", archivedAt: "2020-01-01" },
  ])("rejects invalid create body %j", async body => {
    const response = await send("create", { body }).expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(projects.create).not.toHaveBeenCalled();
  });

  it.each([
    { name: "" },
    { name: "   " },
    { name: null },
    { name: "x".repeat(101) },
    { description: "x".repeat(2001) },
    { description: 42 },
    { name: "Valid", slug: "injected" },
    { name: "Valid", userId: randomUUID() },
  ])("rejects invalid update body %j", async body => {
    const response = await send("update", { body }).expect(400);

    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(projects.update).not.toHaveBeenCalled();
  });

  it("passes a trimmed 100-character name after validation", async () => {
    const name = "x".repeat(100);

    await send("create", {
      body: { name: ` ${name} ` },
    }).expect(201);

    expect(projects.create).toHaveBeenCalledWith(
      actorId,
      organizationId,
      expect.objectContaining({ name }),
    );
  });

  it("maps an expected service error with the request ID", async () => {
    projects.update.mockRejectedValueOnce(
      new ApiException(
        403,
        "INSUFFICIENT_ORGANIZATION_ROLE",
        "You are not allowed to perform this action.",
      ),
    );

    const response = await send("update").expect(403);

    expect(response.body).toEqual({
      statusCode: 403,
      code: "INSUFFICIENT_ORGANIZATION_ROLE",
      error: "Forbidden",
      message: "You are not allowed to perform this action.",
      requestId,
    });
    expect(response.headers["x-request-id"]).toBe(requestId);
  });
});
