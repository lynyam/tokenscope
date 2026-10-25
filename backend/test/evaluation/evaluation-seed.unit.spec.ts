import "reflect-metadata";
import { randomBytes } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { main } from "../../src/scripts/seed-evaluation";
import { DEFAULT_ANCHOR, readSeedConfig, safeSeedFailure, SeedError } from "../../src/evaluation/seed-config";
import { fixtureDirectory, loadSeedFixtures, shiftInstant, stableJson } from "../../src/evaluation/seed-fixtures";
import { seedSummary } from "../../src/evaluation/seed-evaluation";
import { hashPassword, verifyPassword } from "../../src/auth/password";

const password = randomBytes(24).toString("base64url");
const now = new Date("2026-10-24T18:00:00.000Z");
const env = {
  APP_MODE: "eval", NODE_ENV: "production", EVALUATION_SEED_ENABLED: "true",
  DEMO_PASSWORD: password, DATABASE_URL: "postgresql://local:private@postgres:5432/tokenscope",
};
const args = ["--confirm-database", "tokenscope"];

describe("evaluation seed configuration", () => {
  it("supports eval without weakening NODE_ENV and supports dev/test", () => {
    expect(readSeedConfig(env, args)).toMatchObject({ database: "tokenscope", anchor: DEFAULT_ANCHOR, password });
    expect(readSeedConfig({ ...env, APP_MODE: "dev", NODE_ENV: "development" }, args).database).toBe("tokenscope");
    expect(readSeedConfig({ ...env, APP_MODE: "test", NODE_ENV: "test",
      DATABASE_URL: "postgresql://local:private@postgres-test:5432/tokenscope_test" },
    ["--confirm-database", "tokenscope_test"]).database).toBe("tokenscope_test");
  });
  it.each([
    { APP_MODE: undefined }, { APP_MODE: "production" }, { APP_MODE: "staging" },
    { APP_MODE: "dev", NODE_ENV: "production" }, { APP_MODE: "test" },
    { EVALUATION_SEED_ENABLED: "false" }, { EVALUATION_SEED_ENABLED: undefined },
    { DEMO_PASSWORD: "" }, { DEMO_PASSWORD: "short" }, { DEMO_PASSWORD: "a".repeat(129) },
    { DATABASE_URL: "postgresql://local:private@remote.example:5432/tokenscope" },
    { DATABASE_URL: "postgresql://local:private@postgres:5432/other" },
    { DATABASE_URL: "postgresql://local:private@postgres:5432/tokenscope?host=remote.example" },
    { DATABASE_URL: "not-a-url" },
  ])("rejects unsafe/missing configuration %#", override => {
    expect(() => readSeedConfig({ ...env, ...override }, args)).toThrow(SeedError);
  });
  it.each([[], ["--confirm-database"], [...args, ...args], [...args, "--unknown", "value"],
    [...args, "--anchor", "2026-02-30"], [...args, "--anchor", "2026-2-1"]].map(input => ({ input })))("rejects invalid arguments %#", ({ input }) => {
    expect(() => readSeedConfig(env, input)).toThrow(SeedError);
  });
  it("never includes unknown error contents in CLI diagnostics", () => {
    expect(safeSeedFailure(new Error(`${password} ${env.DATABASE_URL}`))).not.toContain(password);
    expect(safeSeedFailure(new Error(env.DATABASE_URL))).not.toContain(env.DATABASE_URL);
  });
  it("uses the authentication password policy, preserving whitespace", async () => {
    const hash = await hashPassword(` ${password} `);
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash.split("$")[3].split(",").sort()).toEqual(["m=65536", "p=4", "t=3"]);
    expect(await verifyPassword(hash, ` ${password} `)).toBe(true);
    expect(await verifyPassword(hash, password)).toBe(false);
  });
});

