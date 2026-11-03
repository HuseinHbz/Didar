-- Rollback for 20261024000000_payment_order_consistency.
-- Reverses the 3 sections of migration.sql in exact reverse order. Every
-- operation is a pure drop of something this migration added, so no
-- pre-existing business data is touched. Rolling back DOES discard any
-- order_exceptions rows and refunds.failure_reason values written since
-- the migration was applied — that is the intended, documented cost of a
-- rollback of a table/column that only exists to hold them.

BEGIN;

-- 3. commerce.payment_intents (status, updated_at)
DROP INDEX IF EXISTS "commerce"."payment_intents_status_updated_at_idx";

-- 2. commerce.refunds.failure_reason
ALTER TABLE "commerce"."refunds" DROP COLUMN IF EXISTS "failure_reason";

-- 1. commerce.order_exceptions (the table drop cascades its own FK/indexes)
DROP TABLE IF EXISTS "commerce"."order_exceptions";
DROP TYPE IF EXISTS "commerce"."OrderExceptionResolution";
DROP TYPE IF EXISTS "commerce"."OrderExceptionStatus";
DROP TYPE IF EXISTS "commerce"."OrderExceptionType";

COMMIT;
