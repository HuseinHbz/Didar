-- Rollback for 20260812180528_inventory_warehouse_ledger_foundation.
--
-- Produced the same way every prior migration's down.sql was: a first
-- draft from `prisma migrate diff --from-url <live> --to-schema-datamodel
-- <schema.prisma as of the previous migration>` (which by itself is
-- data-destructive — it just drops the new columns/tables), then hand-
-- adapted to carry data back instead of discarding it, mirroring this
-- migration's own up.sql care. Verified end-to-end (up -> down -> up, zero
-- drift via `prisma migrate diff` at every step) against this project's
-- actual dev database. See packages/database/scripts/db-rollback.sh's own
-- header for why `prisma migrate resolve --rolled-back` is not used here.
--
-- Documented, accepted lossy collapses (same spirit as prior migrations'
-- own documented trade-offs):
--   - inventory_ledger.movement_type -> inventory_transactions.type: the
--     three Phase 006-only values with no Phase 003 equivalent
--     (QUARANTINE, RELEASE_FROM_QUARANTINE, MANUAL_CORRECTION) collapse to
--     'ADJUSTMENT' — the closest old-vocabulary meaning ("a stock quantity
--     changed outside the normal sale/purchase/transfer flow").
--   - inventory_ledger's before/after on_hand/reserved snapshot columns
--     have no home in the old inventory_transactions shape and are
--     dropped — inventory_transactions never tracked them.
--   - inventory_reservations.status -> stock_reservations.status: EXPIRED
--     and CANCELLED (both Phase 006-only) collapse to 'RELEASED' — the old
--     3-value enum's closest "no longer holding stock" meaning.
--   - inventory_reservations.sourceType/sourceId -> stock_reservations.
--     order_id: only preserved when sourceType = 'ORDER'; a reservation
--     sourced from anything else (this phase implements no other real
--     source, so none exist in practice) rolls back with a NULL order_id,
--     matching the old column's own nullability.
--   - inventory_items is location-granular post-migration (unique on
--     product_sku_id+warehouse_id+location_id); the pre-migration shape
--     was warehouse-level only (unique on warehouse_id+product_sku_id).
--     Rolling back consolidates every location's row for the same
--     warehouse+SKU into one, summing on_hand/reserved quantities — lossy
--     (per-location detail is gone) but deterministic, and any
--     inventory_transactions/stock_reservations row that pointed at a
--     "losing" duplicate is repointed to the surviving row first, so no
--     orphaned foreign key is left behind. This project's actual data at
--     every point this migration has been run against never had more than
--     one location per warehouse, so this path is implemented for
--     correctness but not exercised by a real multi-location dataset yet.
--   - stock_transfers/stock_transfer_items/inventory_adjustments/
--     stock_counts/stock_count_items have no Phase 003 equivalent at all
--     — dropped outright, nothing to carry back.
--   - warehouse_locations has no Phase 003 equivalent — dropped outright
--     once inventory_items no longer references it.

-- =============================================================================
-- 1. stock_counts / stock_count_items — no prior equivalent, drop outright
-- =============================================================================
DROP TABLE "inventory"."stock_count_items";
DROP TABLE "inventory"."stock_counts";
DROP TYPE "inventory"."StockCountStatus";

-- =============================================================================
-- 2. inventory_adjustments — no prior equivalent, drop outright
-- =============================================================================
DROP TABLE "inventory"."inventory_adjustments";
DROP TYPE "inventory"."InventoryAdjustmentType";

-- =============================================================================
-- 3. stock_transfers / stock_transfer_items — no prior equivalent, drop outright
-- =============================================================================
DROP TABLE "inventory"."stock_transfer_items";
DROP TABLE "inventory"."stock_transfers";
DROP TYPE "inventory"."StockTransferStatus";

-- =============================================================================
-- 4. inventory_reservations -> stock_reservations (recreate + backfill)
-- =============================================================================
CREATE TYPE "inventory"."ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

CREATE TABLE "inventory"."stock_reservations" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "order_id" UUID,
    "quantity" INTEGER NOT NULL,
    "status" "inventory"."ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "inventory"."stock_reservations" (
  "id", "inventory_item_id", "order_id", "quantity", "status",
  "expires_at", "created_at", "updated_at"
)
SELECT
  ir."id",
  ir."inventory_item_id",
  (CASE WHEN ir."source_type" = 'ORDER' THEN ir."source_id" ELSE NULL END),
  ir."quantity",
  (CASE ir."status"::text
    WHEN 'CONVERTED' THEN 'CONSUMED'
    WHEN 'EXPIRED' THEN 'RELEASED'
    WHEN 'CANCELLED' THEN 'RELEASED'
    ELSE ir."status"::text
  END)::"inventory"."ReservationStatus",
  ir."expires_at",
  ir."created_at",
  ir."updated_at"
