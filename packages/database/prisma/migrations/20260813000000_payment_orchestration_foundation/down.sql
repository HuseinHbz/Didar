-- Rollback for 20260813000000_payment_orchestration_foundation.
-- Reverses in strict reverse order of the forward migration's 4 sections.

-- =============================================================================
-- 4 (reverse). Drop foreign keys
-- =============================================================================

ALTER TABLE "commerce"."reconciliation_records" DROP CONSTRAINT IF EXISTS "reconciliation_records_payment_transaction_id_fkey";
ALTER TABLE "commerce"."refunds" DROP CONSTRAINT IF EXISTS "refunds_payment_transaction_id_fkey";
ALTER TABLE "commerce"."payment_callbacks" DROP CONSTRAINT IF EXISTS "payment_callbacks_payment_intent_id_fkey";
ALTER TABLE "commerce"."payment_transactions" DROP CONSTRAINT IF EXISTS "payment_transactions_payment_attempt_id_fkey";
ALTER TABLE "commerce"."payment_transactions" DROP CONSTRAINT IF EXISTS "payment_transactions_payment_intent_id_fkey";
ALTER TABLE "commerce"."payment_attempts" DROP CONSTRAINT IF EXISTS "payment_attempts_payment_intent_id_fkey";
ALTER TABLE "commerce"."payment_intents" DROP CONSTRAINT IF EXISTS "payment_intents_provider_id_fkey";

-- =============================================================================
-- 3 (reverse). Drop the new tables
-- =============================================================================

DROP TABLE IF EXISTS "commerce"."reconciliation_records";
DROP TABLE IF EXISTS "commerce"."refunds";
DROP TABLE IF EXISTS "commerce"."payment_callbacks";
DROP TABLE IF EXISTS "commerce"."payment_transactions";
DROP TABLE IF EXISTS "commerce"."payment_attempts";
DROP TABLE IF EXISTS "commerce"."payment_intents";
DROP TABLE IF EXISTS "commerce"."payment_providers";

-- =============================================================================
-- 2 (reverse). Drop the new enums
-- =============================================================================

DROP TYPE IF EXISTS "commerce"."ReconciliationStatus";
DROP TYPE IF EXISTS "commerce"."RefundStatus";
DROP TYPE IF EXISTS "commerce"."PaymentTransactionStatus";
DROP TYPE IF EXISTS "commerce"."PaymentAttemptStatus";
DROP TYPE IF EXISTS "commerce"."PaymentIntentStatus";

-- =============================================================================
-- 1 (reverse). Restore the Phase 003 placeholder Payment/Refund subtree
--
-- Restored to its exact pre-migration shape (0 rows either way — there is
-- nothing to carry back). A reapply of the forward migration after this
-- rollback drops these placeholder tables again, so the round trip is
-- reproducible regardless of how many times it repeats.
-- =============================================================================

CREATE TYPE "commerce"."PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE "commerce"."RefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED');

CREATE TABLE "commerce"."payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "commerce"."PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "transaction_ref" TEXT,
    "idempotency_key" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT,
    "status" "commerce"."RefundStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "commerce"."payments"("idempotency_key");
CREATE INDEX "payments_order_id_idx" ON "commerce"."payments"("order_id");
CREATE INDEX "refunds_payment_id_idx" ON "commerce"."refunds"("payment_id");

ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "commerce"."payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
