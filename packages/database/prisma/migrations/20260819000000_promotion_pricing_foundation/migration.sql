-- Phase 010 — enterprise promotion, discount, coupon & pricing rules
-- engine (docs/adr/ADR-010-promotion-engine.md).
--
-- Context at authoring time: `marketing.promotions`/`promotion_products`/
-- `coupon_redemptions` have ZERO rows in the live dev database; `coupons`
-- has exactly ONE row (the Phase 007 seed fixture `WELCOME10`, itself
-- being replaced by this phase's own seed coupons — see seed.ts). Every
-- other table this migration touches (`catalog.products`,
-- `inventory.warehouses`, `commerce.carts`, `commerce.checkout_sessions`,
-- `commerce.orders`, `commerce.payment_intents`/`payment_transactions`) is
-- untouched by this migration entirely — confirmed via row counts
-- immediately before writing this migration and again after every
-- up/down/up round trip (docs/adr/ADR-010, "Migration round trip").
--
-- 4 sections:
--   1. DROP the Phase 003 placeholder promotion subtree (`coupons`,
--      `coupon_redemptions`, `promotions`, `promotion_products`) and its
--      `CouponType` enum — nothing to preserve, confirmed above.
--   2. New marketing enums: PromotionStatus, PromotionActionType,
--      PromotionTargetType, PromotionRuleType, CouponStatus,
--      RedemptionStatus.
--   3. New marketing tables: promotions, promotion_rules,
--      promotion_targets, coupons, coupon_redemptions — plus the two
--      real Postgres CHECK constraints backstopping usage-limit
--      invariants at the database level (ADR-010 decision 8), not
--      expressible in schema.prisma's DSL (same reason no other model in
--      this schema declares a CHECK there either).
--   4. New commerce table: order_promotions — the immutable per-order
--      promotion snapshot (ADR-010 decision 7/11), FK'd to `orders`
--      only (same "unenforced cross-schema pointer" convention every
--      prior phase's cross-schema references already use for
--      `promotion_id`/`coupon_id`).

BEGIN;

-- 1. Drop the Phase 003 placeholder subtree (children first).
ALTER TABLE "marketing"."coupon_redemptions" DROP CONSTRAINT IF EXISTS "coupon_redemptions_coupon_id_fkey";
ALTER TABLE "marketing"."promotion_products" DROP CONSTRAINT IF EXISTS "promotion_products_promotion_id_fkey";

DROP TABLE IF EXISTS "marketing"."coupon_redemptions";
DROP TABLE IF EXISTS "marketing"."promotion_products";
DROP TABLE IF EXISTS "marketing"."promotions";
DROP TABLE IF EXISTS "marketing"."coupons";
DROP TYPE IF EXISTS "marketing"."CouponType";

-- 2. New enums.
CREATE TYPE "marketing"."PromotionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "marketing"."PromotionActionType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'FIXED_PRICE', 'FREE_SHIPPING', 'BUY_X_GET_Y', 'BUNDLE_PRICE');
CREATE TYPE "marketing"."PromotionTargetType" AS ENUM ('PRODUCT', 'SKU', 'CATEGORY', 'BRAND', 'COLLECTION');
CREATE TYPE "marketing"."PromotionRuleType" AS ENUM ('MINIMUM_QUANTITY', 'CUSTOMER_SEGMENT', 'FIRST_PURCHASE_ONLY');
CREATE TYPE "marketing"."CouponStatus" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'DISABLED');
CREATE TYPE "marketing"."RedemptionStatus" AS ENUM ('RESERVED', 'REDEEMED', 'RELEASED');

-- 3. New tables.
-- CreateTable
CREATE TABLE "marketing"."promotions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "marketing"."PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "minimum_cart_value" BIGINT,
    "maximum_discount" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "requires_coupon" BOOLEAN NOT NULL DEFAULT true,
    "discount_type" "marketing"."PromotionActionType" NOT NULL,
    "discount_value" BIGINT,
    "buy_quantity" INTEGER,
    "get_quantity" INTEGER,
    "get_discount_basis_points" INTEGER,
    "bundle_price" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promotion_usage_within_limit" CHECK ("usage_limit" IS NULL OR "usage_count" <= "usage_limit")
);

