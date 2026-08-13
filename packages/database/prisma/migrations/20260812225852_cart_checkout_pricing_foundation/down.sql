-- Rollback for 20260812225852_cart_checkout_pricing_foundation.
--
-- Reverses all 10 sections in reverse order. Lossy in exactly the way any
-- "drop the new tables" rollback is: every CartPriceSnapshot/CheckoutTotals/
-- CheckoutValidationResult/CheckoutReservation/CartCoupon/
-- CartShippingSelection/ShippingMethod/CheckoutSession/CheckoutAddress/
-- CartItemOption row is gone after this runs — there is no lossless way to
-- roll back "the tables that record this phase's own history" other than
-- dropping them. cart_items' new columns are dropped (configuration
-- data lost); carts.guest_token is renamed back to session_token (lossless
-- — same 0-row situation as the up migration, and a rename either
-- direction carries whatever data exists).
--
-- CartStatus's two new enum values (CHECKOUT_STARTED, EXPIRED) are NOT
-- removed — Postgres has no `ALTER TYPE ... DROP VALUE`. Any cart already
-- sitting in one of those two states would need a manual UPDATE before a
-- down migration could safely proceed in a database where they're in use;
-- there are none in this dev database at authoring time (confirmed via
-- `select count(*) from commerce.carts where status in
-- ('CHECKOUT_STARTED','EXPIRED')` before running this down.sql).

-- =============================================================================
-- 10 (reverse). checkout_reservations, checkout_validations,
--     checkout_totals, checkout_addresses
-- =============================================================================
DROP TABLE "commerce"."checkout_reservations";
DROP TABLE "commerce"."checkout_validations";
DROP TYPE "commerce"."CheckoutValidationOutcome";
DROP TABLE "commerce"."checkout_totals";
DROP TABLE "commerce"."checkout_addresses";

-- =============================================================================
-- 9 (reverse). checkout_sessions
-- =============================================================================
DROP TABLE "commerce"."checkout_sessions";
DROP TYPE "commerce"."CheckoutStatus";

-- =============================================================================
-- 8 (reverse). cart_shipping_selections
-- =============================================================================
DROP TABLE "commerce"."cart_shipping_selections";

-- =============================================================================
-- 7 (reverse). shipping_methods
-- =============================================================================
DROP TABLE "commerce"."shipping_methods";
DROP TYPE "commerce"."ShippingMethodType";

-- =============================================================================
-- 6 (reverse). cart_coupons
-- =============================================================================
DROP TABLE "commerce"."cart_coupons";

-- =============================================================================
-- 5 (reverse). cart_price_snapshots
-- =============================================================================
DROP TABLE "commerce"."cart_price_snapshots";

-- =============================================================================
-- 4 (reverse). cart_item_options
-- =============================================================================
DROP TABLE "commerce"."cart_item_options";

-- =============================================================================
-- 3 (reverse). cart_items: drop the config columns, restore the old
--    (cart_id, product_sku_id) unique index
-- =============================================================================
DROP INDEX "commerce"."cart_items_cart_id_idx";
DROP INDEX "commerce"."cart_items_product_sku_id_idx";
DROP INDEX "commerce"."cart_items_cart_id_product_sku_id_configuration_hash_key";
CREATE UNIQUE INDEX "cart_items_cart_id_product_sku_id_key" ON "commerce"."cart_items"("cart_id", "product_sku_id");

ALTER TABLE "commerce"."cart_items"
  DROP COLUMN "configuration_hash",
  DROP COLUMN "configuration_snapshot",
  DROP COLUMN "currency";

-- =============================================================================
-- 2 (reverse). carts: guest_token -> session_token, drop expires_at
-- =============================================================================
DROP INDEX "commerce"."carts_guest_token_idx";
DROP INDEX "commerce"."carts_guest_token_key";
DROP INDEX "commerce"."carts_status_idx";
DROP INDEX "commerce"."carts_expires_at_idx";

ALTER TABLE "commerce"."carts" DROP COLUMN "expires_at";
ALTER TABLE "commerce"."carts" RENAME COLUMN "guest_token" TO "session_token";
CREATE UNIQUE INDEX "carts_session_token_key" ON "commerce"."carts"("session_token");

-- =============================================================================
-- 1 (reverse). CartStatus — cannot DROP VALUE; documented above as a known
--    limitation, not silently ignored.
-- =============================================================================
