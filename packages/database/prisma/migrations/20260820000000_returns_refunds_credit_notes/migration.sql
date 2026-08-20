-- Phase 012 — returns, refunds & credit notes
-- (docs/adr/ADR-012-returns-refunds-credit-notes.md). Additive: no table
-- drops, no data transforms, no destructive operations. Verified against
-- the live dev database before authoring: commerce.orders 545 rows,
-- commerce.order_items 546, commerce.refunds 78, finance.invoices 545,
-- commerce.fulfillments 243 — real seed + e2e-generated data, not an
-- empty table.
--
-- 6 sections:
--   1. commerce.return_requests / return_items / return_status_history —
--      the new ReturnRequest aggregate (ADR-012 decision 1/5).
--   2. commerce.refunds — additive `return_request_id` column (nullable,
--      real FK, same schema) + new commerce.refund_lines child table
--      (ADR-012 decision 8). The existing `refunds` table, its columns,
--      and every existing row are untouched.
--   3. finance.credit_notes / credit_note_lines — the new CreditNote
--      lifecycle (ADR-012 decision 7). `return_request_id` is a plain,
--      unenforced UUID column (cross-schema pointer, same convention
--      `invoices.order_id` already uses) — deliberately not a Prisma
--      relation; see schema.prisma's own comment on
--      `ReturnRequest`/`CreditNote` for why (Prisma's `format`/`validate`
--      auto-completes a same-named relation into a real, enforced
--      cross-schema FK the moment one is declared either direction,
--      which this schema's own stated "cross-schema references are
--      intentionally unenforced" convention rules out).
--   4. Two real Postgres sequences (return_number_seq,
--      credit_note_number_seq) — identical technique to
--      commerce.order_number_seq/finance.invoice_number_seq, drawn inside
--      the same transaction as the insert, never an application-memory
--      counter.
--   5. Indexes justified directly by the query patterns this phase adds
--      (admin return/credit-note search, quantity/refund-line lookups).
--   6. iecp_app grants on the two new sequences — same explicit,
--      self-documenting pattern Phase 009's migration used for its own
--      two sequences (technically covered by the `ALTER DEFAULT
--      PRIVILEGES` rule in infrastructure/postgres/init/02-roles.sql
--      already, but stated explicitly here regardless, same precedent).

BEGIN;

-- 1. commerce.return_requests / return_items / return_status_history

CREATE TYPE "commerce"."ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'CUSTOMER_SHIPPING', 'RECEIVED', 'INSPECTING', 'APPROVED_FOR_REFUND', 'REFUNDED', 'COMPLETED', 'REJECTED', 'CANCELLED');
CREATE TYPE "commerce"."ReturnReason" AS ENUM ('DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'SIZE_FIT_ISSUE', 'OTHER');
CREATE TYPE "commerce"."ReturnResolution" AS ENUM ('REFUND', 'CREDIT_NOTE');
CREATE TYPE "commerce"."ReturnItemCondition" AS ENUM ('UNOPENED', 'OPENED_UNUSED', 'USED', 'DAMAGED', 'DEFECTIVE');

CREATE TABLE "commerce"."return_requests" (
    "id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID,
    "guest_token" TEXT,
    "status" "commerce"."ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "commerce"."ReturnReason" NOT NULL,
    "reason_note" TEXT,
    "resolution" "commerce"."ReturnResolution" NOT NULL DEFAULT 'REFUND',
    "warehouse_id" UUID,
    "location_id" UUID,
    "rejection_reason" TEXT,
    "idempotency_key" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "inspected_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."return_items" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" "commerce"."ReturnItemCondition",
    "refund_amount" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commerce"."return_status_history" (
    "id" UUID NOT NULL,
    "return_request_id" UUID NOT NULL,
    "from_status" "commerce"."ReturnStatus",
    "to_status" "commerce"."ReturnStatus" NOT NULL,
    "changed_by" UUID,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_status_history_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "commerce"."return_requests" ADD CONSTRAINT "return_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commerce"."return_items" ADD CONSTRAINT "return_items_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "commerce"."return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commerce"."return_items" ADD CONSTRAINT "return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "commerce"."order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commerce"."return_status_history" ADD CONSTRAINT "return_status_history_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "commerce"."return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "return_requests_return_number_key" ON "commerce"."return_requests"("return_number");
CREATE UNIQUE INDEX "return_requests_idempotency_key_key" ON "commerce"."return_requests"("idempotency_key");
CREATE INDEX "return_requests_order_id_idx" ON "commerce"."return_requests"("order_id");
CREATE INDEX "return_requests_customer_id_idx" ON "commerce"."return_requests"("customer_id");
CREATE INDEX "return_requests_guest_token_idx" ON "commerce"."return_requests"("guest_token");
CREATE INDEX "return_requests_status_idx" ON "commerce"."return_requests"("status");
CREATE INDEX "return_items_return_request_id_idx" ON "commerce"."return_items"("return_request_id");
CREATE INDEX "return_items_order_item_id_idx" ON "commerce"."return_items"("order_item_id");
CREATE INDEX "return_status_history_return_request_id_idx" ON "commerce"."return_status_history"("return_request_id");

-- 2. commerce.refunds additive extension + commerce.refund_lines

ALTER TABLE "commerce"."refunds" ADD COLUMN "return_request_id" UUID;
ALTER TABLE "commerce"."refunds" ADD CONSTRAINT "refunds_return_request_id_fkey" FOREIGN KEY ("return_request_id") REFERENCES "commerce"."return_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "refunds_return_request_id_idx" ON "commerce"."refunds"("return_request_id");

CREATE TABLE "commerce"."refund_lines" (
    "id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "return_item_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_lines_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "commerce"."refund_lines" ADD CONSTRAINT "refund_lines_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "commerce"."refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commerce"."refund_lines" ADD CONSTRAINT "refund_lines_return_item_id_fkey" FOREIGN KEY ("return_item_id") REFERENCES "commerce"."return_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "refund_lines_refund_id_idx" ON "commerce"."refund_lines"("refund_id");
CREATE INDEX "refund_lines_return_item_id_idx" ON "commerce"."refund_lines"("return_item_id");

-- 3. finance.credit_notes / credit_note_lines

CREATE TYPE "finance"."CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'APPLIED', 'VOID');

CREATE TABLE "finance"."credit_notes" (
    "id" UUID NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "return_request_id" UUID,
    "invoice_id" UUID,
    "customer_id" UUID,
    "status" "finance"."CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "subtotal" BIGINT NOT NULL,
    "discount_total" BIGINT NOT NULL DEFAULT 0,
    "tax_total" BIGINT NOT NULL DEFAULT 0,
    "grand_total" BIGINT NOT NULL,
    "issued_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finance"."credit_note_lines" (
    "id" UUID NOT NULL,
    "credit_note_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- `invoice_id` is a real, enforced FK (both tables live in `finance`).
-- `order_id`/`return_request_id`/`customer_id` are deliberately plain
-- UUID columns, no FK — unenforced cross-schema pointers, same
-- convention `finance.invoices.order_id` already uses.
ALTER TABLE "finance"."credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "finance"."invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "finance"."credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "finance"."credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "credit_notes_credit_note_number_key" ON "finance"."credit_notes"("credit_note_number");
CREATE INDEX "credit_notes_order_id_idx" ON "finance"."credit_notes"("order_id");
CREATE INDEX "credit_notes_return_request_id_idx" ON "finance"."credit_notes"("return_request_id");
CREATE INDEX "credit_notes_invoice_id_idx" ON "finance"."credit_notes"("invoice_id");
CREATE INDEX "credit_note_lines_credit_note_id_idx" ON "finance"."credit_note_lines"("credit_note_id");

-- 4. Sequences — identical technique to commerce.order_number_seq /
-- finance.invoice_number_seq (ADR-009 decision 6).

CREATE SEQUENCE "commerce"."return_number_seq" START 1;
GRANT USAGE, SELECT ON SEQUENCE "commerce"."return_number_seq" TO iecp_app;

CREATE SEQUENCE "finance"."credit_note_number_seq" START 1;
GRANT USAGE, SELECT ON SEQUENCE "finance"."credit_note_number_seq" TO iecp_app;

COMMIT;
