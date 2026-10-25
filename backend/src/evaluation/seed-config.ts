export const DATASET_ID = "tokenscope-evaluation";
export const DEFAULT_ANCHOR = "2026-10-01";
export const DAY_MS = 86_400_000;

export class SeedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SeedError";
  }
}

export function requireSeed(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SeedError("SEED_VALIDATION", message);
}

export function parseAnchor(value: string): number {
  requireSeed(/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value),
    "Anchor must be a real YYYY-MM-DD UTC date.");
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  requireSeed(Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value,
  "Anchor must be a real YYYY-MM-DD UTC date.");
  return timestamp;
}

export interface SeedConfig {
  databaseUrl: string;
  database: string;
  password: string;
  anchor: string;
}

export function readSeedConfig(
  env: NodeJS.ProcessEnv,
  args: readonly string[],
): SeedConfig {
  const mode = env.APP_MODE;
  requireSeed(mode === "dev" || mode === "eval" || mode === "test",
    "Seeding is restricted to explicit local dev/eval or guarded test mode.");
  requireSeed(mode !== "dev" || env.NODE_ENV !== "production",
    "Production runtime is allowed only in explicit local eval mode.");
  requireSeed(mode !== "test" || env.NODE_ENV === "test",
    "Test mode requires NODE_ENV=test.");
  requireSeed(env.EVALUATION_SEED_ENABLED === "true",
    "Explicit EVALUATION_SEED_ENABLED=true is required.");
  const password = env.DEMO_PASSWORD;
  requireSeed(typeof password === "string" &&
    [...password].length >= 8 && [...password].length <= 128 &&
    !password.includes("\0"), "DEMO_PASSWORD must contain 8–128 characters.");

  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    requireSeed((name === "--confirm-database" || name === "--anchor") &&
      typeof value === "string" && value.length > 0 && !options.has(name),
    "Use --confirm-database NAME and optional --anchor YYYY-MM-DD, once each.");
    options.set(name, value);
  }
  const database = options.get("--confirm-database");
  requireSeed(database && /^[A-Za-z0-9_-]{1,63}$/.test(database),
    "--confirm-database must explicitly name the local database.");
  const anchor = options.get("--anchor") ?? DEFAULT_ANCHOR;
  parseAnchor(anchor);

  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ""); }
  catch { throw new SeedError("SEED_TARGET", "DATABASE_URL is invalid."); }
  // Deliberately narrow: these are the repository's private Compose services.
  // APP_MODE alone is not proof that a database is disposable.
  const host = mode === "test" ? "postgres-test" : "postgres";
  requireSeed(["postgres:", "postgresql:"].includes(url.protocol) &&
    url.hostname === host && (!url.port || url.port === "5432") &&
    !url.search && !url.hash && url.pathname === `/${database}` &&
    (mode !== "test" || database === "tokenscope_test"),
  "Target must be the confirmed database on the local Compose PostgreSQL service; remote targets are refused.");
  return { databaseUrl: env.DATABASE_URL!, database, password, anchor };
}

export function safeSeedFailure(error: unknown): string {
  // Never stringify a driver error: it can contain connection details or rows.
  return error instanceof SeedError
    ? `${error.code}: ${error.message}`
    : "SEED_FAILED: Check migrations and local database readiness. Rerun with the same inputs to verify the outcome.";
}
