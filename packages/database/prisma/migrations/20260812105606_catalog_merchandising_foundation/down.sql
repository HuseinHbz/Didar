-- Rollback for 20260812105606_catalog_merchandising_foundation.
--
-- Reverses every step of migration.sql, restoring the Phase 003 shape.
-- Where the forward migration derived new rows from old columns (SKUs from
-- variants, product_sku_id from product_variant_id), this rollback reverses
-- that join while product_skus still exists, so the restored data is exact,
-- not a placeholder — same standard as up.sql. Two mappings are genuinely
-- lossy and can't be un-lost (documented at each site below): collapsing
-- ProductLifecycleStatus's 6 values back to ProductStatus's 3, and
-- CatalogStatus's 2 values back to ProductStatus's 3 — both were already
-- lossy going forward (see migration.sql's header), so reversing them can
-- only approximate, never recover, the original DRAFT vs. ARCHIVED split.
-- Not run in CI; exercised manually (see docs/database/README.md's
-- "Rollback").

-- =============================================================================
-- 1. Recreate the old ProductStatus enum first — migration.sql's last step
--    dropped it, and both products.status and product_variants.status need
--    it restored below.
-- =============================================================================
CREATE TYPE "catalog"."ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- =============================================================================
-- 2. Products — restore old columns before dropping the new ones that feed
--    their backfill (gender comes from variants, sku comes from SKUs — both
--    still exist at this point).
-- =============================================================================
ALTER TABLE "catalog"."products" DROP CONSTRAINT "products_ar_model_media_id_fkey";

ALTER TABLE "catalog"."products" RENAME COLUMN "status" TO "status_new";
ALTER TABLE "catalog"."products" ADD COLUMN "status" "catalog"."ProductStatus";
-- Lossy: PUBLISHED/UNPUBLISHED both collapse to ACTIVE, IN_REVIEW/APPROVED
-- both collapse to DRAFT — ProductStatus never had that granularity.
UPDATE "catalog"."products" SET "status" = (CASE "status_new"::text
  WHEN 'PUBLISHED' THEN 'ACTIVE'
  WHEN 'UNPUBLISHED' THEN 'ACTIVE'
  WHEN 'DRAFT' THEN 'DRAFT'
  WHEN 'IN_REVIEW' THEN 'DRAFT'
  WHEN 'APPROVED' THEN 'DRAFT'
  WHEN 'ARCHIVED' THEN 'ARCHIVED'
END)::"catalog"."ProductStatus";
ALTER TABLE "catalog"."products"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';
-- Dropping "status_new" (the Phase 005 status column, which carried
-- migration.sql's own "products_status_idx") auto-drops that index along
-- with it — recreate the original Phase 003 index on the just-restored
-- old-typed "status" column.
ALTER TABLE "catalog"."products" DROP COLUMN "status_new";
CREATE INDEX "products_status_idx" ON "catalog"."products"("status");

ALTER TABLE "catalog"."products" ADD COLUMN "gender" "catalog"."ProductGender";
UPDATE "catalog"."products" p SET "gender" = v."gender"
  FROM "catalog"."product_variants" v
  WHERE v."product_id" = p."id" AND v."is_default" = true AND v."gender" IS NOT NULL;
UPDATE "catalog"."products" p SET "gender" = v."gender"
  FROM "catalog"."product_variants" v
  WHERE v."product_id" = p."id" AND p."gender" IS NULL AND v."gender" IS NOT NULL;

ALTER TABLE "catalog"."products" ADD COLUMN "description" TEXT;
UPDATE "catalog"."products" SET "description" = "long_description" WHERE "long_description" IS NOT NULL;

ALTER TABLE "catalog"."products" ADD COLUMN "sku" TEXT;
UPDATE "catalog"."products" p SET "sku" = ps."sku_code"
  FROM "catalog"."product_skus" ps
  JOIN "catalog"."product_variants" v ON v."id" = ps."variant_id"
  WHERE v."product_id" = p."id" AND v."is_default" = true;
UPDATE "catalog"."products" p SET "sku" = ps."sku_code"
  FROM "catalog"."product_skus" ps
  JOIN "catalog"."product_variants" v ON v."id" = ps."variant_id"
  WHERE v."product_id" = p."id" AND p."sku" IS NULL;
-- Fallback only for a product with zero SKUs yet (a draft with variants but
-- no SKU assigned — legal in Phase 005, impossible to represent in the old
-- required-and-unique products.sku column).
UPDATE "catalog"."products" SET "sku" = 'LEGACY-' || substr("id"::text, 1, 8) WHERE "sku" IS NULL;
ALTER TABLE "catalog"."products" ALTER COLUMN "sku" SET NOT NULL;
CREATE UNIQUE INDEX "products_sku_key" ON "catalog"."products"("sku");

ALTER TABLE "catalog"."products"
  DROP COLUMN "product_type",
  DROP COLUMN "localized_name",
  DROP COLUMN "short_description",
  DROP COLUMN "long_description",
  DROP COLUMN "specifications",
  DROP COLUMN "tags",
  DROP COLUMN "reviewed_by",
  DROP COLUMN "approved_by",
  DROP COLUMN "approved_at",
  DROP COLUMN "published_at",
  DROP COLUMN "unpublished_at",
  DROP COLUMN "archived_at",
  DROP COLUMN "ar_model_media_id",
  DROP COLUMN "face_try_on_metadata",
  DROP COLUMN "seo";

-- =============================================================================
-- 3. Product variants — restore sku/barcode/weight_grams from product_skus
--    (exact — the join source still exists) and the old status.
-- =============================================================================
ALTER TABLE "catalog"."product_variants"
  ADD COLUMN "sku" TEXT,
  ADD COLUMN "barcode" TEXT,
  ADD COLUMN "weight_grams" INTEGER;

UPDATE "catalog"."product_variants" v
  SET "sku" = ps."sku_code", "barcode" = ps."barcode", "weight_grams" = ps."weight_grams"
  FROM "catalog"."product_skus" ps
  WHERE ps."variant_id" = v."id";
-- Fallback only for a variant with no SKU yet (legal pre-commerce draft
-- state in Phase 005 — see ADR-005 decision 1 — impossible under the old
-- required-and-unique product_variants.sku column).
UPDATE "catalog"."product_variants" SET "sku" = 'LEGACY-' || substr("id"::text, 1, 8) WHERE "sku" IS NULL;
ALTER TABLE "catalog"."product_variants" ALTER COLUMN "sku" SET NOT NULL;
CREATE UNIQUE INDEX "product_variants_sku_key" ON "catalog"."product_variants"("sku");
CREATE UNIQUE INDEX "product_variants_barcode_key" ON "catalog"."product_variants"("barcode");

ALTER TABLE "catalog"."product_variants" RENAME COLUMN "status" TO "status_new";
ALTER TABLE "catalog"."product_variants" ADD COLUMN "status" "catalog"."ProductStatus";
-- Lossy: CatalogStatus's INACTIVE collapses what used to be two distinct
-- states (DRAFT and ARCHIVED) — reversed to DRAFT, the more common case for
-- a variant that was never fully active.
UPDATE "catalog"."product_variants" SET "status" = (CASE "status_new"::text
  WHEN 'ACTIVE' THEN 'ACTIVE'
  ELSE 'DRAFT'
END)::"catalog"."ProductStatus";
ALTER TABLE "catalog"."product_variants"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "catalog"."product_variants" DROP COLUMN "status_new";

ALTER TABLE "catalog"."product_variants"
  DROP COLUMN "label",
  DROP COLUMN "color_hex",
  DROP COLUMN "frame_shape",
  DROP COLUMN "frame_material",
  DROP COLUMN "frame_width_mm",
  DROP COLUMN "bridge_width_mm",
  DROP COLUMN "temple_length_mm",
  DROP COLUMN "lens_width_mm",
  DROP COLUMN "fit",
  DROP COLUMN "gender",
  DROP COLUMN "style",
  DROP COLUMN "lens_compatibility",
  DROP COLUMN "sort_order";

-- =============================================================================
-- 4. Inventory / commerce / finance — repoint "product_sku_id" back to
--    "product_variant_id" while product_skus (the join source) still
--    exists.
-- =============================================================================
ALTER TABLE "inventory"."inventory_items" ADD COLUMN "product_variant_id" UUID;
UPDATE "inventory"."inventory_items" ii
  SET "product_variant_id" = ps."variant_id"
  FROM "catalog"."product_skus" ps
  WHERE ps."id" = ii."product_sku_id";
ALTER TABLE "inventory"."inventory_items" ALTER COLUMN "product_variant_id" SET NOT NULL;
ALTER TABLE "inventory"."inventory_items" DROP COLUMN "product_sku_id";
CREATE INDEX "inventory_items_product_variant_id_idx" ON "inventory"."inventory_items"("product_variant_id");
CREATE UNIQUE INDEX "inventory_items_warehouse_id_product_variant_id_key" ON "inventory"."inventory_items"("warehouse_id", "product_variant_id");

ALTER TABLE "commerce"."cart_items" ADD COLUMN "product_variant_id" UUID;
UPDATE "commerce"."cart_items" ci
  SET "product_variant_id" = ps."variant_id"
  FROM "catalog"."product_skus" ps
  WHERE ps."id" = ci."product_sku_id";
ALTER TABLE "commerce"."cart_items" ALTER COLUMN "product_variant_id" SET NOT NULL;
ALTER TABLE "commerce"."cart_items" DROP COLUMN "product_sku_id";
CREATE UNIQUE INDEX "cart_items_cart_id_product_variant_id_key" ON "commerce"."cart_items"("cart_id", "product_variant_id");

ALTER TABLE "commerce"."order_items" ADD COLUMN "product_variant_id" UUID;
UPDATE "commerce"."order_items" oi
  SET "product_variant_id" = ps."variant_id"
  FROM "catalog"."product_skus" ps
  WHERE ps."id" = oi."product_sku_id";
ALTER TABLE "commerce"."order_items" DROP COLUMN "product_sku_id";

ALTER TABLE "finance"."product_prices" ADD COLUMN "product_variant_id" UUID;
UPDATE "finance"."product_prices" pp
  SET "product_variant_id" = ps."variant_id"
  FROM "catalog"."product_skus" ps
  WHERE ps."id" = pp."product_sku_id";
ALTER TABLE "finance"."product_prices" ALTER COLUMN "product_variant_id" SET NOT NULL;
ALTER TABLE "finance"."product_prices" DROP COLUMN "product_sku_id";
ALTER TABLE "finance"."product_prices" DROP COLUMN "compare_at_price";
ALTER TABLE "finance"."product_prices" DROP COLUMN "valid_from";
ALTER TABLE "finance"."product_prices" DROP COLUMN "valid_to";
CREATE UNIQUE INDEX "product_prices_product_variant_id_key" ON "finance"."product_prices"("product_variant_id");

ALTER TABLE "finance"."price_history" ADD COLUMN "product_variant_id" UUID;
UPDATE "finance"."price_history" ph
  SET "product_variant_id" = ps."variant_id"
  FROM "catalog"."product_skus" ps
  WHERE ps."id" = ph."product_sku_id";
ALTER TABLE "finance"."price_history" ALTER COLUMN "product_variant_id" SET NOT NULL;
ALTER TABLE "finance"."price_history" DROP COLUMN "product_sku_id";
CREATE INDEX "price_history_product_variant_id_idx" ON "finance"."price_history"("product_variant_id");

-- =============================================================================
-- 5. Drop everything that only existed for Phase 005 — now safe, every
--    table above has been restored to reading from product_variants again.
-- =============================================================================
DROP TABLE "catalog"."product_skus";
DROP TABLE "catalog"."product_media";
DROP TABLE "catalog"."collection_products";
DROP TABLE "catalog"."collections";
-- "catalog"."media" itself is dropped at the end of section 6, below —
-- brands.logo_media_id and categories.image_media_id still reference it
-- until those FKs are dropped there first.

-- product_images had zero rows when migration.sql dropped it (see that
-- file's header) — recreated empty, same structure as Phase 003.
CREATE TABLE "catalog"."product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "url" TEXT NOT NULL,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_images_product_id_idx" ON "catalog"."product_images"("product_id");
ALTER TABLE "catalog"."product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 6. Categories / brands — restore old columns, drop Phase 005 ones.
-- =============================================================================
ALTER TABLE "catalog"."categories" DROP CONSTRAINT "categories_image_media_id_fkey";
ALTER TABLE "catalog"."categories" ADD COLUMN "is_active" BOOLEAN;
UPDATE "catalog"."categories" SET "is_active" = ("status" = 'ACTIVE');
ALTER TABLE "catalog"."categories"
  ALTER COLUMN "is_active" SET NOT NULL,
  ALTER COLUMN "is_active" SET DEFAULT true;
ALTER TABLE "catalog"."categories" ADD COLUMN "image_url" TEXT;
ALTER TABLE "catalog"."categories"
  DROP COLUMN "localized_name",
  DROP COLUMN "description",
  DROP COLUMN "image_media_id",
  DROP COLUMN "status",
  DROP COLUMN "published_at",
  DROP COLUMN "seo";

ALTER TABLE "catalog"."brands" DROP CONSTRAINT "brands_logo_media_id_fkey";
ALTER TABLE "catalog"."brands" ADD COLUMN "logo_url" TEXT;
ALTER TABLE "catalog"."brands"
  DROP COLUMN "localized_name",
  DROP COLUMN "description",
  DROP COLUMN "logo_media_id",
  DROP COLUMN "status",
  DROP COLUMN "sort_order",
  DROP COLUMN "seo";

-- Both FKs into it are gone now (products' was dropped in section 2).
DROP TABLE "catalog"."media";

-- =============================================================================
-- 7. Attribute/lookup tables — drop localization/filter additions.
-- =============================================================================
ALTER TABLE "catalog"."product_attributes" DROP COLUMN "localized_name", DROP COLUMN "is_filterable";
ALTER TABLE "catalog"."product_attribute_values" DROP COLUMN "localized_value";
ALTER TABLE "catalog"."lens_types" DROP COLUMN "localized_name";
ALTER TABLE "catalog"."lens_coatings" DROP COLUMN "localized_name";

-- =============================================================================
-- 8. Drop every Phase 005 enum now that nothing references them (Product
--    Status was already recreated in section 1, above).
-- =============================================================================
DROP TYPE "catalog"."MediaStatus";
DROP TYPE "catalog"."MediaRole";
DROP TYPE "catalog"."MediaKind";
DROP TYPE "catalog"."MediaProvider";
DROP TYPE "catalog"."CollectionType";
DROP TYPE "catalog"."SkuStatus";
DROP TYPE "catalog"."CatalogStatus";
DROP TYPE "catalog"."ProductLifecycleStatus";
DROP TYPE "catalog"."ProductType";
