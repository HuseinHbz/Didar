-- Phase 007 — cart, checkout, pricing resolution & inventory reservation
-- integration (docs/adr/ADR-007-cart-checkout.md).
--
-- Context at authoring time: `commerce.carts`/`commerce.cart_items` (the
-- Phase 003 placeholder shape) have ZERO rows in the live dev database —
-- confirmed via `select count(*) from commerce.carts` / `cart_items`
-- immediately before writing this migration. This is *not* a data-
-- preserving migration in the way Phase 005/006's were (there was
-- literally nothing to carry forward); `carts.session_token` is renamed
-- to `guest_token` via `ALTER TABLE ... RENAME COLUMN` anyway (same
-- concept, ADR-007 decision 10), not dropped+recreated, since a rename is
-- the more honest description of what changed regardless of row count.
--
-- 10 sections:
--   1. CartStatus enum: add CHECKOUT_STARTED, EXPIRED (2 new values)
--   2. carts: rename session_token -> guest_token, add expires_at
--   3. cart_items: add configuration_snapshot/configuration_hash/currency,
--      swap the old (cart_id, product_sku_id) unique for
--      (cart_id, product_sku_id, configuration_hash)
--   4. cart_item_options (new)
--   5. cart_price_snapshots (new)
--   6. cart_coupons (new)
--   7. shipping_methods + ShippingMethodType enum (new)
--   8. cart_shipping_selections (new)
--   9. checkout_sessions + CheckoutStatus enum (new)
--   10. checkout_addresses, checkout_totals, checkout_validations
--       (+ CheckoutValidationOutcome enum), checkout_reservations (new)
--
-- Postgres forbids using a newly-added enum value in the same transaction
-- that added it (even in PG12+, where ADD VALUE itself is transactional) —
-- section 1 only adds the two CartStatus values; nothing in this same
-- migration ever writes a row using them, so this is safe as one
-- transaction (`prisma migrate deploy` wraps the whole file in one BEGIN/
-- COMMIT).

-- =============================================================================
-- 1. CartStatus: add CHECKOUT_STARTED, EXPIRED
--
-- Guarded (IF NOT EXISTS-equivalent via pg_enum lookup) because
-- `ALTER TYPE ... DROP VALUE` does not exist in Postgres — down.sql cannot
-- remove these two values, so a down-then-up round trip must re-run this
-- section against a database that may already have them. Postgres allows
-- `ALTER TYPE ... ADD VALUE` inside a DO block as long as the new value
-- isn't *used* in the same transaction (verified directly against this
-- Postgres 16 instance).
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'commerce' AND t.typname = 'CartStatus' AND e.enumlabel = 'CHECKOUT_STARTED'
  ) THEN
    ALTER TYPE "commerce"."CartStatus" ADD VALUE 'CHECKOUT_STARTED';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'commerce' AND t.typname = 'CartStatus' AND e.enumlabel = 'EXPIRED'
  ) THEN
    ALTER TYPE "commerce"."CartStatus" ADD VALUE 'EXPIRED';
  END IF;
END $$;

-- =============================================================================
-- 2. carts: session_token -> guest_token (rename, not drop+add — 0 rows to
--    lose either way, but this is what actually happened conceptually),
--    + expires_at
-- =============================================================================
ALTER TABLE "commerce"."carts" RENAME COLUMN "session_token" TO "guest_token";
ALTER TABLE "commerce"."carts" ADD COLUMN "expires_at" TIMESTAMP(3);

DROP INDEX "commerce"."carts_session_token_key";
CREATE UNIQUE INDEX "carts_guest_token_key" ON "commerce"."carts"("guest_token");
CREATE INDEX "carts_guest_token_idx" ON "commerce"."carts"("guest_token");
CREATE INDEX "carts_status_idx" ON "commerce"."carts"("status");
CREATE INDEX "carts_expires_at_idx" ON "commerce"."carts"("expires_at");

-- =============================================================================
-- 3. cart_items: configuration fields + re-scoped uniqueness
-- =============================================================================
ALTER TABLE "commerce"."cart_items"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'IRR',
  ADD COLUMN "configuration_snapshot" JSONB,
  ADD COLUMN "configuration_hash" TEXT NOT NULL DEFAULT '';

