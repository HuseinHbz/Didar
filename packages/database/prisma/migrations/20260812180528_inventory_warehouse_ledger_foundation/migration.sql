-- Phase 006: inventory, warehouse, stock ledger & fulfillment readiness.
-- See docs/adr/ADR-006-inventory-architecture.md for the design rationale
-- (location-granular InventoryItem — decision 1; cached quantity buckets +
-- ledger as source of truth — decision 2; no DB CHECK constraint, row-lock
-- + domain validation instead — decision 3; polymorphic reservation source
-- and procurement/returns readiness — decisions 5 and 9).
--
-- This migration hand-migrates the existing (seed-fixture) data instead of
-- dropping it — verified against this project's actual dev database, which
-- at the time this migration was authored held exactly: 1 warehouse,
-- 1 inventory_item (on_hand=50, reserved=0, reorder_point=10),
-- 1 inventory_transaction (PURCHASE, +50), 0 stock_reservations:
--   - warehouses.is_active -> warehouses.status (true->ACTIVE,
--     false->INACTIVE); warehouses.type backfilled to 'CENTRAL' (a
--     reasonable default for pre-Phase-006 rows, since every warehouse this
--     schema has ever held was the single seed "Main Warehouse"); a
--     'MAIN'/STORAGE WarehouseLocation is created for every existing
--     warehouse (a warehouse must have >=1 location before it can hold
--     stock — ADR-006 decision 1), and every inventory_items row is
--     repointed to it;
--   - inventory_items.{quantity_on_hand,quantity_reserved} are renamed (not
--     recomputed) to {on_hand_quantity,reserved_quantity}; the new
--     available_quantity/in_transit_quantity/damaged_quantity/
--     quarantined_quantity/blocked_quantity/version columns are backfilled
--     (available = on_hand - reserved, the rest 0/0);
--   - inventory_items.reorder_point rows move to the new
--     inventory_thresholds table (one row per product_sku_id+warehouse_id,
--     safety_stock defaulted to 0 since the old schema never tracked it)
--     before the column is dropped;
--   - inventory_transactions rows become inventory_ledger rows, mapping
--     the old 10-value InventoryTransactionType onto the new 13-value
--     InventoryMovementType (PURCHASE->PURCHASE_RECEIPT, RELEASE->
--     RESERVATION_RELEASE, RETURN->RETURN_RECEIPT, the rest unchanged
--     name-for-name); before/after on_hand is reconstructed via a running
--     sum per inventory_item ordered by (created_at, id) — the old schema
--     never distinguished which quantity bucket a delta applied to, so
--     this assumes every legacy delta was an on_hand movement (true for
--     every row this migration was actually run against) and carries
--     reserved_quantity through unchanged as both before/after (the old
--     ledger never recorded reserved-quantity snapshots either). This is a
--     best-effort backfill verified against this migration's actual seed
--     data, not a general-purpose historical replay engine — see the ADR
--     for why this is an accepted, documented trade-off rather than a gap;
--   - stock_reservations rows become inventory_reservations rows
--     (order_id -> sourceType='ORDER'/sourceId, a fresh idempotency_key
--     generated for each since the old table never had one, CONSUMED ->
--     CONVERTED to match the new status vocabulary) — there were zero rows
--     in the database this migration was developed against, so this path
--     is exercised by the migration's dry-run test, not live seed data.
-- packages/database/prisma/seed.ts is upsert-based on a stable key (code/
-- productSkuId+warehouseId), so re-running it after this migration
-- reconciles the seed fixture to its real Phase 006 value — same
-- idempotent-seed convention every prior phase used for its own backfills.

