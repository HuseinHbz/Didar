-- Phase 005: catalog & merchandising foundation.
-- See docs/adr/ADR-005-catalog-architecture.md for the design rationale
-- (variant vs SKU split — decision 1; pricing/media/SEO/AR abstractions —
-- decisions 2-3; dynamic collections — decision 4).
--
-- This migration hand-migrates the existing (seed-fixture) data instead of
-- dropping it:
--   - product_variants.{sku,barcode,weight_grams} seed new catalog.
--     product_skus rows (one SKU per existing variant) before those columns
--     are dropped from product_variants;
--   - inventory_items/cart_items/order_items/product_prices/price_history,
--     all previously keyed by "product_variant_id", are repointed to the
--     new "product_sku_id" by joining through product_skus.variant_id —
--     still a plain, unenforced cross-schema column per docs/database/
--     README.md's "Cross-schema references are intentionally unenforced";
--   - products.gender moves to product_variants.gender (ADR-005 decision 1),
--     backfilled via a join before the old products.gender column is
--     dropped;
--   - products.status (old 3-value ProductStatus: DRAFT/ACTIVE/ARCHIVED)
--     maps onto the new 6-value ProductLifecycleStatus as
--     DRAFT->DRAFT, ACTIVE->PUBLISHED, ARCHIVED->ARCHIVED;
--     product_variants.status maps onto the new 2-value CatalogStatus as
--     ACTIVE->ACTIVE, DRAFT/ARCHIVED->INACTIVE (a variant that wasn't fully
--     active becomes simply inactive under the coarser vocabulary);
--   - categories.is_active becomes categories.status, and
--     categories.published_at is backfilled to updated_at for rows that
--     were active (there was no separate "published" concept before this
--     phase, so "already active" is the closest honest prior signal);
--   - brands.logo_url / categories.image_url had no data in every
--     environment this migration was developed and run against (verified
--     directly against the dev fixture before writing this file) — dropped
--     outright rather than migrated into a Media row; product_images had
--     zero rows for the same reason, dropped outright in favor of the new
--     media/product_media tables.
-- Product.productType is a wholly new required field with no prior column
-- to backfill from — existing rows get a placeholder ('EYEGLASSES').
-- packages/database/prisma/seed.ts is upsert-based on a stable key (slug),
-- so re-running it after this migration reconciles the seed fixture to its
-- real value — the same idempotent-seed convention Phase 003/004 used for
-- their own backfills.

