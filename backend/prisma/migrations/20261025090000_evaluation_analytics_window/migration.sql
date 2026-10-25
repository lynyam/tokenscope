-- Nullable for existing 1.2 receipts. No application data is rewritten.
ALTER TABLE "EvaluationSeedReceipt"
ADD COLUMN "analyticsWindowEnd" TIMESTAMPTZ(3);