DROP INDEX "commerce"."cart_items_cart_id_product_sku_id_key";
CREATE UNIQUE INDEX "cart_items_cart_id_product_sku_id_configuration_hash_key"
  ON "commerce"."cart_items"("cart_id", "product_sku_id", "configuration_hash");
CREATE INDEX "cart_items_cart_id_idx" ON "commerce"."cart_items"("cart_id");
CREATE INDEX "cart_items_product_sku_id_idx" ON "commerce"."cart_items"("product_sku_id");

-- =============================================================================
-- 4. cart_item_options
-- =============================================================================
CREATE TABLE "commerce"."cart_item_options" (
    "id" UUID NOT NULL,
    "cart_item_id" UUID NOT NULL,
    "option_type" TEXT NOT NULL,
    "option_key" TEXT NOT NULL,
    "option_label" TEXT,
    "price_adjustment" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_item_options_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cart_item_options_cart_item_id_idx" ON "commerce"."cart_item_options"("cart_item_id");
ALTER TABLE "commerce"."cart_item_options"
  ADD CONSTRAINT "cart_item_options_cart_item_id_fkey"
  FOREIGN KEY ("cart_item_id") REFERENCES "commerce"."cart_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 5. cart_price_snapshots (append-only)
-- =============================================================================
CREATE TABLE "commerce"."cart_price_snapshots" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "discount_total" BIGINT NOT NULL,
    "tax_total" BIGINT NOT NULL,
    "shipping_total" BIGINT NOT NULL,
    "grand_total" BIGINT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_price_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "cart_price_snapshots_cart_id_idx" ON "commerce"."cart_price_snapshots"("cart_id");
CREATE INDEX "cart_price_snapshots_calculated_at_idx" ON "commerce"."cart_price_snapshots"("calculated_at");
ALTER TABLE "commerce"."cart_price_snapshots"
  ADD CONSTRAINT "cart_price_snapshots_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 6. cart_coupons (unenforced pointer to marketing.coupons.id)
-- =============================================================================
CREATE TABLE "commerce"."cart_coupons" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "resolved_discount" BIGINT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cart_coupons_cart_id_key" ON "commerce"."cart_coupons"("cart_id");
CREATE INDEX "cart_coupons_cart_id_idx" ON "commerce"."cart_coupons"("cart_id");
ALTER TABLE "commerce"."cart_coupons"
  ADD CONSTRAINT "cart_coupons_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 7. shipping_methods (database-driven, never hardcoded — ADR-007 decision 7)
-- =============================================================================
CREATE TYPE "commerce"."ShippingMethodType" AS ENUM ('HOME_DELIVERY', 'STORE_PICKUP');

CREATE TABLE "commerce"."shipping_methods" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "commerce"."ShippingMethodType" NOT NULL,
    "base_cost" BIGINT NOT NULL,
    "free_above_amount" BIGINT,
    "warehouse_id" UUID,
    "zone_match" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_methods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shipping_methods_code_key" ON "commerce"."shipping_methods"("code");
CREATE INDEX "shipping_methods_is_active_idx" ON "commerce"."shipping_methods"("is_active");

-- =============================================================================
-- 8. cart_shipping_selections
-- =============================================================================
CREATE TABLE "commerce"."cart_shipping_selections" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "shipping_method_id" UUID NOT NULL,
    "estimated_cost" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_shipping_selections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cart_shipping_selections_cart_id_key" ON "commerce"."cart_shipping_selections"("cart_id");
ALTER TABLE "commerce"."cart_shipping_selections"
  ADD CONSTRAINT "cart_shipping_selections_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commerce"."cart_shipping_selections"
  ADD CONSTRAINT "cart_shipping_selections_shipping_method_id_fkey"
  FOREIGN KEY ("shipping_method_id") REFERENCES "commerce"."shipping_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 9. checkout_sessions (the payment-ready artifact — ADR-007 decision 1)
-- =============================================================================
CREATE TYPE "commerce"."CheckoutStatus" AS ENUM ('OPEN', 'VALIDATING', 'READY_FOR_PAYMENT', 'EXPIRED', 'CANCELLED', 'CONVERTED');

CREATE TABLE "commerce"."checkout_sessions" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "customer_id" UUID,
    "guest_token" TEXT,
    "status" "commerce"."CheckoutStatus" NOT NULL DEFAULT 'OPEN',
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "subtotal" BIGINT NOT NULL DEFAULT 0,
    "discount_total" BIGINT NOT NULL DEFAULT 0,
    "tax_total" BIGINT NOT NULL DEFAULT 0,
    "shipping_total" BIGINT NOT NULL DEFAULT 0,
    "grand_total" BIGINT NOT NULL DEFAULT 0,
    "pricing_snapshot" JSONB,
    "shipping_snapshot" JSONB,
    "address_snapshot" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "checkout_sessions_idempotency_key_key" ON "commerce"."checkout_sessions"("idempotency_key");
CREATE INDEX "checkout_sessions_cart_id_idx" ON "commerce"."checkout_sessions"("cart_id");
CREATE INDEX "checkout_sessions_customer_id_idx" ON "commerce"."checkout_sessions"("customer_id");
CREATE INDEX "checkout_sessions_status_idx" ON "commerce"."checkout_sessions"("status");
CREATE INDEX "checkout_sessions_expires_at_idx" ON "commerce"."checkout_sessions"("expires_at");
ALTER TABLE "commerce"."checkout_sessions"
  ADD CONSTRAINT "checkout_sessions_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "commerce"."carts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 10. checkout_addresses, checkout_totals, checkout_validations,
--     checkout_reservations
-- =============================================================================
CREATE TABLE "commerce"."checkout_addresses" (
    "id" UUID NOT NULL,
    "checkout_session_id" UUID NOT NULL,
    "customer_address_id" UUID,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT,
    "postal_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_addresses_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "checkout_addresses_checkout_session_id_key" ON "commerce"."checkout_addresses"("checkout_session_id");
ALTER TABLE "commerce"."checkout_addresses"
  ADD CONSTRAINT "checkout_addresses_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "commerce"."checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "commerce"."checkout_totals" (
    "id" UUID NOT NULL,
    "checkout_session_id" UUID NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotal" BIGINT NOT NULL,
    "discount_total" BIGINT NOT NULL,
    "tax_total" BIGINT NOT NULL,
    "shipping_total" BIGINT NOT NULL,
    "grand_total" BIGINT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_totals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checkout_totals_checkout_session_id_idx" ON "commerce"."checkout_totals"("checkout_session_id");
ALTER TABLE "commerce"."checkout_totals"
  ADD CONSTRAINT "checkout_totals_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "commerce"."checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "commerce"."CheckoutValidationOutcome" AS ENUM ('PASSED', 'FAILED');

CREATE TABLE "commerce"."checkout_validations" (
    "id" UUID NOT NULL,
    "checkout_session_id" UUID NOT NULL,
    "outcome" "commerce"."CheckoutValidationOutcome" NOT NULL,
    "issues" JSONB NOT NULL,
    "validated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_validations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checkout_validations_checkout_session_id_idx" ON "commerce"."checkout_validations"("checkout_session_id");
ALTER TABLE "commerce"."checkout_validations"
  ADD CONSTRAINT "checkout_validations_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "commerce"."checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "commerce"."checkout_reservations" (
    "id" UUID NOT NULL,
    "checkout_session_id" UUID NOT NULL,
    "product_sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "inventory_reservation_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_reservations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "checkout_reservations_checkout_session_id_idx" ON "commerce"."checkout_reservations"("checkout_session_id");
CREATE INDEX "checkout_reservations_inventory_reservation_id_idx" ON "commerce"."checkout_reservations"("inventory_reservation_id");
CREATE UNIQUE INDEX "checkout_reservations_checkout_session_id_product_sku_id_key" ON "commerce"."checkout_reservations"("checkout_session_id", "product_sku_id");
ALTER TABLE "commerce"."checkout_reservations"
  ADD CONSTRAINT "checkout_reservations_checkout_session_id_fkey"
  FOREIGN KEY ("checkout_session_id") REFERENCES "commerce"."checkout_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
