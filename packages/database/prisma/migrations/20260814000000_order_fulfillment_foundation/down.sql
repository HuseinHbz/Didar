-- Down-migration for 20260814000000_order_fulfillment_foundation.
-- Restores the exact Phase 003 placeholder shape for
-- orders/order_items/order_status_history/invoices/invoice_lines and drops
-- every table/enum/sequence this migration added. `orders`/`invoices` had 0
-- rows both before and after this migration in every round-trip test run
-- (fresh seed/e2e state each time), so the round trip is reproducible
-- regardless of how many times it repeats — same precedent every prior
-- phase's own down.sql documents.

BEGIN;

-- 1. Drop the sequences this migration created.
DROP SEQUENCE IF EXISTS "finance"."invoice_number_seq";
DROP SEQUENCE IF EXISTS "commerce"."order_number_seq";

-- 2. Drop foreign keys + tables this migration added (children first).
ALTER TABLE "finance"."invoice_items" DROP CONSTRAINT IF EXISTS "invoice_items_invoice_id_fkey";
ALTER TABLE "commerce"."shipment_events" DROP CONSTRAINT IF EXISTS "shipment_events_shipment_id_fkey";
ALTER TABLE "commerce"."shipments" DROP CONSTRAINT IF EXISTS "shipments_fulfillment_id_fkey";
ALTER TABLE "commerce"."fulfillment_items" DROP CONSTRAINT IF EXISTS "fulfillment_items_order_item_id_fkey";
ALTER TABLE "commerce"."fulfillment_items" DROP CONSTRAINT IF EXISTS "fulfillment_items_fulfillment_id_fkey";
ALTER TABLE "commerce"."fulfillments" DROP CONSTRAINT IF EXISTS "fulfillments_order_id_fkey";

DROP TABLE IF EXISTS "finance"."invoice_items";
DROP TABLE IF EXISTS "commerce"."shipment_events";
DROP TABLE IF EXISTS "commerce"."shipments";
DROP TABLE IF EXISTS "commerce"."fulfillment_items";
DROP TABLE IF EXISTS "commerce"."fulfillments";

-- 3. Drop the orders <-> checkout_sessions/payment_intents FKs before
-- restoring orders' own column shape.
ALTER TABLE "commerce"."orders" DROP CONSTRAINT IF EXISTS "orders_payment_intent_id_fkey";
ALTER TABLE "commerce"."orders" DROP CONSTRAINT IF EXISTS "orders_checkout_session_id_fkey";

-- 4. Recreate invoice_lines (the placeholder table this migration dropped)
-- before restoring invoices' own column shape.
CREATE TABLE "finance"."invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_lines_invoice_id_idx" ON "finance"."invoice_lines"("invoice_id");
ALTER TABLE "finance"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "finance"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Restore invoices to its Phase 003 placeholder shape.
DROP INDEX IF EXISTS "finance"."invoices_order_id_idx";
ALTER TABLE "finance"."invoices"
  DROP COLUMN IF EXISTS "voided_at",
  DROP COLUMN IF EXISTS "updated_at",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "shipping_total",
  DROP COLUMN IF EXISTS "discount_total",
  DROP COLUMN IF EXISTS "customer_id",
  DROP COLUMN IF EXISTS "currency";
ALTER TABLE "finance"."invoices" ALTER COLUMN "issued_at" SET DEFAULT CURRENT_TIMESTAMP;
UPDATE "finance"."invoices" SET "issued_at" = CURRENT_TIMESTAMP WHERE "issued_at" IS NULL;
ALTER TABLE "finance"."invoices" ALTER COLUMN "issued_at" SET NOT NULL;

-- 6. Restore order_items to its Phase 003 placeholder shape.
ALTER TABLE "commerce"."order_items"
  DROP COLUMN IF EXISTS "tax_amount",
  DROP COLUMN IF EXISTS "discount_amount";

-- 7. Restore orders to its Phase 003 placeholder shape.
DROP INDEX IF EXISTS "commerce"."orders_guest_token_idx";
DROP INDEX IF EXISTS "commerce"."orders_payment_intent_id_key";
DROP INDEX IF EXISTS "commerce"."orders_checkout_session_id_key";
ALTER TABLE "commerce"."orders"
  DROP COLUMN IF EXISTS "source",
  DROP COLUMN IF EXISTS "refunded_total",
  DROP COLUMN IF EXISTS "payment_status",
  DROP COLUMN IF EXISTS "payment_intent_id",
  DROP COLUMN IF EXISTS "paid_total",
  DROP COLUMN IF EXISTS "guest_token",
  DROP COLUMN IF EXISTS "fulfillment_status",
  DROP COLUMN IF EXISTS "completed_at",
  DROP COLUMN IF EXISTS "checkout_session_id",
  DROP COLUMN IF EXISTS "cancelled_at",
  ADD COLUMN "deleted_at" TIMESTAMP(3);
ALTER TABLE "commerce"."orders" ALTER COLUMN "customer_id" SET NOT NULL;

-- 8. Swap OrderStatus back to the Phase 003 17-value placeholder. Same
-- BEGIN/COMMIT-wrapped rename-swap technique the up-migration used — safe
-- as a bare USING cast since orders/order_status_history have 0 rows.
ALTER TABLE "commerce"."orders" ALTER COLUMN "status" DROP DEFAULT;
CREATE TYPE "commerce"."OrderStatus_old" AS ENUM (
  'CREATED', 'PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'PROCESSING',
  'PRESCRIPTION_REVIEW', 'LENS_PRODUCTION', 'QUALITY_CONTROL', 'PACKED',
  'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURN_REQUESTED',
  'RETURN_APPROVED', 'RETURNED', 'REFUND_PENDING', 'REFUNDED'
);
ALTER TABLE "commerce"."orders" ALTER COLUMN "status" TYPE "commerce"."OrderStatus_old" USING ('CREATED'::text::"commerce"."OrderStatus_old");
ALTER TABLE "commerce"."order_status_history" ALTER COLUMN "from_status" TYPE "commerce"."OrderStatus_old" USING (NULL::"commerce"."OrderStatus_old");
ALTER TABLE "commerce"."order_status_history" ALTER COLUMN "to_status" TYPE "commerce"."OrderStatus_old" USING ('CREATED'::text::"commerce"."OrderStatus_old");
DROP TYPE "commerce"."OrderStatus";
ALTER TYPE "commerce"."OrderStatus_old" RENAME TO "OrderStatus";
ALTER TABLE "commerce"."orders" ALTER COLUMN "status" SET DEFAULT 'CREATED';

-- 9. Drop every enum this migration added.
DROP TYPE IF EXISTS "finance"."InvoiceStatus";
DROP TYPE IF EXISTS "commerce"."ShipmentStatus";
DROP TYPE IF EXISTS "commerce"."FulfillmentStatus";
DROP TYPE IF EXISTS "commerce"."OrderFulfillmentStatus";
DROP TYPE IF EXISTS "commerce"."OrderPaymentStatus";
DROP TYPE IF EXISTS "commerce"."OrderSource";

COMMIT;
