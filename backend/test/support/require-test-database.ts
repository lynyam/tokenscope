const diagnostic =
  "Database integration tests require the isolated tokenscope_test database " +
  "on postgres-test. Run make test-db or make test-backend from the repository root.";

let databaseUrl: URL;
try {
  databaseUrl = new URL(process.env.DATABASE_URL ?? "");
} catch {
  throw new Error(diagnostic);
}

if (
  process.env.NODE_ENV !== "test" ||
  !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
  databaseUrl.hostname !== "postgres-test" ||
  !["", "5432"].includes(databaseUrl.port) ||
  databaseUrl.pathname !== "/tokenscope_test"
) {
  throw new Error(diagnostic);
}

export {};