-- =============================================================================
-- 1. New enums
-- =============================================================================
CREATE TYPE "inventory"."WarehouseType" AS ENUM ('CENTRAL', 'REGIONAL', 'STORE', 'DARK_STORE', 'QUARANTINE');
CREATE TYPE "inventory"."WarehouseStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');
CREATE TYPE "inventory"."LocationType" AS ENUM ('RECEIVING', 'PICKING', 'STORAGE', 'QUARANTINE', 'DAMAGED', 'RETURNS', 'STAGING');
CREATE TYPE "inventory"."InventoryMovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALE', 'RESERVATION', 'RESERVATION_RELEASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'RETURN_RECEIPT', 'DAMAGE', 'ADJUSTMENT', 'COUNT_ADJUSTMENT', 'QUARANTINE', 'RELEASE_FROM_QUARANTINE', 'MANUAL_CORRECTION');
CREATE TYPE "inventory"."InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONVERTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "inventory"."StockTransferStatus" AS ENUM ('DRAFT', 'REQUESTED', 'APPROVED', 'PICKING', 'DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "inventory"."InventoryAdjustmentType" AS ENUM ('POSITIVE', 'NEGATIVE');
CREATE TYPE "inventory"."StockCountStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COUNTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED');

-- =============================================================================
-- 2. warehouses: add type/status/timezone/capacity, backfill, drop is_active
-- =============================================================================
ALTER TABLE "inventory"."warehouses"
  ADD COLUMN "type" "inventory"."WarehouseType",
  ADD COLUMN "status" "inventory"."WarehouseStatus",
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Tehran',
  ADD COLUMN "capacity" INTEGER;

UPDATE "inventory"."warehouses" SET "type" = 'CENTRAL';
UPDATE "inventory"."warehouses" SET "status" = CASE WHEN "is_active" THEN 'ACTIVE' ELSE 'INACTIVE' END::"inventory"."WarehouseStatus";

ALTER TABLE "inventory"."warehouses"
  ALTER COLUMN "type" SET NOT NULL,
  ALTER COLUMN "type" SET DEFAULT 'CENTRAL',
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "inventory"."warehouses" DROP COLUMN "is_active";

CREATE INDEX "warehouses_type_idx" ON "inventory"."warehouses"("type");
CREATE INDEX "warehouses_status_idx" ON "inventory"."warehouses"("status");

-- =============================================================================
-- 3. warehouse_locations (new) — every warehouse needs >=1 before it can
--    hold stock (ADR-006 decision 1); backfill one MAIN/STORAGE location
--    per existing warehouse.
-- =============================================================================
CREATE TABLE "inventory"."warehouse_locations" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "inventory"."LocationType" NOT NULL DEFAULT 'STORAGE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "warehouse_locations_warehouse_id_code_key" ON "inventory"."warehouse_locations"("warehouse_id", "code");
CREATE INDEX "warehouse_locations_warehouse_id_idx" ON "inventory"."warehouse_locations"("warehouse_id");

ALTER TABLE "inventory"."warehouse_locations"
  ADD CONSTRAINT "warehouse_locations_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "inventory"."warehouse_locations" ("id", "warehouse_id", "code", "name", "type", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), "id", 'MAIN', 'Main Storage', 'STORAGE', true, "created_at", "updated_at"
FROM "inventory"."warehouses";

-- =============================================================================
-- 4. inventory_items: rename quantity columns, add location_id + new
--    quantity buckets + version, backfill, tighten uniqueness
-- =============================================================================
ALTER TABLE "inventory"."inventory_items" RENAME COLUMN "quantity_on_hand" TO "on_hand_quantity";
ALTER TABLE "inventory"."inventory_items" RENAME COLUMN "quantity_reserved" TO "reserved_quantity";

ALTER TABLE "inventory"."inventory_items"
  ADD COLUMN "location_id" UUID,
  ADD COLUMN "available_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "in_transit_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "damaged_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "quarantined_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "blocked_quantity" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

UPDATE "inventory"."inventory_items" ii
SET "location_id" = wl."id"
FROM "inventory"."warehouse_locations" wl
WHERE wl."warehouse_id" = ii."warehouse_id" AND wl."code" = 'MAIN';

