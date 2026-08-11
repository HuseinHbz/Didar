-- Down-migration for 20260811181736_init_enterprise_foundation.
--
-- Prisma has no built-in rollback mechanism — this file is hand-generated
-- (not applied automatically by `prisma migrate`) via:
--
--   pnpm exec prisma migrate diff \
--     --from-schema-datamodel prisma/schema.prisma \
--     --to-empty \
--     --script
--
-- That command is only valid as a rollback for the CURRENT migration because
-- this is a single-migration history: "undo the last migration" and "undo
-- everything" are the same operation right now. Once a second migration
-- exists, this recipe must change to `--from-schema-datamodel` pointed at
-- THIS migration's schema state and `--to-schema-datamodel` (or an
-- equivalent diff source) pointed at the PREVIOUS migration's state —
-- diffing straight to empty would drop tables later migrations still need.
-- See scripts/db-rollback.sh, which this file is designed to be applied by.
--
-- Deliberately NOT included below: `DROP SCHEMA` for the 11 domain schemas.
-- The diff only reasons about tables/enums (the objects Prisma's data model
-- owns), not the schemas themselves — those are also created independently
-- and idempotently by infrastructure/postgres/init/01-schemas.sql. Leaving
-- empty schemas behind after a rollback is harmless and means re-applying
-- the migration afterward needs no extra setup.

-- DropForeignKey
ALTER TABLE "identity"."user_sessions" DROP CONSTRAINT "user_sessions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."role_permissions" DROP CONSTRAINT "role_permissions_role_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."role_permissions" DROP CONSTRAINT "role_permissions_permission_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."user_roles" DROP CONSTRAINT "user_roles_user_id_fkey";

-- DropForeignKey
ALTER TABLE "identity"."user_roles" DROP CONSTRAINT "user_roles_role_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."customer_addresses" DROP CONSTRAINT "customer_addresses_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."family_members" DROP CONSTRAINT "family_members_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."customer_segment_members" DROP CONSTRAINT "customer_segment_members_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."customer_segment_members" DROP CONSTRAINT "customer_segment_members_segment_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."loyalty_accounts" DROP CONSTRAINT "loyalty_accounts_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."loyalty_transactions" DROP CONSTRAINT "loyalty_transactions_loyalty_account_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."wallet_accounts" DROP CONSTRAINT "wallet_accounts_customer_id_fkey";

-- DropForeignKey
ALTER TABLE "customer"."wallet_transactions" DROP CONSTRAINT "wallet_transactions_wallet_account_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."categories" DROP CONSTRAINT "categories_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."products" DROP CONSTRAINT "products_brand_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."products" DROP CONSTRAINT "products_category_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."product_variants" DROP CONSTRAINT "product_variants_product_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."product_attribute_values" DROP CONSTRAINT "product_attribute_values_attribute_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."product_variant_attribute_values" DROP CONSTRAINT "product_variant_attribute_values_variant_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."product_variant_attribute_values" DROP CONSTRAINT "product_variant_attribute_values_attribute_value_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."product_images" DROP CONSTRAINT "product_images_product_id_fkey";

-- DropForeignKey
ALTER TABLE "catalog"."product_images" DROP CONSTRAINT "product_images_variant_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory"."inventory_items" DROP CONSTRAINT "inventory_items_warehouse_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory"."inventory_transactions" DROP CONSTRAINT "inventory_transactions_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "inventory"."stock_reservations" DROP CONSTRAINT "stock_reservations_inventory_item_id_fkey";

-- DropForeignKey
ALTER TABLE "commerce"."cart_items" DROP CONSTRAINT "cart_items_cart_id_fkey";

-- DropForeignKey
ALTER TABLE "commerce"."order_items" DROP CONSTRAINT "order_items_order_id_fkey";

-- DropForeignKey
ALTER TABLE "commerce"."order_status_history" DROP CONSTRAINT "order_status_history_order_id_fkey";

-- DropForeignKey
ALTER TABLE "commerce"."payments" DROP CONSTRAINT "payments_order_id_fkey";

-- DropForeignKey
ALTER TABLE "commerce"."refunds" DROP CONSTRAINT "refunds_payment_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing"."coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_coupon_id_fkey";

-- DropForeignKey
ALTER TABLE "marketing"."promotion_products" DROP CONSTRAINT "promotion_products_promotion_id_fkey";

-- DropForeignKey
ALTER TABLE "cms"."page_sections" DROP CONSTRAINT "page_sections_page_id_fkey";

-- DropForeignKey
ALTER TABLE "cms"."menu_items" DROP CONSTRAINT "menu_items_menu_id_fkey";

-- DropForeignKey
ALTER TABLE "cms"."menu_items" DROP CONSTRAINT "menu_items_parent_id_fkey";

-- DropForeignKey
ALTER TABLE "finance"."invoice_lines" DROP CONSTRAINT "invoice_lines_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "notification"."notification_logs" DROP CONSTRAINT "notification_logs_template_id_fkey";

-- DropForeignKey
ALTER TABLE "system"."webhook_deliveries" DROP CONSTRAINT "webhook_deliveries_webhook_id_fkey";

-- DropTable
DROP TABLE "identity"."users";

-- DropTable
DROP TABLE "identity"."user_sessions";

-- DropTable
DROP TABLE "identity"."otp_requests";

