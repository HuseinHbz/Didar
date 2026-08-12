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
    catalog -. "product_prices.product_variant_id" .-> finance
    catalog -. "price_history.product_variant_id" .-> finance
    catalog -. "inventory_items.product_variant_id" .-> inventory
    catalog -. "cart_items/order_items.product_variant_id" .-> commerce
    commerce -. "invoices.order_id" .-> finance
    commerce -. "stock_reservations.order_id" .-> inventory
    commerce -. "coupon_redemptions.order_id/customer_id" .-> marketing
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

```mermaid
erDiagram
    brands ||--o{ products : has
    categories ||--o{ products : has
    categories ||--o{ categories : "parent/children"
    products ||--o{ product_variants : has
    products ||--o{ product_images : has
    product_variants ||--o{ product_images : has
    product_attributes ||--o{ product_attribute_values : has
    product_variants ||--o{ product_variant_attribute_values : has
    product_attribute_values ||--o{ product_variant_attribute_values : has

    brands {
        uuid id PK
        string name UK
        string slug UK
    }
    categories {
        uuid id PK
        uuid parent_id FK "nullable, self-reference"
        string name
        string slug UK
        int sort_order
    }
    products {
        uuid id PK
        uuid brand_id FK
        uuid category_id FK
        string sku UK
        string name
        string slug UK
        enum gender "nullable: MALE|FEMALE|UNISEX|KIDS"
        enum status "DRAFT|ACTIVE|ARCHIVED"
    }
    product_variants {
        uuid id PK
        uuid product_id FK
        string sku UK
        string barcode UK "nullable"
        string color "nullable"
        string size "nullable"
        boolean is_default
        enum status
    }
    product_attributes {
        uuid id PK
        string key UK "e.g. frame_shape"
        string name "e.g. شکل فریم"
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
    product_images {
        uuid id PK
        uuid product_id FK
        uuid variant_id FK "nullable"
        string url
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

```mermaid
erDiagram
    warehouses ||--o{ inventory_items : stocks
    inventory_items ||--o{ inventory_transactions : has
    inventory_items ||--o{ stock_reservations : has

    warehouses {
        uuid id PK
        string code UK
        string name
        boolean is_active
    }
    inventory_items {
        uuid id PK
        uuid warehouse_id FK
        uuid product_variant_id UK "-> catalog.product_variants.id, unenforced"
        int quantity_on_hand "cache of inventory_transactions sum"
        int quantity_reserved
        int reorder_point "nullable"
    }
    inventory_transactions {
        uuid id PK
        uuid inventory_item_id FK
        enum type "PURCHASE|SALE|RESERVATION|RELEASE|TRANSFER_OUT|TRANSFER_IN|DAMAGE|ADJUSTMENT|RETURN|COUNT_ADJUSTMENT"
        int quantity_delta
        string reference "nullable, polymorphic (e.g. an order id)"
    }
    stock_reservations {
        uuid id PK
        uuid inventory_item_id FK
        uuid order_id "nullable, -> commerce.orders.id, unenforced"
        int quantity
        enum status "ACTIVE|RELEASED|CONSUMED"
        timestamp expires_at "nullable"
    }
```

Composite unique constraint `(warehouse_id, product_variant_id)` on
`inventory_items` — one stock row per variant per warehouse.
`inventory_transactions` is the append-only ledger;
`inventory_items.quantity_on_hand` is a maintained cache, never the source
of truth.

## commerce

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
        string session_token UK "nullable"
        enum status "ACTIVE|CONVERTED|ABANDONED"
    }
    cart_items {
        uuid id PK
        uuid cart_id FK
        uuid product_variant_id "-> catalog.product_variants.id, unenforced"
        int quantity
        bigint unit_price_snapshot
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
        uuid product_variant_id "nullable, -> catalog.product_variants.id, unenforced"
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
        uuid product_variant_id UK "-> catalog.product_variants.id, unenforced"
        bigint base_price
        bigint cost_price "nullable"
    }
    price_history {
        uuid id PK
        uuid product_variant_id "-> catalog.product_variants.id, unenforced"
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
exactly one active `product_prices` row per variant; every change is
recorded in the append-only `price_history`, never a silent overwrite.

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