FROM "inventory"."inventory_reservations" ir;

CREATE INDEX "stock_reservations_inventory_item_id_idx" ON "inventory"."stock_reservations"("inventory_item_id");
CREATE INDEX "stock_reservations_order_id_idx" ON "inventory"."stock_reservations"("order_id");

ALTER TABLE "inventory"."stock_reservations"
  ADD CONSTRAINT "stock_reservations_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory"."inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "inventory"."inventory_reservations";
DROP TYPE "inventory"."InventoryReservationStatus";

-- =============================================================================
-- 5. inventory_ledger -> inventory_transactions (recreate + backfill)
-- =============================================================================
CREATE TYPE "inventory"."InventoryTransactionType" AS ENUM ('PURCHASE', 'SALE', 'RESERVATION', 'RELEASE', 'TRANSFER_OUT', 'TRANSFER_IN', 'DAMAGE', 'ADJUSTMENT', 'RETURN', 'COUNT_ADJUSTMENT');

CREATE TABLE "inventory"."inventory_transactions" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "type" "inventory"."InventoryTransactionType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

INSERT INTO "inventory"."inventory_transactions" (
  "id", "inventory_item_id", "type", "quantity_delta", "reference", "note", "created_by", "created_at"
)
SELECT
  il."id",
  il."inventory_item_id",
  (CASE il."movement_type"::text
    WHEN 'PURCHASE_RECEIPT' THEN 'PURCHASE'
    WHEN 'RESERVATION_RELEASE' THEN 'RELEASE'
    WHEN 'RETURN_RECEIPT' THEN 'RETURN'
    WHEN 'QUARANTINE' THEN 'ADJUSTMENT'
    WHEN 'RELEASE_FROM_QUARANTINE' THEN 'ADJUSTMENT'
    WHEN 'MANUAL_CORRECTION' THEN 'ADJUSTMENT'
    ELSE il."movement_type"::text
  END)::"inventory"."InventoryTransactionType",
  il."quantity",
  COALESCE(il."reference_type" || ':' || il."reference_id"::text, il."reference_id"::text),
  il."reason",
  il."actor_user_id",
  il."created_at"
FROM "inventory"."inventory_ledger" il;

CREATE INDEX "inventory_transactions_inventory_item_id_idx" ON "inventory"."inventory_transactions"("inventory_item_id");

ALTER TABLE "inventory"."inventory_transactions"
  ADD CONSTRAINT "inventory_transactions_inventory_item_id_fkey"
  FOREIGN KEY ("inventory_item_id") REFERENCES "inventory"."inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE "inventory"."inventory_ledger";
DROP TYPE "inventory"."InventoryMovementType";

-- =============================================================================
-- 6. inventory_items.reorder_point <- inventory_thresholds, then drop it
-- =============================================================================
ALTER TABLE "inventory"."inventory_items" ADD COLUMN "reorder_point" INTEGER;

UPDATE "inventory"."inventory_items" ii
SET "reorder_point" = it."reorder_point"
FROM "inventory"."inventory_thresholds" it
WHERE it."product_sku_id" = ii."product_sku_id" AND it."warehouse_id" = ii."warehouse_id";

DROP TABLE "inventory"."inventory_thresholds";

-- =============================================================================
-- 7. inventory_items: consolidate location-granular rows back to
--    warehouse-level (see header note), restore quantity_on_hand/
--    quantity_reserved, drop the Phase 006-only columns.
-- =============================================================================
-- Repoint any inventory_transactions/stock_reservations row that
-- references a duplicate (non-minimum-id) inventory_items row for the same
-- (warehouse_id, product_sku_id) at the row that will survive consolidation.
WITH ranked AS (
  SELECT "id", "warehouse_id", "product_sku_id",
         (MIN("id"::text) OVER (PARTITION BY "warehouse_id", "product_sku_id"))::uuid AS "keep_id"
  FROM "inventory"."inventory_items"
)
UPDATE "inventory"."inventory_transactions" t
SET "inventory_item_id" = r."keep_id"
FROM ranked r
WHERE t."inventory_item_id" = r."id" AND r."id" <> r."keep_id";

