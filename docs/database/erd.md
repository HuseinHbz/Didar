# Entity-Relationship Diagrams

Generated from `packages/database/prisma/schema.prisma` as of migration
`20260811181736_init_enterprise_foundation`. Table/column names below are the
real PostgreSQL names (`snake_case`, from each model's `@@map`/`@map`) — not
the Prisma field names — since this document describes the database, not the
client.

**Omitted from every diagram for readability**: `created_at`, `updated_at`,
`deleted_at`. Which of the three a given table actually has follows the
three-tier convention in [`README.md`](./README.md#conventions) (lifecycle /
append-only / join table) — check the table's tier there, don't assume all
three exist.

**A relationship line means an enforced PostgreSQL `FOREIGN KEY`.** Every
foreign key in this schema is intra-schema — see
["Cross-schema references are intentionally unenforced"](./README.md#cross-schema-references-are-intentionally-unenforced)
for why. The [Cross-schema overview](#cross-schema-overview) below shows the
_logical_ references that exist between schemas as plain, unenforced UUID
columns (dashed arrows) — do not read those as FK constraints.

## Cross-schema overview

```mermaid
graph LR
    identity["identity"]
    customer["customer"]
    catalog["catalog"]
    inventory["inventory"]
    commerce["commerce"]
    marketing["marketing"]
    finance["finance"]
    notification["notification"]
    cms["cms"]
    analytics["analytics"]
    system["system"]

    identity -. "customers.user_id" .-> customer
    customer -. "orders.customer_id" .-> commerce
    customer -. "carts.customer_id (nullable: guest checkout)" .-> commerce
    catalog -. "product_prices.product_sku_id" .-> finance
    catalog -. "price_history.product_sku_id" .-> finance
    catalog -. "inventory_items.product_sku_id" .-> inventory
    catalog -. "cart_items/order_items.product_sku_id" .-> commerce
    commerce -. "invoices.order_id" .-> finance
    commerce -. "inventory_reservations.source_id (polymorphic: cart/order/POS/manual)" .-> inventory
    commerce -. "checkout_reservations.inventory_reservation_id" .-> inventory
    commerce -. "shipping_methods.warehouse_id (nullable: STORE_PICKUP)" .-> inventory
    commerce -. "coupon_redemptions.order_id/customer_id" .-> marketing
    commerce -. "cart_coupons.coupon_id" .-> marketing
    customer -. "payment_intents.customer_id (Phase 008)" .-> commerce
    identity -. "refunds.requested_by (Phase 008)" .-> commerce
    customer -. "notification_preferences.customer_id" .-> notification
    customer -. "notification_logs.customer_id" .-> notification
    customer -. "analytics_events.customer_id" .-> analytics
    catalog -. "analytics_events.product_id" .-> analytics
    commerce -. "analytics_events.order_id" .-> analytics
    identity -. "audit_logs.actor_id/actor_device, *.created_by/changed_by" .-> system
```

## identity

```mermaid
erDiagram
    users ||--o{ user_sessions : has
    users ||--o{ user_roles : has
    users ||--o{ user_devices : has
    users ||--o| user_two_factor_credentials : has
    users ||--o{ user_permission_overrides : has
    users ||--o{ security_events : has
    user_devices ||--o{ user_sessions : "issued from"
    roles ||--o{ user_roles : has
    roles ||--o{ role_permissions : has
    roles ||--o{ roles : "parent/children"
    permissions ||--o{ role_permissions : has
    permissions ||--o{ user_permission_overrides : has

    users {
        uuid id PK
        string phone UK
        string email UK "nullable"
        string password_hash "nullable"
        boolean is_active
        timestamp phone_verified_at "nullable"
        timestamp last_login_at "nullable"
    }
    user_devices {
        uuid id PK
        uuid user_id FK
        string fingerprint "hash of UA + platform + install id"
        string label "nullable, e.g. Ali's iPhone"
        string platform "nullable"
        timestamp trusted_at "nullable — blueprint Device Trust"
        timestamp last_seen_at
        timestamp revoked_at "nullable"
    }
    user_sessions {
        uuid id PK
        uuid user_id FK
        uuid device_id FK "nullable"
        string refresh_token_hash UK
        string user_agent "nullable"
        string ip_address "nullable"
        timestamp expires_at
        timestamp revoked_at "nullable"
    }
    user_two_factor_credentials {
        uuid id PK
        uuid user_id "UK, FK"
        enum method "TOTP"
        string secret_encrypted "AES-256-GCM ciphertext, never raw"
        string[] recovery_codes_hashed
        boolean enabled
        timestamp verified_at "nullable"
    }
    otp_requests {
        uuid id PK
        string phone
        string code_hash
        string purpose "LOGIN | REGISTER | RESET_PASSWORD"
        int attempts
        timestamp expires_at
        timestamp consumed_at "nullable"
    }
    roles {
        uuid id PK
        uuid parent_id FK "nullable, self-reference — inheritance"
        string name UK
        boolean is_system
    }
    permissions {
        uuid id PK
        string module "e.g. identity"
        string action "e.g. users.view_contact"
        string key UK "module + '.' + action"
    }
    role_permissions {
        uuid role_id "PK, FK"
        uuid permission_id "PK, FK"
    }
    user_roles {
        uuid user_id "PK, FK"
        uuid role_id "PK, FK"
    }
    user_permission_overrides {
        uuid id PK
        uuid user_id FK
        uuid permission_id FK
        enum effect "ALLOW | DENY — DENY always wins"
        string reason "nullable"
        uuid created_by "nullable, -> identity.users.id, unenforced"
    }
    security_events {
        uuid id PK
        uuid user_id "nullable, FK"
        enum type "LOGIN_SUCCESS | LOGIN_FAILURE | OTP_* | TWO_FACTOR_* | SESSION_* | API_KEY_*"
        string ip_address "nullable"
        string user_agent "nullable"
        json metadata "nullable"
    }
```

`otp_requests` has no FK — it's keyed by `phone` directly (a request can
precede account creation, e.g. registration OTP). `roles.parent_id` is a
self-reference: a role's effective permissions are its own `role_permissions`
rows unioned with every ancestor's, resolved in application code (Phase 004's
`PermissionResolver`), not a recursive query baked into the schema.
`user_permission_overrides` is the per-user exception on top of that
resolved set — `DENY` always wins over any role-derived grant, `ALLOW`
grants something no assigned role does.

## customer

```mermaid
erDiagram
    customers ||--o{ customer_addresses : has
    customers ||--o{ family_members : has
    customers ||--o{ customer_segment_members : "belongs to"
    customer_segments ||--o{ customer_segment_members : contains
    customers ||--o| loyalty_accounts : has
    loyalty_accounts ||--o{ loyalty_transactions : has
    customers ||--o| wallet_accounts : has
    wallet_accounts ||--o{ wallet_transactions : has

    customers {
        uuid id PK
        uuid user_id UK "-> identity.users.id, unenforced"
        string first_name
        string last_name
        string national_id UK "nullable"
        date birth_date "nullable"
        enum gender "nullable"
    }
    customer_addresses {
        uuid id PK
        uuid customer_id FK
        string label "nullable"
        string recipient_name
        string province
        string city
        string address_line1
        boolean is_default
    }
    family_members {
        uuid id PK
        uuid customer_id FK
        enum relation "SELF | SPOUSE | CHILD | PARENT | OTHER"
        string first_name
        string last_name
    }
    customer_segments {
        uuid id PK
        string key UK
        string name
    }
    customer_segment_members {
        uuid customer_id "PK, FK"
        uuid segment_id "PK, FK"
        timestamp added_at
    }
    loyalty_accounts {
        uuid id PK
        uuid customer_id "UK, FK"
        int points_balance "cache of loyalty_transactions sum"
        enum tier "BRONZE..VIP"
    }
    loyalty_transactions {
        uuid id PK
        uuid loyalty_account_id FK
        enum type "EARN | REDEEM | EXPIRE | ADJUST"
        int points
    }
    wallet_accounts {
        uuid id PK
        uuid customer_id "UK, FK"
        bigint balance "Rial, cache of wallet_transactions sum"
    }
    wallet_transactions {
        uuid id PK
        uuid wallet_account_id FK
        enum type "CASHBACK | REFUND | GIFT | CREDIT | DEBIT | EXPIRATION"
        bigint amount
        bigint balance_after
    }
```

## catalog

Phase 005 (see [`catalog-erd.md`](./catalog-erd.md) for the full diagram with
every column and design rationale) substantially extended this schema —
`brands`/`categories`/`products` gained SEO/localization/media fields,
`product_variants` split into a merchandising row (this table) and a new
`product_skus` table (the sellable/priced/inventoried unit — see
[`docs/adr/ADR-005-catalog-architecture.md`](../adr/ADR-005-catalog-architecture.md)
decision 1), `product_images` was replaced by a storage-agnostic `media` +
`product_media` pair, and two new tables (`collections`,
`collection_products`) were added. The summary below is intentionally
abbreviated; `catalog-erd.md` is the source of truth for this schema going
forward.

```mermaid
erDiagram
    brands ||--o{ products : has
    categories ||--o{ products : has
    categories ||--o{ categories : "parent/children"
    products ||--o{ product_variants : has
    product_variants ||--o| product_skus : has
    products ||--o{ product_media : has
    media ||--o{ product_media : "attached via"
    products ||--o{ collection_products : "belongs to"
    collections ||--o{ collection_products : contains
    product_attributes ||--o{ product_attribute_values : has
    product_variants ||--o{ product_variant_attribute_values : has
    product_attribute_values ||--o{ product_variant_attribute_values : has

    brands {
        uuid id PK
        string name UK
        string slug UK
        uuid logo_media_id FK "nullable, -> media.id"
        enum status "ACTIVE|INACTIVE"
    }
    categories {
        uuid id PK
        uuid parent_id FK "nullable, self-reference"
        string name
        string slug UK
        enum status "ACTIVE|INACTIVE"
        timestamp published_at "nullable"
    }
    collections {
        uuid id PK
        string name
        string slug UK
        enum type "MANUAL|DYNAMIC"
        json rules "nullable, DYNAMIC only"
        int priority
    }
    collection_products {
        uuid collection_id "PK, FK"
        uuid product_id "PK, FK"
        int sort_order
    }
    products {
        uuid id PK
        uuid brand_id FK
        uuid category_id FK
        enum product_type "EYEGLASSES|SUNGLASSES|...|ACCESSORY"
        string name
        string slug UK
        enum status "DRAFT|IN_REVIEW|APPROVED|PUBLISHED|UNPUBLISHED|ARCHIVED"
        string[] tags
        uuid ar_model_media_id FK "nullable, -> media.id"
    }
    product_variants {
        uuid id PK
        uuid product_id FK
        string color "nullable"
        string size "nullable"
        int frame_width_mm "nullable"
        int bridge_width_mm "nullable"
        int temple_length_mm "nullable"
        enum gender "nullable"
        boolean is_default
        enum status "ACTIVE|INACTIVE"
    }
    product_skus {
        uuid id PK
        uuid product_id FK
        uuid variant_id UK "1:1 with product_variants"
        string sku_code UK
        string barcode UK "nullable"
        int weight_grams "nullable"
        int tax_rate_basis_points "nullable"
        enum status "ACTIVE|INACTIVE|DISCONTINUED"
    }
    product_attributes {
        uuid id PK
        string key UK "e.g. frame_shape"
        string name "e.g. شکل فریم"
        boolean is_filterable
    }
    product_attribute_values {
        uuid id PK
        uuid attribute_id FK
        string value "e.g. Round"
    }
    product_variant_attribute_values {
        uuid variant_id "PK, FK"
        uuid attribute_value_id "PK, FK"
    }
    media {
        uuid id PK
        enum provider "LOCAL|S3|CDN"
        string storage_key UK
        string url
        enum kind "IMAGE|VIDEO|MODEL_3D|AR_ASSET"
    }
    product_media {
        uuid id PK
        uuid product_id FK
        uuid variant_id FK "nullable"
        uuid media_id FK
        enum role "PRIMARY|GALLERY|THUMBNAIL|SWATCH|VIDEO|MODEL_3D"
        int sort_order
    }
    lens_types {
        uuid id PK
        string name UK
    }
    lens_coatings {
        uuid id PK
        string name UK
    }
```

`lens_types` / `lens_coatings` are standalone lookup tables — no FK yet. The
full lens configuration/compatibility/pricing engine is out of scope for this
foundation pass (see [`README.md`](./README.md#deliberately-out-of-scope)).

## inventory

Phase 006 (see [`inventory-erd.md`](./inventory-erd.md) for the full diagram
with every column and design rationale) completely rewrote this schema —
`warehouses` gained `type`/`status`/`timezone`/`capacity`, a new
`warehouse_locations` table was added (a warehouse must have ≥1 location
before it can hold stock), `inventory_items` moved to a
`(product_sku_id, warehouse_id, location_id)` key with a full 7-bucket
quantity model, `inventory_transactions`/`stock_reservations` were replaced
by `inventory_ledger` (append-only, 13-value movement-type vocabulary) and
`inventory_reservations` (idempotency-key-protected), and four new tables
(`inventory_thresholds`, `stock_transfers`/`stock_transfer_items`,
`inventory_adjustments`, `stock_counts`/`stock_count_items`) were added. The
summary below is intentionally abbreviated; `inventory-erd.md` is the source
of truth for this schema going forward.

```mermaid
erDiagram
    warehouses ||--o{ warehouse_locations : has
    warehouses ||--o{ inventory_items : stocks
    warehouse_locations ||--o{ inventory_items : holds
    inventory_items ||--o{ inventory_ledger : has
    inventory_items ||--o{ inventory_reservations : has
    warehouses ||--o{ stock_transfers : "source/destination of"
    stock_transfers ||--o{ stock_transfer_items : contains
    warehouses ||--o{ stock_counts : has
    stock_counts ||--o{ stock_count_items : contains

    warehouses {
        uuid id PK
        string code UK
        string name
        enum type "CENTRAL|REGIONAL|STORE|DARK_STORE|QUARANTINE"
        enum status "ACTIVE|INACTIVE|CLOSED"
    }
    warehouse_locations {
        uuid id PK
        uuid warehouse_id FK
        string code "UK with warehouse_id"
        enum type "RECEIVING|PICKING|STORAGE|QUARANTINE|DAMAGED|RETURNS|STAGING"
    }
    inventory_items {
        uuid id PK
        uuid product_sku_id "UK with warehouse_id+location_id, -> catalog.product_skus.id, unenforced"
        uuid warehouse_id FK
        uuid location_id FK
        int on_hand_quantity "cache of inventory_ledger sum"
        int reserved_quantity
        int available_quantity "on_hand - reserved - damaged - quarantined - blocked"
        int version "optimistic-lock marker"
    }
    inventory_ledger {
        uuid id PK
        uuid inventory_item_id FK
        enum movement_type "13-value vocabulary, see inventory-erd.md"
        int quantity
        int before_on_hand
        int after_on_hand
        string reference_type "nullable, polymorphic"
        uuid reference_id "nullable, polymorphic"
        uuid correlation_id
    }
    inventory_reservations {
        uuid id PK
        uuid inventory_item_id FK
        int quantity
        enum status "ACTIVE|RELEASED|CONVERTED|EXPIRED|CANCELLED"
        string source_type "polymorphic"
        uuid source_id "polymorphic, unenforced"
        string idempotency_key UK
    }
    stock_transfers {
        uuid id PK
        string reference_number UK
        uuid source_warehouse_id FK
        uuid destination_warehouse_id FK
        enum status "9-state, see inventory-erd.md"
    }
    stock_transfer_items {
        uuid id PK
        uuid transfer_id FK
        uuid product_sku_id "UK with transfer_id"
        int requested_quantity
    }
    stock_counts {
        uuid id PK
        uuid warehouse_id FK
        enum status "PLANNED|IN_PROGRESS|COUNTED|UNDER_REVIEW|APPROVED|REJECTED|CLOSED"
    }
    stock_count_items {
        uuid id PK
        uuid stock_count_id FK
        uuid product_sku_id "UK with stock_count_id"
        int expected_quantity
        int counted_quantity "nullable"
        int variance "nullable"
    }
```

`inventory_ledger` is the append-only ledger (no `updated_at`, never
updated/deleted); `inventory_items`' quantity buckets are a maintained
cache, never the source of truth. `available_quantity >= 0` is enforced
transactionally (`SELECT ... FOR UPDATE` + a domain-layer assertion), not by
a database `CHECK` constraint — Prisma has no `@@check(...)` support (see
`inventory-erd.md`).

## commerce

Phase 007 (see [`cart-checkout-erd.md`](./cart-checkout-erd.md) for the
full diagram with every column and design rationale) extended `carts`/
`cart_items` (`session_token` renamed `guest_token`, `configuration_hash`/
`configuration_snapshot` added) and added 10 new tables:
`cart_item_options`, `cart_price_snapshots`, `cart_coupons`,
`shipping_methods`, `cart_shipping_selections`, and the entire
`checkout_sessions`/`checkout_addresses`/`checkout_totals`/
`checkout_validations`/`checkout_reservations` subtree. Phase 008 (see
[`payment-erd.md`](./payment-erd.md) for the full diagram) then dropped
the placeholder `payments`/`refunds`/`PaymentStatus`/`RefundStatus` shown
below and replaced them with a real 7-table payment orchestration subtree
(`payment_providers`, `payment_intents`, `payment_attempts`,
`payment_transactions`, `payment_callbacks`, `refunds`,
`reconciliation_records`) keyed off `checkout_sessions`, not `orders`. The
summary below is intentionally abbreviated (it still shows the Phase 003
placeholder `payments`/`refunds` shape for historical continuity with the
diagram beneath it, and omits every Phase 007/008 addition entirely — see
`cart-checkout-erd.md` and `payment-erd.md` for those); both are the
source of truth for their half of this schema going forward, same
convention `inventory-erd.md` set above.

```mermaid
erDiagram
    carts ||--o{ cart_items : contains
    orders ||--o{ order_items : contains
    orders ||--o{ order_status_history : has
    orders ||--o{ payments : has
    payments ||--o{ refunds : has

    carts {
        uuid id PK
        uuid customer_id "nullable, -> customer.customers.id, unenforced"
        string guest_token UK "nullable — renamed from session_token"
        enum status "ACTIVE|CHECKOUT_STARTED|ABANDONED|CONVERTED|EXPIRED"
        timestamp expires_at "nullable"
    }
    cart_items {
        uuid id PK
        uuid cart_id FK
        uuid product_sku_id "UK with cart_id+configuration_hash, unenforced"
        int quantity
        bigint unit_price_snapshot
        string configuration_hash "default ''"
    }
    orders {
        uuid id PK
        string order_number UK
        uuid customer_id "-> customer.customers.id, unenforced"
        enum status "17-state lifecycle, see README"
        bigint subtotal
        bigint grand_total
        json shipping_address_snapshot
    }
    order_items {
        uuid id PK
        uuid order_id FK
        uuid product_sku_id "nullable, -> catalog.product_skus.id, unenforced"
        string sku_snapshot
        string name_snapshot
        bigint unit_price_snapshot
        int quantity
    }
    order_status_history {
        uuid id PK
        uuid order_id FK
        enum from_status "nullable"
        enum to_status
        uuid changed_by "nullable, -> identity.users.id, unenforced"
    }
    payments {
        uuid id PK
        uuid order_id FK
        string provider "adapter name, e.g. zarinpal"
        enum status "PENDING|PAID|FAILED|REFUNDED"
        bigint amount
        string idempotency_key UK "nullable"
    }
    refunds {
        uuid id PK
        uuid payment_id FK
        bigint amount
        enum status "PENDING|APPROVED|REJECTED|COMPLETED"
    }
```

`order_items` snapshots `sku`/`name`/`unit_price` at creation — an order's
totals never change because the live product changed later
("order ≠ live product", see [`README.md`](./README.md#conventions)).

**The `payments`/`refunds` tables shown above are the Phase 003 placeholder
shape and no longer exist** — Phase 008 dropped them and replaced them with
a real 7-table payment orchestration subtree keyed off `checkout_sessions`
rather than the non-existent `Order` flow. See
[`payment-erd.md`](./payment-erd.md) for the current, real shape; kept here
unedited only so this diagram still matches what earlier phases' own
diagrams referenced at the time they were written.

## marketing

```mermaid
erDiagram
    coupons ||--o{ coupon_redemptions : has
    promotions ||--o{ promotion_products : scopes

    coupons {
        uuid id PK
        string code UK
        enum type "PERCENTAGE|FIXED_AMOUNT"
        bigint value "basis points or Rial, per type"
        int usage_limit "nullable"
        int per_user_limit "nullable"
        boolean is_active
    }
    coupon_redemptions {
        uuid id PK
        uuid coupon_id FK
        uuid order_id "-> commerce.orders.id, unenforced"
        uuid customer_id "-> customer.customers.id, unenforced"
        bigint discount_amount
    }
    promotions {
        uuid id PK
        string name
        enum discount_type "PERCENTAGE|FIXED_AMOUNT"
        bigint discount_value
        timestamp starts_at
        timestamp ends_at
    }
    promotion_products {
        uuid promotion_id "PK, FK"
        uuid product_id PK "-> catalog.products.id, unenforced"
    }
    campaigns {
        uuid id PK
        string key UK
        enum channel "SMS|EMAIL|PUSH|IN_APP"
        enum status "DRAFT|SCHEDULED|RUNNING|COMPLETED|CANCELLED"
    }
```

`promotions` is a basic all-or-nothing discount scoped to specific products —
the full condition/rule engine (segment + category + cart-total conditions)
is deliberately out of scope for this pass. `campaigns` has no child tables
yet (no send-log — that's `notification.notification_logs`, correlated by
convention, not FK).

## cms

```mermaid
erDiagram
    pages ||--o{ page_sections : has
    menus ||--o{ menu_items : has
    menu_items ||--o{ menu_items : "parent/children"

    pages {
        uuid id PK
        string slug UK
        string title
        enum status "DRAFT|PUBLISHED|ARCHIVED"
    }
    page_sections {
        uuid id PK
        uuid page_id FK
        string type "Hero | ProductCarousel | Banner | ..."
        int sort_order
        json config
    }
    banners {
        uuid id PK
        string title
        string image_url
        string placement "HOME_HERO | CATEGORY_TOP | ..."
    }
    articles {
        uuid id PK
        string slug UK
        string title
        string content_html
        enum status
    }
    menus {
        uuid id PK
        string key UK "header | footer | ..."
    }
    menu_items {
        uuid id PK
        uuid menu_id FK
        uuid parent_id FK "nullable, self-reference"
        string label
        string url
    }
    faqs {
        uuid id PK
        string question
        string answer
        string category "nullable"
    }
```

`page_sections.config` (JSON) is the Section Builder — new section types are
data, not a migration or a frontend redeploy. `banners`/`articles`/`faqs`
have no parent table; each is independently admin-managed.

## finance

```mermaid
erDiagram
    invoices ||--o{ invoice_lines : has

    product_prices {
        uuid id PK
        uuid product_sku_id UK "-> catalog.product_skus.id, unenforced"
        bigint base_price
        bigint compare_at_price "nullable, Phase 005 — the was price"
        bigint cost_price "nullable"
        timestamp valid_from "nullable, Phase 005"
        timestamp valid_to "nullable, Phase 005"
    }
    price_history {
        uuid id PK
        uuid product_sku_id "-> catalog.product_skus.id, unenforced"
        bigint old_price "nullable"
        bigint new_price
        uuid changed_by "nullable, -> identity.users.id, unenforced"
    }
    invoices {
        uuid id PK
        uuid order_id UK "-> commerce.orders.id, unenforced"
        string invoice_number UK
        bigint grand_total
        string pdf_url "nullable"
    }
    invoice_lines {
        uuid id PK
        uuid invoice_id FK
        string description
        int quantity
        bigint unit_price
    }
```

Pricing is deliberately its own domain, not a column on `catalog.products` —
exactly one active `product_prices` row per SKU (Phase 005 — previously per
variant); every change is recorded in the append-only `price_history`,
never a silent overwrite. See `docs/database/catalog-erd.md` for the full
Phase 005 catalog schema this now keys off.

## notification

```mermaid
erDiagram
    notification_templates ||--o{ notification_logs : "sent via"

    notification_templates {
        uuid id PK
        string key UK "ORDER_CREATED | OTP | ..."
        enum channel "SMS|TELEGRAM|WHATSAPP|EMAIL|PUSH|IN_APP"
        string body "{{variable}} placeholders"
        boolean is_active
    }
    notification_logs {
        uuid id PK
        uuid template_id FK "nullable"
        enum channel
        string recipient
        uuid customer_id "nullable, -> customer.customers.id, unenforced"
        enum status "QUEUED|SENT|FAILED|DELIVERED"
        string provider_ref "nullable"
    }
    notification_preferences {
        uuid id PK
        uuid customer_id UK "-> customer.customers.id, unenforced"
        boolean sms_enabled
        boolean email_enabled
        boolean push_enabled
        boolean whatsapp_enabled
        boolean telegram_enabled
    }
```

`notification_preferences` — explicit per-channel opt-in, checked before
every send (defaults to enabled; no silent SMS to someone who disabled it).

## analytics

```mermaid
erDiagram
    analytics_events {
        uuid id PK
        string event_type "PRODUCT_VIEW | SEARCH | ADD_TO_CART | ..."
        uuid customer_id "nullable, -> customer.customers.id, unenforced"
        string session_id "nullable"
        uuid product_id "nullable, -> catalog.products.id, unenforced"
        uuid order_id "nullable, -> commerce.orders.id, unenforced"
        json metadata "nullable"
        timestamp occurred_at
    }
```

One generic, append-only event table rather than a bespoke table per event
type. Promote a specific `event_type` to its own structured table only once
it needs real relational querying beyond `metadata` filtering.

## system

```mermaid
erDiagram
    webhooks ||--o{ webhook_deliveries : has

    audit_logs {
        uuid id PK
        uuid actor_id "nullable, -> identity.users.id, unenforced"
        string actor_ip "nullable"
        string actor_device "nullable, -> identity.user_devices.id, unenforced"
        string action "PRODUCT_PRICE_CHANGED | ROLE_ASSIGNED | ..."
        string entity_type
        string entity_id
        json old_value "nullable"
        json new_value "nullable"
    }
    api_keys {
        uuid id PK
        string name
        string key_hash UK
        uuid owner_id "nullable"
        string[] scopes
        timestamp revoked_at "nullable"
    }
    webhooks {
        uuid id PK
        string url
        string secret
        string[] events
        boolean is_active
    }
    webhook_deliveries {
        uuid id PK
        uuid webhook_id FK
        string event
        json payload
        enum status "PENDING|SUCCESS|FAILED"
        int attempt
    }
    feature_flags {
        uuid id PK
        string key UK
        boolean is_enabled
    }
    settings {
        uuid id PK
        string key UK
        json value
    }
```

`audit_logs` is the append-only "who changed what" record (blueprint §54) —
every sensitive mutation across every schema should write one of these;
nothing is ever updated after insert. `settings.value` is JSON so each
setting's shape is whatever that setting needs, not a fixed column set.
