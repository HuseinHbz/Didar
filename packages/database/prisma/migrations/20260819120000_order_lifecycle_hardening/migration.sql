-- Phase 011 — order lifecycle, fulfillment & shipping hardening
-- (docs/adr/ADR-011-order-lifecycle-hardening.md). Purely additive: no
-- table drops, no data transforms, no destructive operations.
--
-- Context at authoring time: `commerce.orders` has 108 rows,
-- `commerce.fulfillments` 28, `commerce.shipments` 10 (real seed +
-- e2e-generated data in the live dev database, not an empty table).
-- `fulfillments.idempotency_key` is added nullable — every existing row
-- gets NULL, and Postgres allows any number of NULLs under a plain
-- UNIQUE index, so this is non-breaking for every existing row.
-- `shipments.tracking_number` was already nullable; before adding its
-- UNIQUE index we found and resolved one real pre-existing duplicate
-- (`'E2E-TRACK-1'`, three rows — leftover from a prior e2e run that
-- hardcoded the value instead of randomizing it; the test itself is
-- fixed in the same commit as this migration) by nulling the two
-- non-original rows. No other duplicate `tracking_number` value exists
-- (verified by a `GROUP BY ... HAVING count(*) > 1` query immediately
-- before writing this migration).
--
-- 2 sections:
--   1. `commerce.fulfillments` — add `idempotency_key` (nullable,
--      unique) so a retried fulfillment-creation request collapses to
--      the original row instead of creating a second, real duplicate
--      fulfillment (ADR-011 decision 2).
--   2. `commerce.orders` — three new indexes (`payment_status`,
--      `fulfillment_status`, `placed_at`), justified directly by the new
--      admin search/filter query patterns this phase adds (ADR-011
--      decision 6). `commerce.shipments` — `tracking_number` becomes
--      `UNIQUE` (ADR-011 decision 5).

BEGIN;

-- 1. Fulfillment creation idempotency key.
ALTER TABLE "commerce"."fulfillments" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "fulfillments_idempotency_key_key" ON "commerce"."fulfillments"("idempotency_key");

-- 2. Admin search/filter indexes + tracking-number uniqueness.
CREATE INDEX "orders_payment_status_idx" ON "commerce"."orders"("payment_status");
CREATE INDEX "orders_fulfillment_status_idx" ON "commerce"."orders"("fulfillment_status");
CREATE INDEX "orders_placed_at_idx" ON "commerce"."orders"("placed_at");
CREATE UNIQUE INDEX "shipments_tracking_number_key" ON "commerce"."shipments"("tracking_number");

COMMIT;
