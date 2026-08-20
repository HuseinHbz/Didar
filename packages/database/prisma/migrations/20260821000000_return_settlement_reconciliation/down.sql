-- Rollback for 20260821000000_return_settlement_reconciliation.
-- Reverses each of the 4 schema sections in migration.sql, in reverse
-- order. Purely additive migration, so rollback is purely subtractive —
-- no separate reversal needed for section 5's restocked_at backfill:
-- dropping the column (section 2's rollback, below) removes that data
-- along with it. Every new column is nullable and every new table
-- starts empty on a freshly-applied migration.

-- 4. finance.credit_notes.return_request_id UNIQUE
DROP INDEX "finance"."credit_notes_return_request_id_key";

-- 3. inventory.inventory_ledger.idempotency_key
ALTER TABLE "inventory"."inventory_ledger" DROP COLUMN "idempotency_key";

-- 2. commerce.return_items.restocked_at
ALTER TABLE "commerce"."return_items" DROP COLUMN "restocked_at";

-- 1. commerce.return_settlements (table drop cascades its own FK/indexes)
DROP TABLE "commerce"."return_settlements";
DROP TYPE "commerce"."ReturnSettlementStatus";
