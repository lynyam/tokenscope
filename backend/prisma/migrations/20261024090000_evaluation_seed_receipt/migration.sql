CREATE TABLE "EvaluationSeedReceipt" (
    "id" TEXT NOT NULL,
    "fixtureVersion" TEXT NOT NULL,
    "anchor" VARCHAR(10) NOT NULL,
    "fixtureFingerprint" VARCHAR(64) NOT NULL,
    "stateFingerprint" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationSeedReceipt_pkey" PRIMARY KEY ("id")
);