UPDATE "inventory"."inventory_items"
SET "available_quantity" = GREATEST("on_hand_quantity" - "reserved_quantity", 0);

ALTER TABLE "inventory"."inventory_items" ALTER COLUMN "location_id" SET NOT NULL;

-- =============================================================================
-- 5. inventory_thresholds (new) — reorder_point rows move here before the
--    column is dropped from inventory_items (ADR-006 decision 6).
-- =============================================================================
CREATE TABLE "inventory"."inventory_thresholds" (
    "id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reorder_point" INTEGER NOT NULL DEFAULT 0,
    "safety_stock" INTEGER NOT NULL DEFAULT 0,
    "min_stock" INTEGER,
    "max_stock" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_thresholds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_thresholds_product_sku_id_warehouse_id_key" ON "inventory"."inventory_thresholds"("product_sku_id", "warehouse_id");
CREATE INDEX "inventory_thresholds_warehouse_id_idx" ON "inventory"."inventory_thresholds"("warehouse_id");

ALTER TABLE "inventory"."inventory_thresholds"
  ADD CONSTRAINT "inventory_thresholds_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "inventory"."inventory_thresholds" ("id", "product_sku_id", "warehouse_id", "reorder_point", "safety_stock", "created_at", "updated_at")
SELECT gen_random_uuid(), "product_sku_id", "warehouse_id", "reorder_point", 0, now(), now()
FROM "inventory"."inventory_items"
WHERE "reorder_point" IS NOT NULL;

ALTER TABLE "inventory"."inventory_items" DROP COLUMN "reorder_point";

-- inventory_items: tighten uniqueness to (product_sku_id, warehouse_id,
-- location_id) — was (warehouse_id, product_sku_id) only.
DROP INDEX "inventory"."inventory_items_warehouse_id_product_sku_id_key";
CREATE UNIQUE INDEX "inventory_items_product_sku_id_warehouse_id_location_id_key" ON "inventory"."inventory_items"("product_sku_id", "warehouse_id", "location_id");
CREATE INDEX "inventory_items_warehouse_id_idx" ON "inventory"."inventory_items"("warehouse_id");
CREATE INDEX "inventory_items_product_sku_id_warehouse_id_idx" ON "inventory"."inventory_items"("product_sku_id", "warehouse_id");

ALTER TABLE "inventory"."inventory_items"
  ADD CONSTRAINT "inventory_items_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "inventory"."warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 6. inventory_ledger (new, replaces inventory_transactions) — append-only,
--    the authoritative movement history (ADR-006 decision 2).
-- =============================================================================
CREATE TABLE "inventory"."inventory_ledger" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "movement_type" "inventory"."InventoryMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "before_on_hand" INTEGER NOT NULL,
    "after_on_hand" INTEGER NOT NULL,
    "before_reserved" INTEGER NOT NULL,
    "after_reserved" INTEGER NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "reason" TEXT,
    "actor_user_id" UUID,
    "correlation_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_ledger_inventory_item_id_idx" ON "inventory"."inventory_ledger"("inventory_item_id");
CREATE INDEX "inventory_ledger_product_sku_id_idx" ON "inventory"."inventory_ledger"("product_sku_id");
CREATE INDEX "inventory_ledger_warehouse_id_idx" ON "inventory"."inventory_ledger"("warehouse_id");
CREATE INDEX "inventory_ledger_reference_type_reference_id_idx" ON "inventory"."inventory_ledger"("reference_type", "reference_id");
CREATE INDEX "inventory_ledger_correlation_id_idx" ON "inventory"."inventory_ledger"("correlation_id");
CREATE INDEX "inventory_ledger_created_at_idx" ON "inventory"."inventory_ledger"("created_at");

ALTER TABLE "inventory"."inventory_ledger"
  ADD CONSTRAINT "inventory_ledger_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory"."inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_ledger_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "inventory"."warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "inventory"."inventory_ledger" (
  "id", "inventory_item_id", "product_sku_id", "warehouse_id", "location_id",
  "movement_type", "quantity", "before_on_hand", "after_on_hand",
  "before_reserved", "after_reserved", "reference_type", "reference_id",
  "reason", "actor_user_id", "correlation_id", "created_at"
)
SELECT
  t."id",
  t."inventory_item_id",
  ii."product_sku_id",
  ii."warehouse_id",
  ii."location_id",
  (CASE t."type"::text
    WHEN 'PURCHASE' THEN 'PURCHASE_RECEIPT'
    WHEN 'RELEASE' THEN 'RESERVATION_RELEASE'
    WHEN 'RETURN' THEN 'RETURN_RECEIPT'
    ELSE t."type"::text
  END)::"inventory"."InventoryMovementType",
  t."quantity_delta",
  COALESCE(SUM(t."quantity_delta") OVER (PARTITION BY t."inventory_item_id" ORDER BY t."created_at", t."id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0),
  SUM(t."quantity_delta") OVER (PARTITION BY t."inventory_item_id" ORDER BY t."created_at", t."id" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
  ii."reserved_quantity",
  ii."reserved_quantity",
  'LEGACY_MIGRATION',
  t."id",
  t."note",
  t."created_by",
  gen_random_uuid(),
  t."created_at"
FROM "inventory"."inventory_transactions" t
JOIN "inventory"."inventory_items" ii ON ii."id" = t."inventory_item_id";

DROP TABLE "inventory"."inventory_transactions";
DROP TYPE "inventory"."InventoryTransactionType";

-- =============================================================================
-- 7. inventory_reservations (new, replaces stock_reservations) —
--    transactional, idempotency-key-protected, source-tracked
--    (ADR-006 decisions 4-5).
-- =============================================================================
CREATE TABLE "inventory"."inventory_reservations" (
    "id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "inventory"."InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_reservations_idempotency_key_key" ON "inventory"."inventory_reservations"("idempotency_key");
CREATE INDEX "inventory_reservations_inventory_item_id_idx" ON "inventory"."inventory_reservations"("inventory_item_id");
CREATE INDEX "inventory_reservations_product_sku_id_warehouse_id_idx" ON "inventory"."inventory_reservations"("product_sku_id", "warehouse_id");
CREATE INDEX "inventory_reservations_source_type_source_id_idx" ON "inventory"."inventory_reservations"("source_type", "source_id");
CREATE INDEX "inventory_reservations_status_idx" ON "inventory"."inventory_reservations"("status");
CREATE INDEX "inventory_reservations_expires_at_idx" ON "inventory"."inventory_reservations"("expires_at");

ALTER TABLE "inventory"."inventory_reservations"
  ADD CONSTRAINT "inventory_reservations_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory"."inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "inventory"."inventory_reservations" (
  "id", "product_sku_id", "warehouse_id", "location_id", "inventory_item_id",
  "quantity", "status", "source_type", "source_id", "idempotency_key",
  "expires_at", "released_at", "created_at", "updated_at"
)
SELECT
  sr."id",
  ii."product_sku_id",
  ii."warehouse_id",
  ii."location_id",
  sr."inventory_item_id",
  sr."quantity",
  (CASE sr."status"::text WHEN 'CONSUMED' THEN 'CONVERTED' ELSE sr."status"::text END)::"inventory"."InventoryReservationStatus",
  'ORDER',
  COALESCE(sr."order_id", sr."id"),
  gen_random_uuid()::text,
  sr."expires_at",
  CASE WHEN sr."status"::text = 'RELEASED' THEN sr."updated_at" ELSE NULL END,
  sr."created_at",
  sr."updated_at"
FROM "inventory"."stock_reservations" sr
JOIN "inventory"."inventory_items" ii ON ii."id" = sr."inventory_item_id";

DROP TABLE "inventory"."stock_reservations";
DROP TYPE "inventory"."ReservationStatus";

-- =============================================================================
-- 8. stock_transfers + stock_transfer_items (new, no prior data)
-- =============================================================================
CREATE TABLE "inventory"."stock_transfers" (
    "id" UUID NOT NULL,
    "reference_number" TEXT NOT NULL,
    "source_warehouse_id" UUID NOT NULL,
    "destination_warehouse_id" UUID NOT NULL,
    "status" "inventory"."StockTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "requested_by" UUID,
    "approved_by" UUID,
    "dispatched_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfers_reference_number_key" ON "inventory"."stock_transfers"("reference_number");
CREATE INDEX "stock_transfers_status_idx" ON "inventory"."stock_transfers"("status");
CREATE INDEX "stock_transfers_source_warehouse_id_idx" ON "inventory"."stock_transfers"("source_warehouse_id");
CREATE INDEX "stock_transfers_destination_warehouse_id_idx" ON "inventory"."stock_transfers"("destination_warehouse_id");

ALTER TABLE "inventory"."stock_transfers"
  ADD CONSTRAINT "stock_transfers_source_warehouse_id_fkey"
  FOREIGN KEY ("source_warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_transfers_destination_warehouse_id_fkey"
  FOREIGN KEY ("destination_warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inventory"."stock_transfer_items" (
    "id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "requested_quantity" INTEGER NOT NULL,
    "approved_quantity" INTEGER,
    "dispatched_quantity" INTEGER,
    "received_quantity" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfer_items_transfer_id_product_sku_id_key" ON "inventory"."stock_transfer_items"("transfer_id", "product_sku_id");
CREATE INDEX "stock_transfer_items_product_sku_id_idx" ON "inventory"."stock_transfer_items"("product_sku_id");

ALTER TABLE "inventory"."stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_transfer_id_fkey"
  FOREIGN KEY ("transfer_id") REFERENCES "inventory"."stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 9. inventory_adjustments (new, no prior data)
-- =============================================================================
CREATE TABLE "inventory"."inventory_adjustments" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "adjustment_type" "inventory"."InventoryAdjustmentType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_adjustments_warehouse_id_idx" ON "inventory"."inventory_adjustments"("warehouse_id");
CREATE INDEX "inventory_adjustments_product_sku_id_idx" ON "inventory"."inventory_adjustments"("product_sku_id");

ALTER TABLE "inventory"."inventory_adjustments"
  ADD CONSTRAINT "inventory_adjustments_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "inventory_adjustments_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "inventory"."warehouse_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 10. stock_counts + stock_count_items (new, no prior data)
-- =============================================================================
CREATE TABLE "inventory"."stock_counts" (
    "id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID,
    "status" "inventory"."StockCountStatus" NOT NULL DEFAULT 'PLANNED',
    "counted_by" UUID,
    "approved_by" UUID,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_counts_warehouse_id_idx" ON "inventory"."stock_counts"("warehouse_id");
CREATE INDEX "stock_counts_status_idx" ON "inventory"."stock_counts"("status");

ALTER TABLE "inventory"."stock_counts"
  ADD CONSTRAINT "stock_counts_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "inventory"."warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_counts_location_id_fkey"
  FOREIGN KEY ("location_id") REFERENCES "inventory"."warehouse_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "inventory"."stock_count_items" (
    "id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "expected_quantity" INTEGER NOT NULL,
    "counted_quantity" INTEGER,
    "variance" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_count_items_stock_count_id_product_sku_id_key" ON "inventory"."stock_count_items"("stock_count_id", "product_sku_id");

ALTER TABLE "inventory"."stock_count_items"
  ADD CONSTRAINT "stock_count_items_stock_count_id_fkey"
  FOREIGN KEY ("stock_count_id") REFERENCES "inventory"."stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
