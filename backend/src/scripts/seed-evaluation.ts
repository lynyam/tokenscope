import "reflect-metadata";
import "dotenv/config";
import { ConfigService } from "@nestjs/config";
import type { EnvironmentVariables } from "../config/env.validation";
import { PrismaService } from "../database/prisma.service";
import { DEFAULT_ANCHOR, readSeedConfig, requireSeed, safeSeedFailure, SeedError } from "../evaluation/seed-config";
import { loadSeedFixtures } from "../evaluation/seed-fixtures";
import { seedEvaluation } from "../evaluation/seed-evaluation";

export async function main(): Promise<void> {
  let db: PrismaService | undefined;
  try {
    if (process.argv[2] === "--print-request") {
      const [scenario, anchor = DEFAULT_ANCHOR, ...extra] = process.argv.slice(3);
      requireSeed((scenario === "live" || scenario === "correction") && extra.length === 0,
        "Use npm run eval:request -- live|correction [YYYY-MM-DD].");
      process.stdout.write(`${JSON.stringify(loadSeedFixtures(anchor).requests[scenario], null, 2)}\n`);
      return;
    }
    const config = readSeedConfig(process.env, process.argv.slice(2));
    let fixtures: ReturnType<typeof loadSeedFixtures>;
    try { fixtures = loadSeedFixtures(config.anchor); }
    catch (error) {
      if (error instanceof SeedError) throw error;
      throw new SeedError("SEED_FIXTURES", "Invalid fixtures or future trace dates. Use a completed UTC day and check the canonical files.");
    }
    // No HTTP application, cleanup workers, WebSockets or LLM adapter are started.
    db = new PrismaService(new ConfigService<EnvironmentVariables>({ DATABASE_URL: config.databaseUrl }));
    await db.$connect();
    const result = await seedEvaluation(db, config, fixtures);
    await db.$disconnect();
    db = undefined;
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${safeSeedFailure(error)}\n`);
    process.exitCode = 1;
  } finally {
    if (db) await db.$disconnect().catch(() => undefined);
  }
}

if (require.main === module) void main();
