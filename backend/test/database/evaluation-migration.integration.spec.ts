import "reflect-metadata";

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";

import { join, resolve } from "node:path";
import { Client } from "pg";
import * as argon2 from "argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";

import request = require("supertest");

import {
  PrismaClient,
} from "../../src/generated/prisma/client";

import { AppModule } from "../../src/app.module";
import { PrismaService } from "../../src/database/prisma.service";
import { configureApp } from "../../src/configure-app";

import "../support/require-test-database";

const backend = resolve(__dirname, "../..");
const migrations = join(backend, "prisma/migrations");
const baseline = "20260815192357_init_identity_workspace";

describe("Committed evaluation migrations", () => {
  it.each([false, true])(
    "applies migrations with existing data=%s",
    async upgrade => {
      const schema =
        "tse64_" + randomUUID().replaceAll("-", "");

      const temp = mkdtempSync(
        join(backend, ".tse64-migration-"),
      );

      const migrationCopy = join(temp, "migrations");
      const configPath = join(temp, "prisma.config.ts");

      const scopedUrl = new URL(process.env.DATABASE_URL!);
      scopedUrl.searchParams.set("schema", schema);

      const sql = new Client({
        connectionString: process.env.DATABASE_URL!,
      });

      let client: PrismaClient | undefined;
      let app: INestApplication | undefined;
      let schemaCreated = false;

      const deploy = () =>
        execFileSync(
          process.execPath,
          [
            join(backend, "node_modules/prisma/build/index.js"),
            "migrate",
            "deploy",
            "--config",
            configPath,
          ],
          {
            cwd: backend,
            env: {
              ...process.env,
              DATABASE_URL: scopedUrl.toString(),
            },
            stdio: "pipe",
            timeout: 30000,
          },
        );

      const snapshot = async () => {
        const result = await sql.query(`
          SELECT jsonb_build_object(
            'users',
              (
                SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
                FROM "User" t
              ),
            'organizations',
              (
                SELECT jsonb_agg(
                  to_jsonb(t) - 'archivedAt' ORDER BY id
                )
                FROM "Organization" t
              ),
            'memberships',
              (
                SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
                FROM "Membership" t
              ),
            'projects',
              (
                SELECT jsonb_agg(to_jsonb(t) ORDER BY id)
                FROM "Project" t
              )
          ) AS data
        `);

        return result.rows[0].data;
      };

      try {
        await sql.connect();

        await sql.query(`CREATE SCHEMA "${schema}"`);
        schemaCreated = true;

        await sql.query(
          "SELECT set_config('search_path', $1, false)",
          [schema],
        );

        mkdirSync(migrationCopy);

        cpSync(
          join(migrations, "migration_lock.toml"),
          join(migrationCopy, "migration_lock.toml"),
        );

        cpSync(
          join(migrations, baseline),
          join(migrationCopy, baseline),
          { recursive: true },
        );

        writeFileSync(
          configPath,
          `
            import { defineConfig } from "prisma/config";

            export default defineConfig({
              schema: ${JSON.stringify(
                join(backend, "prisma/schema.prisma"),
              )},
              migrations: {
                path: ${JSON.stringify(migrationCopy)},
              },
              datasource: {
                url: process.env.DATABASE_URL!,
              },
            });
          `,
        );

        const actor = randomUUID();
        const organization = randomUUID();
        const activeProject = randomUUID();
        const archivedProject = randomUUID();

        const password = "migration-test-password";
        const email = `migration-${schema}@tests.invalid`;

        let before: unknown;

        if (upgrade) {
          // Apply only the pre-TSE-64 migration.
          deploy();

          const hash = await argon2.hash(password, {
            type: argon2.argon2id,
          });

          const stamp = new Date("2026-09-01T00:00:00.000Z");

          await sql.query(
            `
              INSERT INTO "User"
                (
                  id, email, "passwordHash", "displayName",
                  "createdAt", "updatedAt"
                )
              VALUES ($1, $2, $3, 'Migration', $4, $4)
            `,
            [actor, email, hash, stamp],
          );

          await sql.query(
            `
              INSERT INTO "Organization"
                (id, name, slug, "createdAt", "updatedAt")
              VALUES ($1, 'Migration', 'migration', $2, $2)
            `,
            [organization, stamp],
          );

          await sql.query(
            `
              INSERT INTO "Membership"
                (
                  id, "userId", "organizationId", role,
                  "createdAt", "updatedAt"
                )
              VALUES ($1, $2, $3, 'OWNER', $4, $4)
            `,
            [randomUUID(), actor, organization, stamp],
          );

          for (const [id, slug, archivedAt] of [
            [activeProject, "active", null],
            [archivedProject, "archived", stamp],
          ]) {
            await sql.query(
              `
                INSERT INTO "Project"
                  (
                    id, "organizationId", name, slug,
                    "archivedAt", "createdAt", "updatedAt"
                  )
                VALUES ($1, $2, $3, $3, $4, $5, $5)
              `,
              [id, organization, slug, archivedAt, stamp],
            );
          }

          before = await snapshot();
        }

        // Apply every committed migration through the real Prisma CLI.
        for (const entry of readdirSync(migrations, {
          withFileTypes: true,
        })) {
          if (entry.isDirectory() && entry.name !== baseline) {
            cpSync(
              join(migrations, entry.name),
              join(migrationCopy, entry.name),
              { recursive: true },
            );
          }
        }

        deploy();

        if (upgrade) {
          expect(await snapshot()).toEqual(before);
        }

        client = new PrismaClient({
          adapter: new PrismaPg(
            {
              connectionString: process.env.DATABASE_URL!,
            },
            {
              schema,
            },
          ),
        });

        await client.$connect();

        if (upgrade) {
          expect(
            await client.organization.findUniqueOrThrow({
              where: { id: organization },
            }),
          ).toMatchObject({
            archivedAt: null,
          });
        }

        // Real persistence and authentication.
        // Only the connection's schema is replaced.
        const context = await Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(PrismaService)
          .useValue(client)
          .compile();

        app = context.createNestApplication({
          logger: false,
        });

        configureApp(app);
        await app.init();

        const auth = await request(app.getHttpServer())
          .post(
            `/api/v1/auth/${upgrade ? "signin" : "signup"}`,
          )
          .send(
            upgrade
              ? { email, password }
              : {
                  email,
                  password,
                  displayName: "Migration",
                },
          )
          .expect(upgrade ? 200 : 201);

        const bearer = "Bearer " + auth.body.accessToken;

        await request(app.getHttpServer())
          .get("/api/v1/auth/me")
          .set("Authorization", bearer)
          .expect(200);

        if (upgrade) {
          const projects = await request(app.getHttpServer())
            .get(
              `/api/v1/organizations/${organization}/projects`,
            )
            .set("Authorization", bearer)
            .expect(200);

          expect(
            projects.body.map(
              (project: { id: string }) => project.id,
            ),
          ).toEqual([activeProject]);
        }

        const created = await request(app.getHttpServer())
          .post("/api/v1/organizations")
          .set("Authorization", bearer)
          .send({ name: "After migration" })
          .expect(201);

        await request(app.getHttpServer())
          .post(
            `/api/v1/organizations/${created.body.id}/projects`,
          )
          .set("Authorization", bearer)
          .send({ name: "After migration" })
          .expect(201);
      } finally {
        await app?.close();
        await client?.$disconnect();

        // Drop only the random schema created by this test.
        if (schemaCreated) {
          await sql.query(`DROP SCHEMA "${schema}" CASCADE`);
        }

        await sql.end();

        rmSync(temp, {
          recursive: true,
          force: true,
        });
      }
    },
    60000,
  );
});