-- =============================================================================
-- 1. New enums
-- =============================================================================
CREATE TYPE "catalog"."ProductType" AS ENUM ('EYEGLASSES', 'SUNGLASSES', 'COMPUTER_GLASSES', 'READING_GLASSES', 'CONTACT_LENSES', 'OPTICAL_FRAME', 'LENS', 'ACCESSORY');
CREATE TYPE "catalog"."ProductLifecycleStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');
CREATE TYPE "catalog"."CatalogStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "catalog"."SkuStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DISCONTINUED');
CREATE TYPE "catalog"."CollectionType" AS ENUM ('MANUAL', 'DYNAMIC');
CREATE TYPE "catalog"."MediaProvider" AS ENUM ('LOCAL', 'S3', 'CDN');
CREATE TYPE "catalog"."MediaKind" AS ENUM ('IMAGE', 'VIDEO', 'MODEL_3D', 'AR_ASSET');
CREATE TYPE "catalog"."MediaRole" AS ENUM ('PRIMARY', 'GALLERY', 'THUMBNAIL', 'SWATCH', 'VIDEO', 'MODEL_3D');
CREATE TYPE "catalog"."MediaStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- =============================================================================
-- 2. Media (created early — brand/category/collection/product FKs need it)
-- =============================================================================
CREATE TABLE "catalog"."media" (
    "id" UUID NOT NULL,
    "provider" "catalog"."MediaProvider" NOT NULL DEFAULT 'LOCAL',
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" "catalog"."MediaKind" NOT NULL,
    "mime_type" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "checksum" TEXT,
    "alt_text" JSONB,
    "status" "catalog"."MediaStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "media_storage_key_key" ON "catalog"."media"("storage_key");
CREATE INDEX "media_kind_idx" ON "catalog"."media"("kind");
CREATE INDEX "media_status_idx" ON "catalog"."media"("status");

-- =============================================================================
-- 3. Brands
-- =============================================================================
ALTER TABLE "catalog"."brands"
  ADD COLUMN "localized_name" JSONB,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "logo_media_id" UUID,
  ADD COLUMN "status" "catalog"."CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "seo" JSONB;

ALTER TABLE "catalog"."brands" DROP COLUMN "logo_url";

CREATE INDEX "brands_status_idx" ON "catalog"."brands"("status");
ALTER TABLE "catalog"."brands" ADD CONSTRAINT "brands_logo_media_id_fkey" FOREIGN KEY ("logo_media_id") REFERENCES "catalog"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- 4. Categories
-- =============================================================================
ALTER TABLE "catalog"."categories"
  ADD COLUMN "localized_name" JSONB,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "image_media_id" UUID,
  ADD COLUMN "status" "catalog"."CatalogStatus",
  ADD COLUMN "published_at" TIMESTAMP(3),
  ADD COLUMN "seo" JSONB;

UPDATE "catalog"."categories" SET
  "status" = (CASE WHEN "is_active" THEN 'ACTIVE' ELSE 'INACTIVE' END)::"catalog"."CatalogStatus",
  "published_at" = CASE WHEN "is_active" THEN "updated_at" ELSE NULL END;

ALTER TABLE "catalog"."categories"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

ALTER TABLE "catalog"."categories" DROP COLUMN "is_active";
ALTER TABLE "catalog"."categories" DROP COLUMN "image_url";

CREATE INDEX "categories_status_idx" ON "catalog"."categories"("status");
ALTER TABLE "catalog"."categories" ADD CONSTRAINT "categories_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "catalog"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- 5. Products — add new columns, migrate status. gender/sku/description stay
--    around until product_variants/product_skus below have been backfilled
--    from them.
-- =============================================================================
ALTER TABLE "catalog"."products"
  ADD COLUMN "product_type" "catalog"."ProductType",
  ADD COLUMN "localized_name" JSONB,
  ADD COLUMN "short_description" TEXT,
  ADD COLUMN "long_description" TEXT,
  ADD COLUMN "specifications" JSONB,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "reviewed_by" UUID,
  ADD COLUMN "approved_by" UUID,
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "published_at" TIMESTAMP(3),
  ADD COLUMN "unpublished_at" TIMESTAMP(3),
  ADD COLUMN "archived_at" TIMESTAMP(3),
  ADD COLUMN "ar_model_media_id" UUID,
  ADD COLUMN "face_try_on_metadata" JSONB,
  ADD COLUMN "seo" JSONB;

UPDATE "catalog"."products" SET "product_type" = 'EYEGLASSES' WHERE "product_type" IS NULL;
ALTER TABLE "catalog"."products" ALTER COLUMN "product_type" SET NOT NULL;

UPDATE "catalog"."products" SET "long_description" = "description" WHERE "description" IS NOT NULL;

ALTER TABLE "catalog"."products" RENAME COLUMN "status" TO "status_old";
ALTER TABLE "catalog"."products" ADD COLUMN "status" "catalog"."ProductLifecycleStatus";
UPDATE "catalog"."products" SET "status" = (CASE "status_old"::text
  WHEN 'DRAFT' THEN 'DRAFT'
  WHEN 'ACTIVE' THEN 'PUBLISHED'
  WHEN 'ARCHIVED' THEN 'ARCHIVED'
END)::"catalog"."ProductLifecycleStatus";
UPDATE "catalog"."products" SET "published_at" = "updated_at" WHERE "status" = 'PUBLISHED';
ALTER TABLE "catalog"."products"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';
ALTER TABLE "catalog"."products" DROP COLUMN "status_old";

CREATE INDEX "products_status_idx" ON "catalog"."products"("status");
CREATE INDEX "products_product_type_idx" ON "catalog"."products"("product_type");

-- =============================================================================
-- 6. Product variants — add merchandising columns, backfill gender from the
--    (still-present) products.gender, migrate status.
-- =============================================================================
ALTER TABLE "catalog"."product_variants"
  ADD COLUMN "label" TEXT,
  ADD COLUMN "color_hex" TEXT,
  ADD COLUMN "frame_shape" TEXT,
  ADD COLUMN "frame_material" TEXT,
  ADD COLUMN "frame_width_mm" INTEGER,
  ADD COLUMN "bridge_width_mm" INTEGER,
  ADD COLUMN "temple_length_mm" INTEGER,
  ADD COLUMN "lens_width_mm" INTEGER,
  ADD COLUMN "fit" TEXT,
  ADD COLUMN "gender" "catalog"."ProductGender",
  ADD COLUMN "style" TEXT,
  ADD COLUMN "lens_compatibility" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "catalog"."product_variants" v
  SET "gender" = p."gender"
  FROM "catalog"."products" p
  WHERE p."id" = v."product_id" AND p."gender" IS NOT NULL;

ALTER TABLE "catalog"."product_variants" RENAME COLUMN "status" TO "status_old";
ALTER TABLE "catalog"."product_variants" ADD COLUMN "status" "catalog"."CatalogStatus";
UPDATE "catalog"."product_variants" SET "status" = (CASE "status_old"::text
  WHEN 'ACTIVE' THEN 'ACTIVE'
  ELSE 'INACTIVE'
END)::"catalog"."CatalogStatus";
ALTER TABLE "catalog"."product_variants"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
ALTER TABLE "catalog"."product_variants" DROP COLUMN "status_old";

-- =============================================================================
-- 7. Product SKUs — new table, seeded from the about-to-be-dropped
--    product_variants.{sku,barcode,weight_grams} (still present here).
-- =============================================================================
CREATE TABLE "catalog"."product_skus" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "sku_code" TEXT NOT NULL,
    "barcode" TEXT,
    "status" "catalog"."SkuStatus" NOT NULL DEFAULT 'ACTIVE',
    "weight_grams" INTEGER,
    "length_mm" INTEGER,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "tax_rate_basis_points" INTEGER,
    "supplier_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id")
);