-- DropTable
DROP TABLE "identity"."roles";

-- DropTable
DROP TABLE "identity"."permissions";

-- DropTable
DROP TABLE "identity"."role_permissions";

-- DropTable
DROP TABLE "identity"."user_roles";

-- DropTable
DROP TABLE "customer"."customers";

-- DropTable
DROP TABLE "customer"."customer_addresses";

-- DropTable
DROP TABLE "customer"."family_members";

-- DropTable
DROP TABLE "customer"."customer_segments";

-- DropTable
DROP TABLE "customer"."customer_segment_members";

-- DropTable
DROP TABLE "customer"."loyalty_accounts";

-- DropTable
DROP TABLE "customer"."loyalty_transactions";

-- DropTable
DROP TABLE "customer"."wallet_accounts";

-- DropTable
DROP TABLE "customer"."wallet_transactions";

-- DropTable
DROP TABLE "catalog"."brands";

-- DropTable
DROP TABLE "catalog"."categories";

-- DropTable
DROP TABLE "catalog"."products";

-- DropTable
DROP TABLE "catalog"."product_variants";

-- DropTable
DROP TABLE "catalog"."product_attributes";

-- DropTable
DROP TABLE "catalog"."product_attribute_values";

-- DropTable
DROP TABLE "catalog"."product_variant_attribute_values";

-- DropTable
DROP TABLE "catalog"."product_images";

-- DropTable
DROP TABLE "catalog"."lens_types";

-- DropTable
DROP TABLE "catalog"."lens_coatings";

-- DropTable
DROP TABLE "inventory"."warehouses";

-- DropTable
DROP TABLE "inventory"."inventory_items";

-- DropTable
DROP TABLE "inventory"."inventory_transactions";

-- DropTable
DROP TABLE "inventory"."stock_reservations";

-- DropTable
DROP TABLE "commerce"."carts";

-- DropTable
DROP TABLE "commerce"."cart_items";

-- DropTable
DROP TABLE "commerce"."orders";

-- DropTable
DROP TABLE "commerce"."order_items";

-- DropTable
DROP TABLE "commerce"."order_status_history";

-- DropTable
DROP TABLE "commerce"."payments";

-- DropTable
DROP TABLE "commerce"."refunds";

-- DropTable
DROP TABLE "marketing"."coupons";

-- DropTable
DROP TABLE "marketing"."coupon_redemptions";

-- DropTable
DROP TABLE "marketing"."promotions";

-- DropTable
DROP TABLE "marketing"."promotion_products";

-- DropTable
DROP TABLE "marketing"."campaigns";

-- DropTable
DROP TABLE "cms"."pages";

-- DropTable
DROP TABLE "cms"."page_sections";

-- DropTable
DROP TABLE "cms"."banners";

-- DropTable
DROP TABLE "cms"."articles";

-- DropTable
DROP TABLE "cms"."menus";

-- DropTable
DROP TABLE "cms"."menu_items";

-- DropTable
DROP TABLE "cms"."faqs";

-- DropTable
DROP TABLE "finance"."product_prices";

-- DropTable
DROP TABLE "finance"."price_history";

-- DropTable
DROP TABLE "finance"."invoices";

-- DropTable
DROP TABLE "finance"."invoice_lines";

-- DropTable
DROP TABLE "notification"."notification_templates";

-- DropTable
DROP TABLE "notification"."notification_logs";

-- DropTable
DROP TABLE "notification"."notification_preferences";

-- DropTable
DROP TABLE "analytics"."analytics_events";

-- DropTable
DROP TABLE "system"."audit_logs";

-- DropTable
DROP TABLE "system"."api_keys";

-- DropTable
DROP TABLE "system"."webhooks";

-- DropTable
DROP TABLE "system"."webhook_deliveries";

-- DropTable
DROP TABLE "system"."feature_flags";

-- DropTable
DROP TABLE "system"."settings";

-- DropEnum
DROP TYPE "commerce"."OrderStatus";

-- DropEnum
DROP TYPE "inventory"."InventoryTransactionType";

-- DropEnum
DROP TYPE "notification"."NotificationChannel";

-- DropEnum
DROP TYPE "customer"."CustomerGender";

-- DropEnum
DROP TYPE "customer"."FamilyRelation";

-- DropEnum
DROP TYPE "customer"."LoyaltyTier";

-- DropEnum
DROP TYPE "customer"."LoyaltyTransactionType";

-- DropEnum
DROP TYPE "customer"."WalletTransactionType";

-- DropEnum
DROP TYPE "catalog"."ProductGender";

-- DropEnum
DROP TYPE "catalog"."ProductStatus";

-- DropEnum
DROP TYPE "inventory"."ReservationStatus";

-- DropEnum
DROP TYPE "commerce"."CartStatus";

-- DropEnum
DROP TYPE "commerce"."PaymentStatus";

-- DropEnum
DROP TYPE "commerce"."RefundStatus";

-- DropEnum
DROP TYPE "marketing"."CouponType";

-- DropEnum
DROP TYPE "marketing"."CampaignChannel";

-- DropEnum
DROP TYPE "marketing"."CampaignStatus";

-- DropEnum
DROP TYPE "cms"."ContentStatus";

-- DropEnum
DROP TYPE "notification"."NotificationStatus";

-- DropEnum
DROP TYPE "system"."WebhookDeliveryStatus";
