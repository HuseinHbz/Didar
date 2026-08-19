-- Phase 009 — enterprise order management, invoice & fulfillment
-- (docs/adr/ADR-009-order-fulfillment.md).
--
-- Context at authoring time: `commerce.orders`/`order_items`/
-- `order_status_history` and `finance.invoices`/`invoice_lines` (the Phase
-- 003 placeholder shape) have ZERO rows in the live dev database —
-- confirmed via `select count(*)` on each immediately before writing this
-- migration, and confirmed unreferenced by any application code (`grep`
-- across services/api/src and packages/types/src). This is *not* a
-- data-preserving migration in the Phase 005/006 sense for those five
-- tables (nothing to carry forward) — `orders`/`order_items`/
-- `order_status_history`/`invoices` are ALTERed in place (kept, not
-- dropped+recreated, since most of their original columns survive
-- unchanged) and `invoice_lines` is dropped and replaced by `invoice_items`
-- (renamed per the brief's own requested naming). Every OTHER table this
-- migration touches (`checkout_sessions`, `payment_intents`,
-- `catalog.products`, `inventory.warehouses`, `identity.users`, ...) is
-- genuinely data-preserving — this migration only ADDs columns/tables to
-- them, never drops or renames anything they already had.
--
-- 6 sections:
--   1. New enums: OrderSource, OrderPaymentStatus, OrderFulfillmentStatus,
--      FulfillmentStatus, ShipmentStatus, InvoiceStatus
--   2. OrderStatus enum value swap (17-value placeholder -> the real
--      8-value lifecycle ADR-009 decision 5 defines)
--   3. ALTER orders / order_items / invoices in place; DROP invoice_lines
--   4. New tables: fulfillments, fulfillment_items, shipments,
--      shipment_events, invoice_items
--   5. Foreign keys (intra-schema only, same convention every prior phase
--      follows — warehouse_id/customer_id/order_id-in-finance-schema stay
--      unenforced cross-schema pointers)
--   6. Two real Postgres sequences (order_number_seq, invoice_number_seq)
--      for server-generated numbering (ADR-009 decision 6) — not
--      expressible in schema.prisma (Prisma has no native sequence
--      support), hand-added here; USAGE granted to iecp_app since
--      services/api calls nextval() at runtime, not just migration tooling.

-- CreateEnum
CREATE TYPE "commerce"."OrderSource" AS ENUM ('STOREFRONT', 'ADMIN', 'POS');

-- CreateEnum
CREATE TYPE "commerce"."OrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "commerce"."OrderFulfillmentStatus" AS ENUM ('UNFULFILLED', 'PARTIALLY_FULFILLED', 'FULFILLED');

-- CreateEnum
CREATE TYPE "commerce"."FulfillmentStatus" AS ENUM ('PENDING', 'ALLOCATED', 'PROCESSING', 'PACKED', 'READY', 'SHIPPED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "commerce"."ShipmentStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "finance"."InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID', 'CANCELLED');

-- AlterEnum: swap the Phase 003 placeholder OrderStatus (17 values, a
-- lens-manufacturing/return workflow nothing in this codebase drives) for
-- the real 8-value lifecycle. Safe as a bare USING cast: orders/
-- order_status_history both have 0 rows.
BEGIN;
CREATE TYPE "commerce"."OrderStatus_new" AS ENUM ('PENDING_PAYMENT', 'PAID', 'PROCESSING', 'READY_TO_FULFILL', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'COMPLETED');
ALTER TABLE "commerce"."orders" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "commerce"."orders" ALTER COLUMN "status" TYPE "commerce"."OrderStatus_new" USING ("status"::text::"commerce"."OrderStatus_new");
ALTER TABLE "commerce"."order_status_history" ALTER COLUMN "from_status" TYPE "commerce"."OrderStatus_new" USING ("from_status"::text::"commerce"."OrderStatus_new");
ALTER TABLE "commerce"."order_status_history" ALTER COLUMN "to_status" TYPE "commerce"."OrderStatus_new" USING ("to_status"::text::"commerce"."OrderStatus_new");
ALTER TYPE "commerce"."OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "commerce"."OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "commerce"."OrderStatus_old";
ALTER TABLE "commerce"."orders" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';
COMMIT;

-- DropForeignKey
ALTER TABLE "finance"."invoice_lines" DROP CONSTRAINT "invoice_lines_invoice_id_fkey";

-- AlterTable
ALTER TABLE "commerce"."order_items" ADD COLUMN     "discount_amount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "tax_amount" BIGINT NOT NULL DEFAULT 0;

-- AlterTable: `deleted_at` dropped (0 rows — an Order is never soft-deleted
-- in this design, only CANCELLED; the placeholder's lifecycle-entity
-- assumption no longer fits once `status` itself carries CANCELLED as a
-- real terminal state).
ALTER TABLE "commerce"."orders" DROP COLUMN "deleted_at",
ADD COLUMN     "cancelled_at" TIMESTAMP(3),
ADD COLUMN     "checkout_session_id" UUID NOT NULL,
ADD COLUMN     "completed_at" TIMESTAMP(3),
ADD COLUMN     "fulfillment_status" "commerce"."OrderFulfillmentStatus" NOT NULL DEFAULT 'UNFULFILLED',
ADD COLUMN     "guest_token" TEXT,
ADD COLUMN     "paid_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "payment_intent_id" UUID NOT NULL,
ADD COLUMN     "payment_status" "commerce"."OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
ADD COLUMN     "refunded_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "source" "commerce"."OrderSource" NOT NULL DEFAULT 'STOREFRONT',
ALTER COLUMN "customer_id" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';

-- AlterTable. `updated_at`'s DEFAULT exists only to satisfy NOT NULL for
-- the (zero) existing rows during the ADD COLUMN itself — Prisma's
-- `@updatedAt` is application-managed going forward, so the default is
-- dropped in the very next statement, same two-step Prisma itself
-- generates for this exact pattern.
ALTER TABLE "finance"."invoices" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'IRR',
ADD COLUMN     "customer_id" UUID,
ADD COLUMN     "discount_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "shipping_total" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "status" "finance"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "voided_at" TIMESTAMP(3),
ALTER COLUMN "issued_at" DROP NOT NULL,
ALTER COLUMN "issued_at" DROP DEFAULT;

ALTER TABLE "finance"."invoices" ALTER COLUMN "updated_at" DROP DEFAULT;

-- DropTable
DROP TABLE "finance"."invoice_lines";

-- CreateTable
CREATE TABLE "commerce"."fulfillments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "status" "commerce"."FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
    "warehouse_id" UUID,
    "packed_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."fulfillment_items" (
    "id" UUID NOT NULL,
    "fulfillment_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fulfillment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."shipments" (
    "id" UUID NOT NULL,
    "fulfillment_id" UUID NOT NULL,
    "carrier" TEXT,
    "tracking_number" TEXT,
    "status" "commerce"."ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commerce"."shipment_events" (
    "id" UUID NOT NULL,
    "shipment_id" UUID NOT NULL,
    "status" "commerce"."ShipmentStatus" NOT NULL,
    "location" TEXT,
    "details" JSONB,
    "source" TEXT NOT NULL DEFAULT 'MANUAL_ADMIN',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance"."invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" BIGINT NOT NULL,
    "line_total" BIGINT NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fulfillments_order_id_idx" ON "commerce"."fulfillments"("order_id");

-- CreateIndex
CREATE INDEX "fulfillments_status_idx" ON "commerce"."fulfillments"("status");

-- CreateIndex
CREATE INDEX "fulfillment_items_fulfillment_id_idx" ON "commerce"."fulfillment_items"("fulfillment_id");

-- CreateIndex
CREATE INDEX "fulfillment_items_order_item_id_idx" ON "commerce"."fulfillment_items"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_fulfillment_id_key" ON "commerce"."shipments"("fulfillment_id");

-- CreateIndex
CREATE INDEX "shipment_events_shipment_id_idx" ON "commerce"."shipment_events"("shipment_id");

-- CreateIndex
CREATE INDEX "invoice_items_invoice_id_idx" ON "finance"."invoice_items"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_checkout_session_id_key" ON "commerce"."orders"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_payment_intent_id_key" ON "commerce"."orders"("payment_intent_id");

-- CreateIndex
CREATE INDEX "orders_guest_token_idx" ON "commerce"."orders"("guest_token");

-- CreateIndex
CREATE INDEX "invoices_order_id_idx" ON "finance"."invoices"("order_id");

-- AddForeignKey
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_checkout_session_id_fkey" FOREIGN KEY ("checkout_session_id") REFERENCES "commerce"."checkout_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."orders" ADD CONSTRAINT "orders_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "commerce"."payment_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."fulfillments" ADD CONSTRAINT "fulfillments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."fulfillment_items" ADD CONSTRAINT "fulfillment_items_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "commerce"."fulfillments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."fulfillment_items" ADD CONSTRAINT "fulfillment_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "commerce"."order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "commerce"."fulfillments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce"."shipment_events" ADD CONSTRAINT "shipment_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "commerce"."shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance"."invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "finance"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateSequence: server-generated order numbering (ADR-009 decision 6).
-- nextval() is atomic at the database level — the concurrency-safety
-- guarantee an application-memory counter cannot honestly provide.
CREATE SEQUENCE "commerce"."order_number_seq" START 1;
GRANT USAGE, SELECT ON SEQUENCE "commerce"."order_number_seq" TO iecp_app;

-- CreateSequence: server-generated invoice numbering, same technique.
CREATE SEQUENCE "finance"."invoice_number_seq" START 1;
GRANT USAGE, SELECT ON SEQUENCE "finance"."invoice_number_seq" TO iecp_app;
