-- Phase 013 — return settlement recovery & reconciliation
-- (docs/adr/ADR-013-return-settlement-reconciliation.md). Additive: no
-- table drops, no data transforms, no destructive operations. Verified
-- against the live dev database before authoring: commerce.orders 1196
-- rows, commerce.order_items 1204, commerce.refunds 163,
-- commerce.return_requests 180, commerce.return_items 180,
-- finance.credit_notes 22, inventory.inventory_ledger 5776,
-- commerce.fulfillments 636, finance.invoices 1196 — real seed +
-- e2e-generated data, not an empty table. No pre-existing duplicate
-- finance.credit_notes.return_request_id value exists (checked
-- directly before authoring), so the new UNIQUE index below applies
-- cleanly against real data.
--
-- 5 sections:
--   1. commerce.return_settlements — the new durable settlement-execution
--      record, one row per ReturnRequest (ADR-013 decision 5).
--   2. commerce.return_items.restocked_at — nullable, additive; the
--      per-item "already restocked" fact a crash/retry checks before
--      calling receiveStock() again (decision 6).
--   3. inventory.inventory_ledger.idempotency_key — nullable, UNIQUE.
--      Every pre-Phase-013 call site omits it (Postgres allows
--      unlimited NULLs under a plain UNIQUE constraint, so every
--      existing row of 5776 is unaffected); the one new caller
--      (AdjustmentService.receiveReturnedStock(), keyed
--      return-restock__${returnItemId}) gets real database-enforced
--      "this restock happened at most once" (decision 6).
--   4. finance.credit_notes.return_request_id gains a real UNIQUE
--      constraint — a plain (non-partial) Postgres UNIQUE already
--      allows unlimited NULLs (standard SQL, NULL never equals NULL),
--      so no hand-written partial-index workaround is needed the way
--      Phase 010's CHECK-constraint backstop needed one. Closes the
--      real gap CreditNoteService.createDraftForReturn()'s own doc
--      comment claimed was "structurally guarded" with no database
--      backing (decision 9).
--   5. Backfill commerce.return_items.restocked_at for every item a
--      pre-Phase-013 ReturnRequest already physically restocked via
--      the old, synchronous ReturnService.approveForRefund() path
--      (removed in this same phase — see git history for
--      services/api/.../return.service.ts before the ADR-013 refactor).
--      Column 2 above defaults every pre-existing row to NULL, which —
--      without this backfill — reads as "never restocked" and would
--      make ReturnSettlementService.beginRestock() call
--      AdjustmentService.receiveReturnedStock() a real *second* time
--      for a return that already moved physical stock once under the
--      old code. Discovered empirically: an app boot against this
--      exact accumulated dev data, before this backfill existed,
--      produced 18 duplicate inventory.inventory_ledger rows across 18
--      ReturnItems (8 REFUNDED + 10 COMPLETED returns) — manually
--      reversed (ledger rows deleted, inventory_items quantities
--      restored) before this backfill was added and re-verified. Never
--      touches inventory quantities itself — bookkeeping only, mirrors
--      approveForRefund()'s exact eligibility condition so it marks
--      restocked_at for precisely the items that condition already
--      restocked, no more and no fewer.

-- 1. commerce.return_settlements
-- ---------------------------------------------------------------------------
CREATE TYPE "commerce"."ReturnSettlementStatus" AS ENUM ('PENDING_RESTOCK', 'RESTOCKED', 'REFUND_REQUESTED', 'SETTLED', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL', 'MANUAL_REVIEW');

CREATE TABLE "commerce"."return_settlements" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "status" "commerce"."ReturnSettlementStatus" NOT NULL DEFAULT 'PENDING_RESTOCK',
    "restock_completed_at" TIMESTAMP(3),
    "refund_requested_at" TIMESTAMP(3),
    "refund_recorded_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_attempt_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_settlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "return_settlements_return_request_id_key" ON "commerce"."return_settlements"("return_request_id");
CREATE INDEX "return_settlements_status_idx" ON "commerce"."return_settlements"("status");

ALTER TABLE "commerce"."return_settlements" ADD CONSTRAINT "return_settlements_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "commerce"."return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. commerce.return_items.restocked_at
-- ---------------------------------------------------------------------------
ALTER TABLE "commerce"."return_items" ADD COLUMN "restocked_at" TIMESTAMP(3);

-- 5. Backfill restocked_at for items the old approveForRefund() path
--    already physically restocked before this column existed.
-- ---------------------------------------------------------------------------
UPDATE "commerce"."return_items" ri
SET "restocked_at" = COALESCE(rr."approved_at", rr."updated_at")
FROM "commerce"."return_requests" rr, "commerce"."order_items" oi
WHERE rr."id" = ri."return_request_id"
  AND oi."id" = ri."order_item_id"
  AND rr."status" IN ('APPROVED_FOR_REFUND', 'REFUNDED', 'COMPLETED')
  AND ri."condition" IN ('UNOPENED', 'OPENED_UNUSED')
  AND oi."product_sku_id" IS NOT NULL
  AND rr."warehouse_id" IS NOT NULL
  AND rr."location_id" IS NOT NULL
  AND ri."restocked_at" IS NULL;

-- 3. inventory.inventory_ledger.idempotency_key
-- ---------------------------------------------------------------------------
ALTER TABLE "inventory"."inventory_ledger" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "inventory_ledger_idempotency_key_key" ON "inventory"."inventory_ledger"("idempotency_key");

-- 4. finance.credit_notes.return_request_id UNIQUE
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX "credit_notes_return_request_id_key" ON "finance"."credit_notes"("return_request_id");

-- No explicit iecp_app grant needed for commerce.return_settlements —
-- unlike a sequence (every prior phase's own migration grants those
-- explicitly as a belt-and-suspenders statement), a plain new TABLE is
-- already covered by the ALTER DEFAULT PRIVILEGES rule in
-- infrastructure/postgres/init/02-roles.sql, verified empirically at
-- Phase 003 (docs/database/README.md's own "Roles & least privilege"
-- section) and unmodified since.
