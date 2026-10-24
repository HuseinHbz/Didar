-- CP-031 — payment <-> order <-> inventory consistency
-- (docs/adr/ADR-031-payment-order-consistency.md; gaps P0-5, P0-6).
-- Purely additive: no table drops, no data transforms, no destructive
-- operations, no change to any existing row. Every new column is nullable
-- (or defaulted) and every new table starts empty, so this applies
-- cleanly against a database that already holds orders, refunds and
-- payment intents.
--
-- 3 sections:
--   1. commerce.order_exceptions — the durable, blocking work item raised
--      when a PAID order cannot get its stock allocated (gap P0-5). While
--      one is OPEN, OrderService.approve() refuses (HTTP 409). `dedupe_key`
--      is UNIQUE so racing conversions/sweeps collapse onto one row.
--   2. commerce.refunds.failure_reason — nullable; why a refund ended
--      REJECTED/FAILED (gap P0-6: e.g. "the gateway cannot refund a
--      partial amount, so the request was never sent"). Existing rows get
--      NULL, which is correct: none of them carried a reason.
--   3. commerce.payment_intents (status, updated_at) index — backs the
--      order_conversion sweep's "SUCCEEDED intents updated in the last 24h
--      that have no order yet" scan (gap P0-4) as a range scan rather than
--      a read of every SUCCEEDED intent ever written. Built without
--      CONCURRENTLY (migrations run in one transaction); on a very large
--      table schedule it for a quiet window.

BEGIN;

-- 1. commerce.order_exceptions
-- ---------------------------------------------------------------------------
CREATE TYPE "commerce"."OrderExceptionType" AS ENUM ('STOCK_SHORTFALL');
CREATE TYPE "commerce"."OrderExceptionStatus" AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "commerce"."OrderExceptionResolution" AS ENUM ('ALLOCATED', 'ORDER_CANCELLED');

CREATE TABLE "commerce"."order_exceptions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" "commerce"."OrderExceptionType" NOT NULL,
    "status" "commerce"."OrderExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "product_sku_id" UUID,
    "requested_quantity" INTEGER,
    "dedupe_key" TEXT NOT NULL,
    "detail" JSONB,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolution" "commerce"."OrderExceptionResolution",
    "resolved_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_exceptions_dedupe_key_key" ON "commerce"."order_exceptions"("dedupe_key");
CREATE INDEX "order_exceptions_order_id_idx" ON "commerce"."order_exceptions"("order_id");
CREATE INDEX "order_exceptions_status_opened_at_idx" ON "commerce"."order_exceptions"("status", "opened_at");

ALTER TABLE "commerce"."order_exceptions" ADD CONSTRAINT "order_exceptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. commerce.refunds.failure_reason
-- ---------------------------------------------------------------------------
ALTER TABLE "commerce"."refunds" ADD COLUMN "failure_reason" TEXT;

-- 3. commerce.payment_intents (status, updated_at)
-- ---------------------------------------------------------------------------
CREATE INDEX "payment_intents_status_updated_at_idx" ON "commerce"."payment_intents"("status", "updated_at");

-- No explicit iecp_app grant is needed for the new table: a plain TABLE is
-- covered by the ALTER DEFAULT PRIVILEGES rule in
-- infrastructure/postgres/init/02-roles.sql (verified at Phase 003 and
-- relied on by every migration since — see 20260821000000's closing note).

COMMIT;
