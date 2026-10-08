import "./require-test-database";

import type {
  Prisma,
} from "../../src/generated/prisma/client";

// Test-only. The imported guard restricts use to the isolated test database.
// Production foreign keys remain restrictive.
export async function resetTestDatabase(
  db: Prisma.TransactionClient,
): Promise<void> {
  await db.trace.deleteMany();
  await db.apiKey.deleteMany();
  await db.projectDocument.deleteMany();
  await db.fileDeletionJob.deleteMany();
  await db.modelPrice.deleteMany();

  await db.project.deleteMany();
  await db.membership.deleteMany();
  await db.organization.deleteMany();
  await db.user.deleteMany();
}