INSERT INTO "catalog"."product_skus" ("id", "product_id", "variant_id", "sku_code", "barcode", "status", "weight_grams", "created_at", "updated_at")
SELECT gen_random_uuid(), v."product_id", v."id", v."sku", v."barcode",
  (CASE WHEN v."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END)::"catalog"."SkuStatus",
  v."weight_grams", v."created_at", v."updated_at"
FROM "catalog"."product_variants" v;

ALTER TABLE "catalog"."product_variants" DROP COLUMN "sku";
ALTER TABLE "catalog"."product_variants" DROP COLUMN "barcode";
ALTER TABLE "catalog"."product_variants" DROP COLUMN "weight_grams";

ALTER TABLE "catalog"."products" DROP COLUMN "gender";
ALTER TABLE "catalog"."products" DROP COLUMN "sku";
ALTER TABLE "catalog"."products" DROP COLUMN "description";

CREATE UNIQUE INDEX "product_skus_variant_id_key" ON "catalog"."product_skus"("variant_id");
CREATE UNIQUE INDEX "product_skus_sku_code_key" ON "catalog"."product_skus"("sku_code");
CREATE UNIQUE INDEX "product_skus_barcode_key" ON "catalog"."product_skus"("barcode");
CREATE INDEX "product_skus_product_id_idx" ON "catalog"."product_skus"("product_id");
CREATE INDEX "product_skus_status_idx" ON "catalog"."product_skus"("status");

ALTER TABLE "catalog"."product_skus" ADD CONSTRAINT "product_skus_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_skus" ADD CONSTRAINT "product_skus_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 8. product_images -> media + product_media (product_images had zero rows
--    — verified before writing this migration — nothing to carry over).
-- =============================================================================
DROP TABLE "catalog"."product_images";

CREATE TABLE "catalog"."product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "media_id" UUID NOT NULL,
    "role" "catalog"."MediaRole" NOT NULL DEFAULT 'GALLERY',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "alt_text_override" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "product_media_product_id_idx" ON "catalog"."product_media"("product_id");
CREATE INDEX "product_media_variant_id_idx" ON "catalog"."product_media"("variant_id");
CREATE INDEX "product_media_media_id_idx" ON "catalog"."product_media"("media_id");
ALTER TABLE "catalog"."product_media" ADD CONSTRAINT "product_media_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_media" ADD CONSTRAINT "product_media_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "catalog"."product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."product_media" ADD CONSTRAINT "product_media_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "catalog"."media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =============================================================================
-- 9. Collections
-- =============================================================================
CREATE TABLE "catalog"."collections" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "localized_name" JSONB,
    "description" TEXT,
    "type" "catalog"."CollectionType" NOT NULL DEFAULT 'MANUAL',
    "rules" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "status" "catalog"."CatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "published_at" TIMESTAMP(3),
    "image_media_id" UUID,
    "seo" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collections_slug_key" ON "catalog"."collections"("slug");
CREATE INDEX "collections_type_idx" ON "catalog"."collections"("type");
CREATE INDEX "collections_status_idx" ON "catalog"."collections"("status");
ALTER TABLE "catalog"."collections" ADD CONSTRAINT "collections_image_media_id_fkey" FOREIGN KEY ("image_media_id") REFERENCES "catalog"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "catalog"."collection_products" (
    "collection_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_products_pkey" PRIMARY KEY ("collection_id","product_id")
);
CREATE INDEX "collection_products_product_id_idx" ON "catalog"."collection_products"("product_id");
ALTER TABLE "catalog"."collection_products" ADD CONSTRAINT "collection_products_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "catalog"."collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "catalog"."collection_products" ADD CONSTRAINT "collection_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "catalog"."products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 10. Product AR-readiness FK + remaining new columns on existing lookup
--     tables.
-- =============================================================================
ALTER TABLE "catalog"."products" ADD CONSTRAINT "products_ar_model_media_id_fkey" FOREIGN KEY ("ar_model_media_id") REFERENCES "catalog"."media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "catalog"."product_attributes"
  ADD COLUMN "localized_name" JSONB,
  ADD COLUMN "is_filterable" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "catalog"."product_attribute_values" ADD COLUMN "localized_value" JSONB;

