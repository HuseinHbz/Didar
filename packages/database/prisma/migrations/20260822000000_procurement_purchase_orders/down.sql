-- Rollback for 20260822000000_procurement_purchase_orders.
-- Reverses each of the 3 schema sections in migration.sql, in reverse
-- order. Purely additive migration, so rollback is purely subtractive
-- — every new table starts empty on a freshly-applied migration, and
-- this migration touches no pre-existing table (unlike Phase 013's,
-- which added columns to inventory.inventory_ledger/
-- commerce.return_items — nothing here needs a column-level DROP on
-- an existing table).

-- 3. inventory.purchase_order_items (table drop cascades its own FK/
--    indexes/CHECK constraints)
DROP TABLE "inventory"."purchase_order_items";

-- 2. inventory.purchase_orders (table drop cascades its own FK/indexes)
DROP TABLE "inventory"."purchase_orders";
DROP TYPE "inventory"."PurchaseOrderStatus";

-- 1. inventory.suppliers
DROP TABLE "inventory"."suppliers";
DROP TYPE "inventory"."SupplierStatus";