describe("canonical evaluation fixtures", () => {
  const source = fixtureDirectory();
  it("shifts prices, archives, requests and windows together without changing files", () => {
    const before = readFileSync(join(source, "traces-golden.json"), "utf8");
    const base = loadSeedFixtures(DEFAULT_ANCHOR, source, now);
    const shifted = loadSeedFixtures("2026-10-02", source, now);
    expect(shifted.range).toEqual({ from: "2026-10-02T00:00:00.000Z", to: "2026-10-03T00:00:00.000Z" });
    expect(shifted.prices[1].effectiveFrom).toBe("2026-10-02T12:00:00.000Z");
    expect(shifted.traces[4].body.occurredAt).toBe("2026-10-02T14:00:00.000Z");
    expect(shifted.requests.live.occurredAt).toBe("2026-10-02T16:00:00.000Z");
    expect(shifted.projects[4].archivedAt).toBe("2026-10-02T00:00:00.000Z");
    expect(shifted.expected).toEqual(base.expected);
    expect(shifted.fingerprint).not.toBe(base.fingerprint);
    expect(readFileSync(join(source, "traces-golden.json"), "utf8")).toBe(before);
  });
  it("does not fake the clock to accept future trace data", () => {
    expect(() => loadSeedFixtures("2026-10-25", source, now)).toThrow();
    expect(() => shiftInstant("2026-02-30T00:00:00.000Z", DEFAULT_ANCHOR)).toThrow();
  });
  it.each(["duplicate-id", "duplicate-email", "foreign-project", "invalid-metadata", "missing-file"])(
    "rejects the complete fixture set before persistence: %s", scenario => {
      const directory = mkdtempSync(join(tmpdir(), "tokenscope-seed-unit-"));
      try {
        cpSync(source, directory, { recursive: true });
        const name = scenario === "foreign-project" || scenario === "invalid-metadata" ? "traces-golden.json" : "identities.json";
        const file = join(directory, name);
        const data = JSON.parse(readFileSync(file, "utf8"));
        if (scenario === "duplicate-id") data.users[1].id = data.users[0].id;
        if (scenario === "duplicate-email") data.users[1].email = data.users[0].email;
        if (scenario === "foreign-project") data[0].projectId = "30000000-0000-4000-8000-000000000099";
        if (scenario === "invalid-metadata") data[0].body.metadata.password = password;
        writeFileSync(file, JSON.stringify(data));
        if (scenario === "missing-file") rmSync(join(directory, "model-prices.json"));
        expect(() => loadSeedFixtures(DEFAULT_ANCHOR, directory, now)).toThrow();
      } finally { rmSync(directory, { recursive: true, force: true }); }
    });
  it("prints only the allowlisted summary fields", () => {
    const f = loadSeedFixtures(DEFAULT_ANCHOR, source, now);
    const output = stableJson(seedSummary(readSeedConfig(env, args), f, "inserted"));
    expect(output).toContain("owner@demo.tokenscope.test");
    for (const secret of [password, env.DATABASE_URL, "passwordHash", "$argon2"]) expect(output).not.toContain(secret);
  });
  it("the CLI entry point refuses an unsafe invocation without exposing secrets", async () => {
    const originalEnv = process.env;
    const originalArgs = process.argv;
    const originalExit = process.exitCode;
    const out = jest.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = jest.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      process.env = { ...process.env, ...env, APP_MODE: "production" };
      process.argv = [process.execPath, "seed-evaluation", ...args];
      await main();
      expect(process.exitCode).toBe(1);
      expect(err.mock.calls.flat().join("")).toContain("SEED_VALIDATION");
      expect(err.mock.calls.flat().join("")).not.toContain(password);
      expect(out).not.toHaveBeenCalled();
    } finally {
      process.env = originalEnv; process.argv = originalArgs; process.exitCode = originalExit;
      out.mockRestore(); err.mockRestore();
    }
  });
  it("selects the packaged eval entry point or existing development runner", () => {
    const { entryArguments } = require("../../scripts/run-evaluation-seed.cjs");
    expect(entryArguments("eval")).toEqual([resolve(__dirname, "../../dist/scripts/seed-evaluation.js")]);
    expect(entryArguments("dev").at(-1)).toBe(resolve(__dirname, "../../scripts/seed-evaluation.ts"));
    expect(entryArguments("test")).toEqual(entryArguments("dev"));
    for (const mode of [undefined, "production", "staging"]) expect(() => entryArguments(mode)).toThrow();
  });
});