ALTER TABLE "catalog"."lens_types" ADD COLUMN "localized_name" JSONB;
ALTER TABLE "catalog"."lens_coatings" ADD COLUMN "localized_name" JSONB;

-- =============================================================================
-- 11. Inventory / commerce / finance — repoint "product_variant_id" ->
--     "product_sku_id" (ADR-005 decision 1) by joining through the
--     product_skus rows created in step 7. Cross-schema and unenforced by
--     design — see docs/database/README.md.
-- =============================================================================
ALTER TABLE "inventory"."inventory_items" ADD COLUMN "product_sku_id" UUID;
UPDATE "inventory"."inventory_items" ii
  SET "product_sku_id" = ps."id"
  FROM "catalog"."product_skus" ps
  WHERE ps."variant_id" = ii."product_variant_id";
ALTER TABLE "inventory"."inventory_items" ALTER COLUMN "product_sku_id" SET NOT NULL;
ALTER TABLE "inventory"."inventory_items" DROP COLUMN "product_variant_id";
CREATE INDEX "inventory_items_product_sku_id_idx" ON "inventory"."inventory_items"("product_sku_id");
CREATE UNIQUE INDEX "inventory_items_warehouse_id_product_sku_id_key" ON "inventory"."inventory_items"("warehouse_id", "product_sku_id");

ALTER TABLE "commerce"."cart_items" ADD COLUMN "product_sku_id" UUID;
UPDATE "commerce"."cart_items" ci
  SET "product_sku_id" = ps."id"
  FROM "catalog"."product_skus" ps
  WHERE ps."variant_id" = ci."product_variant_id";
ALTER TABLE "commerce"."cart_items" ALTER COLUMN "product_sku_id" SET NOT NULL;
ALTER TABLE "commerce"."cart_items" DROP COLUMN "product_variant_id";
CREATE UNIQUE INDEX "cart_items_cart_id_product_sku_id_key" ON "commerce"."cart_items"("cart_id", "product_sku_id");

ALTER TABLE "commerce"."order_items" ADD COLUMN "product_sku_id" UUID;
UPDATE "commerce"."order_items" oi
  SET "product_sku_id" = ps."id"
  FROM "catalog"."product_skus" ps
  WHERE ps."variant_id" = oi."product_variant_id";
ALTER TABLE "commerce"."order_items" DROP COLUMN "product_variant_id";

ALTER TABLE "finance"."product_prices"
  ADD COLUMN "product_sku_id" UUID,
  ADD COLUMN "compare_at_price" BIGINT,
  ADD COLUMN "valid_from" TIMESTAMP(3),
  ADD COLUMN "valid_to" TIMESTAMP(3);
UPDATE "finance"."product_prices" pp
  SET "product_sku_id" = ps."id"
  FROM "catalog"."product_skus" ps
  WHERE ps."variant_id" = pp."product_variant_id";
ALTER TABLE "finance"."product_prices" ALTER COLUMN "product_sku_id" SET NOT NULL;
ALTER TABLE "finance"."product_prices" DROP COLUMN "product_variant_id";
CREATE UNIQUE INDEX "product_prices_product_sku_id_key" ON "finance"."product_prices"("product_sku_id");

ALTER TABLE "finance"."price_history" ADD COLUMN "product_sku_id" UUID;
UPDATE "finance"."price_history" ph
  SET "product_sku_id" = ps."id"
  FROM "catalog"."product_skus" ps
  WHERE ps."variant_id" = ph."product_variant_id";
ALTER TABLE "finance"."price_history" ALTER COLUMN "product_sku_id" SET NOT NULL;
ALTER TABLE "finance"."price_history" DROP COLUMN "product_variant_id";
CREATE INDEX "price_history_product_sku_id_idx" ON "finance"."price_history"("product_sku_id");

-- =============================================================================
-- 12. Drop the now-unused old ProductStatus enum (superseded by
--     ProductLifecycleStatus on products, CatalogStatus on variants) — safe
--     only now that both former users have been migrated off it above.
-- =============================================================================
DROP TYPE "catalog"."ProductStatus";
