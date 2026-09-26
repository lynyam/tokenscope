import "reflect-metadata";
import { Body, Controller, Get, Post } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Type } from "class-transformer";
import { IsDefined, IsString, Length, ValidateNested } from "class-validator";
import request = require("supertest");

import { configureApp } from "../../src/configure-app";
import { UuidParam } from "../../src/common/decorators/uuid-param.decorators";

class ProbeDto {
  @IsString()
  @Length(1, 100)
  name!: string;
}

class NestedProbeDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => ProbeDto)
  child!: ProbeDto;
}

let handlerCalls = 0;

@Controller("validation-probe")
class ValidationProbeController {
  @Post()
  create(@Body() input: ProbeDto) {
    handlerCalls++;
    return { name: input.name, isDto: input instanceof ProbeDto };
  }

  @Post("nested")
  nested(@Body() input: NestedProbeDto) {
    handlerCalls++;
    return { name: input.child.name };
  }

  @Get(":resourceId")
  find(@UuidParam("resourceId") resourceId: string) {
    handlerCalls++;
    return { id: resourceId };
  }
}

describe("Shared request validation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ValidationProbeController],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    handlerCalls = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("transforms a valid body into its DTO class", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/validation-probe")
      .send({ name: "TokenScope" })
      .expect(201)
      .expect({ name: "TokenScope", isDto: true });

    expect(handlerCalls).toBe(1);
  });

  it.each([
    {
      label: "unknown field",
      input: { name: "Valid", role: "OWNER" },
      field: "role",
    },
    {
      label: "missing name",
      input: {},
      field: "name",
    },
    {
      label: "empty name",
      input: { name: "" },
      field: "name",
    },
    {
      label: "numeric name",
      input: { name: 123 },
      field: "name",
    },
    {
      label: "overlong name",
      input: { name: "x".repeat(101) },
      field: "name",
    },
  ])("rejects $label before the handler runs", async ({ input, field }) => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/validation-probe")
      .set("X-Request-Id", "validation-check")
      .send(input)
      .expect(400);

    expect(response.body).toMatchObject({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      error: "Bad Request",
      message: "Request validation failed.",
      requestId: "validation-check",
    });
    expect(response.headers["x-request-id"]).toBe("validation-check");
    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field, messages: expect.any(Array) }),
      ]),
    );
    expect(handlerCalls).toBe(0);
  });

  it("includes the full field path for nested validation errors", async () => {
    const response = await request(app.getHttpServer())
      .post("/api/v1/validation-probe/nested")
      .send({ child: { name: "" } })
      .expect(400);

    expect(response.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "child.name" }),
      ]),
    );
    expect(handlerCalls).toBe(0);
  });

  it("omits submitted values and validation objects from error details", async () => {
    const sensitiveValue = "DO_NOT_EXPOSE_TEST_VALUE";

    const response = await request(app.getHttpServer())
      .post("/api/v1/validation-probe")
      .send({ name: 123, password: sensitiveValue })
      .expect(400);

    expect(response.text).not.toContain(sensitiveValue);
    for (const detail of response.body.details) {
      expect(Object.keys(detail).sort()).toEqual(["field", "messages"]);
    }
    expect(handlerCalls).toBe(0);
  });

  it.each([
    "8e32b232-eeda-4c5e-bbf0-427e799ff076",
    "0198ff30-83be-7b70-bd15-636330d376a1",
  ])("accepts a well-formed UUID: %s", async (id) => {
    await request(app.getHttpServer())
      .get("/api/v1/validation-probe/" + id)
      .expect(200)
      .expect({ id });

    expect(handlerCalls).toBe(1);
  });

  it.each([
    "not-a-uuid",
    "8e32b232eeda4c5ebbf0427e799ff076",
    "8e32b232-eeda-4c5e-bbf0-427e799ff076%0A",
  ])("rejects an invalid UUID: %s", async (id) => {
    const response = await request(app.getHttpServer())
      .get("/api/v1/validation-probe/" + id)
      .set("X-Request-Id", "uuid-check")
      .expect(400);

    expect(response.body).toEqual({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      error: "Bad Request",
      message: "Request validation failed.",
      requestId: "uuid-check",
      details: [
        { field: "resourceId", messages: ["resourceId must be a UUID"] },
      ],
    });
    expect(response.headers["x-request-id"]).toBe("uuid-check");
    expect(handlerCalls).toBe(0);
  });
});
