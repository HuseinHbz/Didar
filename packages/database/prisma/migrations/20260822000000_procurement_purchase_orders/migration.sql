-- Phase 021 — procurement (docs/adr/ADR-021-procurement.md). Additive:
-- no table drops, no data transforms, no destructive operations.
-- Verified against the live dev database before authoring:
-- inventory.warehouses 60 rows, inventory.inventory_ledger 11880,
-- inventory.stock_transfers 30 — real seed + e2e-generated data.
-- `inventory.inventory_ledger.movement_type` already has the
-- 'PURCHASE_RECEIPT' value this phase's receiving flow uses (added by
-- Phase 006, unused until now — see ADR-006 decision 9's "procurement/
-- returns readiness seam" and this module's own README) and
-- `inventory_ledger.idempotency_key` already exists (added by Phase
-- 013) — receiving reuses both without any change to that table.
--
-- 3 sections:
--   1. inventory.suppliers — new master-data table (mirrors
--      inventory.warehouses' own shape: code/name/status/soft-delete,
--      no financial/contract fields — out of P021's canonical scope).
--   2. inventory.purchase_orders — the new 6-state PurchaseOrder
--      aggregate root (PurchaseOrderStateMachine, domain layer).
--   3. inventory.purchase_order_items — line items, CHECK-constraint-
--      backstopped the same way Phase 010's
--      promotion_usage_within_limit/coupon_usage_within_limit are (see
--      that migration's own header) — real Postgres constraints on
--      quantity invariants, not just application-layer checks:
--        - ordered_quantity must be positive
--        - unit_cost can never be negative
--        - received_quantity can never exceed ordered_quantity
--          (the "no over-receiving" invariant P021's own acceptance
--          criteria implies by "concurrency-safe receiving")

-- 1. inventory.suppliers
-- ---------------------------------------------------------------------------
CREATE TYPE "inventory"."SupplierStatus" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "inventory"."suppliers" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "address" TEXT,
    "status" "inventory"."SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppliers_code_key" ON "inventory"."suppliers"("code");
CREATE INDEX "suppliers_status_idx" ON "inventory"."suppliers"("status");

-- 2. inventory.purchase_orders
-- ---------------------------------------------------------------------------
CREATE TYPE "inventory"."PurchaseOrderStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

CREATE TABLE "inventory"."purchase_orders" (
    "id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "inventory"."PurchaseOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "created_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_orders_po_number_key" ON "inventory"."purchase_orders"("po_number");
CREATE INDEX "purchase_orders_status_idx" ON "inventory"."purchase_orders"("status");
CREATE INDEX "purchase_orders_supplier_id_idx" ON "inventory"."purchase_orders"("supplier_id");
CREATE INDEX "purchase_orders_warehouse_id_idx" ON "inventory"."purchase_orders"("warehouse_id");

ALTER TABLE "inventory"."purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "inventory"."suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory"."purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. inventory.purchase_order_items
-- ---------------------------------------------------------------------------
CREATE TABLE "inventory"."purchase_order_items" (
    "id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "ordered_quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_items_ordered_quantity_positive" CHECK ("ordered_quantity" > 0),
    CONSTRAINT "purchase_order_items_unit_cost_non_negative" CHECK ("unit_cost" >= 0),
    CONSTRAINT "purchase_order_items_received_within_ordered" CHECK ("received_quantity" >= 0 AND "received_quantity" <= "ordered_quantity")
);

CREATE INDEX "purchase_order_items_product_sku_id_idx" ON "inventory"."purchase_order_items"("product_sku_id");
CREATE UNIQUE INDEX "purchase_order_items_purchase_order_id_product_sku_id_key" ON "inventory"."purchase_order_items"("purchase_order_id", "product_sku_id");

ALTER TABLE "inventory"."purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "inventory"."purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No explicit iecp_app grant needed for any of the 3 tables above —
-- covered by the ALTER DEFAULT PRIVILEGES rule in
-- infrastructure/postgres/init/02-roles.sql (verified at Phase 003,
-- unmodified since — see docs/database/README.md's "Roles & least
-- privilege" section).
