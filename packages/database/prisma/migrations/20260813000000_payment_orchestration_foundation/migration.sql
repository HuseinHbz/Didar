-- Phase 008 — payment orchestration & Iranian gateway integration
-- (docs/adr/ADR-008-payment-orchestration.md).
--
-- Context at authoring time: `commerce.payments`/`commerce.refunds` (the
-- Phase 003 placeholder shape, keyed on `order_id`/`payment_id`) have ZERO
-- rows in the live dev database — confirmed via
-- `select count(*) from commerce.payments` / `refunds` immediately before
-- writing this migration. This is *not* a data-preserving migration in the
-- Phase 005/006 sense (nothing to carry forward): both tables are dropped
-- and recreated with the new shape, rather than in-place ALTERed, since
-- `refunds` changes its own foreign key target entirely (`payment_id` ->
-- `payment_transaction_id`) — an ALTER here would obscure, not clarify,
-- what actually changed.
--
-- 4 sections:
--   1. Drop the Phase 003 placeholder: payments, refunds, PaymentStatus,
--      RefundStatus (old shape)
--   2. New enums: PaymentIntentStatus, PaymentAttemptStatus,
--      PaymentTransactionStatus, RefundStatus (new shape), ReconciliationStatus
--   3. New tables: payment_providers, payment_intents, payment_attempts,
--      payment_transactions, payment_callbacks, refunds (new shape),
--      reconciliation_records
--   4. Foreign keys (intra-schema only — checkout_session_id/customer_id
--      stay unenforced pointers, same cross-module convention every other
--      phase in this repo follows)

-- =============================================================================
-- 1. Drop the Phase 003 placeholder Payment/Refund subtree
-- =============================================================================

ALTER TABLE "commerce"."refunds" DROP CONSTRAINT IF EXISTS "refunds_payment_id_fkey";
ALTER TABLE "commerce"."payments" DROP CONSTRAINT IF EXISTS "payments_order_id_fkey";

DROP TABLE IF EXISTS "commerce"."refunds";
DROP TABLE IF EXISTS "commerce"."payments";

DROP TYPE IF EXISTS "commerce"."PaymentStatus";
DROP TYPE IF EXISTS "commerce"."RefundStatus";

-- =============================================================================
-- 2. New enums
-- =============================================================================

CREATE TYPE "commerce"."PaymentIntentStatus" AS ENUM ('CREATED', 'AWAITING_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELLED');

CREATE TYPE "commerce"."PaymentAttemptStatus" AS ENUM ('INITIATED', 'REDIRECTED', 'RETURNED', 'ABANDONED', 'EXPIRED');

CREATE TYPE "commerce"."PaymentTransactionStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

CREATE TYPE "commerce"."RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');

CREATE TYPE "commerce"."ReconciliationStatus" AS ENUM ('MATCHED', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'MISSING_LOCAL', 'MISSING_REMOTE');

-- =============================================================================
-- 3. New tables
-- =============================================================================

CREATE TABLE "commerce"."payment_providers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_sandbox" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "last_health_check_at" TIMESTAMP(3),
    "last_health_check_ok" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_providers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."payment_intents" (
    "id" UUID NOT NULL,
    "checkout_session_id" UUID NOT NULL,
    "customer_id" UUID,
    "guest_token" TEXT,
    "provider_id" UUID NOT NULL,
    "status" "commerce"."PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."payment_attempts" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "provider_authority" TEXT,
    "redirect_url" TEXT,
    "status" "commerce"."PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."payment_transactions" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "payment_attempt_id" UUID,
    "provider_id" UUID NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "status" "commerce"."PaymentTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "raw_verification_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."payment_callbacks" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID,
    "provider_id" UUID NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "signature_valid" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_callbacks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."refunds" (
    "id" UUID NOT NULL,
    "payment_transaction_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "reason" TEXT,
    "status" "commerce"."RefundStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID,
    "provider_refund_reference" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."reconciliation_records" (
    "id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "transaction_date" DATE NOT NULL,
    "payment_transaction_id" UUID,
    "provider_reference" TEXT NOT NULL,
    "local_amount" BIGINT,
    "remote_amount" BIGINT,
    "status" "commerce"."ReconciliationStatus" NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- Indexes

CREATE UNIQUE INDEX "payment_providers_code_key" ON "commerce"."payment_providers"("code");

CREATE UNIQUE INDEX "payment_intents_checkout_session_id_key" ON "commerce"."payment_intents"("checkout_session_id");
CREATE UNIQUE INDEX "payment_intents_idempotency_key_key" ON "commerce"."payment_intents"("idempotency_key");
CREATE INDEX "payment_intents_customer_id_idx" ON "commerce"."payment_intents"("customer_id");
CREATE INDEX "payment_intents_status_idx" ON "commerce"."payment_intents"("status");

CREATE UNIQUE INDEX "payment_attempts_payment_intent_id_attempt_number_key" ON "commerce"."payment_attempts"("payment_intent_id", "attempt_number");
CREATE INDEX "payment_attempts_payment_intent_id_idx" ON "commerce"."payment_attempts"("payment_intent_id");
CREATE INDEX "payment_attempts_provider_authority_idx" ON "commerce"."payment_attempts"("provider_authority");

CREATE UNIQUE INDEX "payment_transactions_provider_id_provider_reference_key" ON "commerce"."payment_transactions"("provider_id", "provider_reference");
CREATE INDEX "payment_transactions_payment_intent_id_idx" ON "commerce"."payment_transactions"("payment_intent_id");
CREATE INDEX "payment_transactions_status_idx" ON "commerce"."payment_transactions"("status");

CREATE UNIQUE INDEX "payment_callbacks_dedupe_key_key" ON "commerce"."payment_callbacks"("dedupe_key");
CREATE INDEX "payment_callbacks_payment_intent_id_idx" ON "commerce"."payment_callbacks"("payment_intent_id");
CREATE INDEX "payment_callbacks_provider_id_idx" ON "commerce"."payment_callbacks"("provider_id");

CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "commerce"."refunds"("idempotency_key");
CREATE INDEX "refunds_payment_transaction_id_idx" ON "commerce"."refunds"("payment_transaction_id");
CREATE INDEX "refunds_status_idx" ON "commerce"."refunds"("status");

CREATE INDEX "reconciliation_records_provider_id_idx" ON "commerce"."reconciliation_records"("provider_id");
CREATE INDEX "reconciliation_records_status_idx" ON "commerce"."reconciliation_records"("status");
CREATE INDEX "reconciliation_records_transaction_date_idx" ON "commerce"."reconciliation_records"("transaction_date");

-- =============================================================================
-- 4. Foreign keys (intra-schema only)
-- =============================================================================

ALTER TABLE "commerce"."payment_intents" ADD CONSTRAINT "payment_intents_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "commerce"."payment_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce"."payment_attempts" ADD CONSTRAINT "payment_attempts_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "commerce"."payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commerce"."payment_transactions" ADD CONSTRAINT "payment_transactions_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "commerce"."payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commerce"."payment_transactions" ADD CONSTRAINT "payment_transactions_payment_attempt_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "commerce"."payment_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commerce"."payment_callbacks" ADD CONSTRAINT "payment_callbacks_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "commerce"."payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "commerce"."payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "commerce"."reconciliation_records" ADD CONSTRAINT "reconciliation_records_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "commerce"."payment_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