WITH ranked AS (
  SELECT "id", "warehouse_id", "product_sku_id",
         (MIN("id"::text) OVER (PARTITION BY "warehouse_id", "product_sku_id"))::uuid AS "keep_id"
  FROM "inventory"."inventory_items"
)
UPDATE "inventory"."stock_reservations" sr
SET "inventory_item_id" = r."keep_id"
FROM ranked r
WHERE sr."inventory_item_id" = r."id" AND r."id" <> r."keep_id";

-- Sum on_hand/reserved/reorder_point from every duplicate row onto the
-- surviving (minimum-id) row per (warehouse_id, product_sku_id).
WITH aggregated AS (
  SELECT "warehouse_id", "product_sku_id",
         MIN("id"::text)::uuid AS "keep_id",
         SUM("on_hand_quantity") AS "sum_on_hand",
         SUM("reserved_quantity") AS "sum_reserved",
         MAX("reorder_point") AS "max_reorder_point"
  FROM "inventory"."inventory_items"
  GROUP BY "warehouse_id", "product_sku_id"
)
UPDATE "inventory"."inventory_items" ii
SET "on_hand_quantity" = a."sum_on_hand",
    "reserved_quantity" = a."sum_reserved",
    "reorder_point" = a."max_reorder_point"
FROM aggregated a
WHERE ii."id" = a."keep_id";

DELETE FROM "inventory"."inventory_items" ii
WHERE ii."id" NOT IN (
  SELECT MIN("id"::text)::uuid FROM "inventory"."inventory_items" GROUP BY "warehouse_id", "product_sku_id"
);

ALTER TABLE "inventory"."inventory_items" RENAME COLUMN "on_hand_quantity" TO "quantity_on_hand";
ALTER TABLE "inventory"."inventory_items" RENAME COLUMN "reserved_quantity" TO "quantity_reserved";

-- These two plain (non-unique) indexes are on columns that survive the
-- rollback (product_sku_id, warehouse_id), so Postgres does not auto-drop
-- them the way it auto-drops an index when its sole/only-referenced column
-- is removed by DROP COLUMN below — they must be dropped explicitly.
DROP INDEX "inventory"."inventory_items_product_sku_id_warehouse_id_idx";
DROP INDEX "inventory"."inventory_items_warehouse_id_idx";

-- location_id's removal cascades to auto-drop both the 3-column unique
-- index (product_sku_id, warehouse_id, location_id) and the
-- inventory_items_location_id_fkey foreign key that reference it — same
-- Postgres behavior ADR-005's migration relied on and documented.
ALTER TABLE "inventory"."inventory_items"
  DROP COLUMN "available_quantity",
  DROP COLUMN "in_transit_quantity",
  DROP COLUMN "damaged_quantity",
  DROP COLUMN "quarantined_quantity",
  DROP COLUMN "blocked_quantity",
  DROP COLUMN "version",
  DROP COLUMN "location_id";

-- inventory_items_product_sku_id_idx (plain, single-column) was never
-- touched by up.sql — it survives untouched throughout, no need to
-- recreate it here.
CREATE UNIQUE INDEX "inventory_items_warehouse_id_product_sku_id_key" ON "inventory"."inventory_items"("warehouse_id", "product_sku_id");

-- =============================================================================
-- 8. warehouse_locations — no prior equivalent, drop outright now that
--    inventory_items no longer references it
-- =============================================================================
DROP TABLE "inventory"."warehouse_locations";

-- =============================================================================
-- 9. warehouses: restore is_active from status, drop Phase 006 columns
-- =============================================================================
ALTER TABLE "inventory"."warehouses" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "inventory"."warehouses" SET "is_active" = ("status" = 'ACTIVE');

ALTER TABLE "inventory"."warehouses"
  DROP COLUMN "type",
  DROP COLUMN "status",
  DROP COLUMN "timezone",
  DROP COLUMN "capacity";

DROP TYPE "inventory"."WarehouseType";
DROP TYPE "inventory"."WarehouseStatus";
DROP TYPE "inventory"."LocationType";
