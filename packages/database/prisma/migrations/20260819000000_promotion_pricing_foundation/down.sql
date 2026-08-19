-- Down-migration for 20260819000000_promotion_pricing_foundation.
-- Drops every table/enum this migration added and restores the exact
-- Phase 003 placeholder shape for `marketing.coupons`/`promotions`/
-- `coupon_redemptions`/`promotion_products`. `promotions`/
-- `promotion_products`/`coupon_redemptions` had 0 rows both before and
-- after this migration in every round-trip test run (fresh seed/e2e state
-- each time); `coupons` had exactly 1 row before (the Phase 007
-- `WELCOME10` fixture, already superseded by this phase's own seed data)
-- — same "reproducible regardless of how many times it repeats"
-- precedent every prior phase's own down.sql documents.

BEGIN;

-- 1. Drop the commerce.order_promotions table this migration added.
ALTER TABLE "commerce"."order_promotions" DROP CONSTRAINT IF EXISTS "order_promotions_order_id_fkey";
DROP TABLE IF EXISTS "commerce"."order_promotions";

-- 2. Drop foreign keys + tables this migration added (children first).
ALTER TABLE "marketing"."coupon_redemptions" DROP CONSTRAINT IF EXISTS "coupon_redemptions_coupon_id_fkey";
ALTER TABLE "marketing"."coupon_redemptions" DROP CONSTRAINT IF EXISTS "coupon_redemptions_promotion_id_fkey";
ALTER TABLE "marketing"."coupons" DROP CONSTRAINT IF EXISTS "coupons_promotion_id_fkey";
ALTER TABLE "marketing"."promotion_targets" DROP CONSTRAINT IF EXISTS "promotion_targets_promotion_id_fkey";
ALTER TABLE "marketing"."promotion_rules" DROP CONSTRAINT IF EXISTS "promotion_rules_promotion_id_fkey";

DROP TABLE IF EXISTS "marketing"."coupon_redemptions";
DROP TABLE IF EXISTS "marketing"."coupons";
DROP TABLE IF EXISTS "marketing"."promotion_targets";
DROP TABLE IF EXISTS "marketing"."promotion_rules";
DROP TABLE IF EXISTS "marketing"."promotions";

DROP TYPE IF EXISTS "marketing"."RedemptionStatus";
DROP TYPE IF EXISTS "marketing"."CouponStatus";
DROP TYPE IF EXISTS "marketing"."PromotionRuleType";
DROP TYPE IF EXISTS "marketing"."PromotionTargetType";
DROP TYPE IF EXISTS "marketing"."PromotionActionType";
DROP TYPE IF EXISTS "marketing"."PromotionStatus";

-- 3. Restore the Phase 003 placeholder enum + tables, exact original
-- shape (see 20260811181736_init_enterprise_foundation/migration.sql).
CREATE TYPE "marketing"."CouponType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

CREATE TABLE "marketing"."coupons" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "marketing"."CouponType" NOT NULL,
    "value" BIGINT NOT NULL,
    "min_order_amount" BIGINT,
    "max_discount_amount" BIGINT,
    "usage_limit" INTEGER,
    "per_user_limit" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "coupons_code_key" ON "marketing"."coupons"("code");

CREATE TABLE "marketing"."coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "discount_amount" BIGINT NOT NULL,
    "redeemed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "coupon_redemptions_coupon_id_idx" ON "marketing"."coupon_redemptions"("coupon_id");
CREATE INDEX "coupon_redemptions_order_id_idx" ON "marketing"."coupon_redemptions"("order_id");
CREATE INDEX "coupon_redemptions_customer_id_idx" ON "marketing"."coupon_redemptions"("customer_id");
ALTER TABLE "marketing"."coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "marketing"."coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "marketing"."promotions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" "marketing"."CouponType" NOT NULL,
    "discount_value" BIGINT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "marketing"."promotion_products" (
    "promotion_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_products_pkey" PRIMARY KEY ("promotion_id","product_id")
);
ALTER TABLE "marketing"."promotion_products" ADD CONSTRAINT "promotion_products_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "marketing"."promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
