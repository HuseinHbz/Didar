-- Rollback for 20260819120000_order_lifecycle_hardening.
-- Reverses both sections in exact reverse order; every operation here
-- is a pure drop of something this migration's own `migration.sql`
-- added — no data loss beyond that (no existing row's business data is
-- touched by either direction of this migration).

BEGIN;

DROP INDEX IF EXISTS "commerce"."shipments_tracking_number_key";
DROP INDEX IF EXISTS "commerce"."orders_placed_at_idx";
DROP INDEX IF EXISTS "commerce"."orders_fulfillment_status_idx";
DROP INDEX IF EXISTS "commerce"."orders_payment_status_idx";

DROP INDEX IF EXISTS "commerce"."fulfillments_idempotency_key_key";
ALTER TABLE "commerce"."fulfillments" DROP COLUMN IF EXISTS "idempotency_key";

COMMIT;