CREATE INDEX "promotions_status_idx" ON "marketing"."promotions"("status");
CREATE INDEX "promotions_starts_at_ends_at_idx" ON "marketing"."promotions"("starts_at", "ends_at");

-- CreateTable
CREATE TABLE "marketing"."promotion_rules" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "type" "marketing"."PromotionRuleType" NOT NULL,
    "config" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "promotion_rules_promotion_id_idx" ON "marketing"."promotion_rules"("promotion_id");

-- CreateTable
CREATE TABLE "marketing"."promotion_targets" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "type" "marketing"."PromotionTargetType" NOT NULL,
    "ref_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promotion_targets_promotion_id_type_ref_id_key" ON "marketing"."promotion_targets"("promotion_id", "type", "ref_id");
CREATE INDEX "promotion_targets_promotion_id_idx" ON "marketing"."promotion_targets"("promotion_id");
CREATE INDEX "promotion_targets_type_ref_id_idx" ON "marketing"."promotion_targets"("type", "ref_id");

-- CreateTable
CREATE TABLE "marketing"."coupons" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "marketing"."CouponStatus" NOT NULL DEFAULT 'ACTIVE',
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "usage_limit" INTEGER,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "per_customer_limit" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "coupon_usage_within_limit" CHECK ("usage_limit" IS NULL OR "usage_count" <= "usage_limit")
);

CREATE UNIQUE INDEX "coupons_code_key" ON "marketing"."coupons"("code");
CREATE INDEX "coupons_promotion_id_idx" ON "marketing"."coupons"("promotion_id");
CREATE INDEX "coupons_status_idx" ON "marketing"."coupons"("status");

-- CreateTable
CREATE TABLE "marketing"."coupon_redemptions" (
    "id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "coupon_id" UUID,
    "customer_id" UUID,
    "guest_token" TEXT,
    "checkout_session_id" UUID NOT NULL,
    "order_id" UUID,
    "status" "marketing"."RedemptionStatus" NOT NULL DEFAULT 'RESERVED',
    "discount_amount" BIGINT NOT NULL,
    "reserved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coupon_redemptions_checkout_session_id_promotion_id_key" ON "marketing"."coupon_redemptions"("checkout_session_id", "promotion_id");
CREATE INDEX "coupon_redemptions_promotion_id_idx" ON "marketing"."coupon_redemptions"("promotion_id");
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "marketing"."coupon_redemptions"("coupon_id");
CREATE INDEX "coupon_redemptions_customer_id_idx" ON "marketing"."coupon_redemptions"("customer_id");
CREATE INDEX "coupon_redemptions_order_id_idx" ON "marketing"."coupon_redemptions"("order_id");
CREATE INDEX "coupon_redemptions_status_idx" ON "marketing"."coupon_redemptions"("status");

-- AddForeignKey (intra-schema only, same convention every prior phase
-- follows — customer_id/guest_token/checkout_session_id/order_id stay
-- unenforced cross-schema pointers).
ALTER TABLE "marketing"."promotion_rules" ADD CONSTRAINT "promotion_rules_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing"."promotion_targets" ADD CONSTRAINT "promotion_targets_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing"."coupons" ADD CONSTRAINT "coupons_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "marketing"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing"."promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "marketing"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "marketing"."coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. New commerce table: the immutable per-order promotion snapshot.
-- CreateTable
CREATE TABLE "commerce"."order_promotions" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "promotion_name" TEXT NOT NULL,
    "coupon_id" UUID,
    "coupon_code" TEXT,
    "discount_type" TEXT NOT NULL,
    "discount_amount" BIGINT NOT NULL,
    "affected_item_ids" JSONB NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_promotions_order_id_idx" ON "commerce"."order_promotions"("order_id");
CREATE INDEX "order_promotions_promotion_id_idx" ON "commerce"."order_promotions"("promotion_id");
CREATE INDEX "order_promotions_coupon_id_idx" ON "commerce"."order_promotions"("coupon_id");

ALTER TABLE "commerce"."order_promotions" ADD CONSTRAINT "order_promotions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
