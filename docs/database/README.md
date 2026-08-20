# Database

Full domain/table rationale: [`docs/product/blueprint.md`](../product/blueprint.md)
§4, §57-§66. The actual Prisma project is `packages/database` — see that
package's `README.md` for setup/commands; this document is conventions,
architecture decisions, and operational strategy.

ERD: [`erd.md`](./erd.md) — one Mermaid diagram per schema plus a
cross-schema overview.

## Status

`schema.prisma` defines 88 models across the 11 schemas below, across five
applied migrations, each exercised end-to-end — migrate up, roll back,
re-apply — against a real local PostgreSQL, not just validated for syntax:

- `20260811181736_init_enterprise_foundation` (Phase 003) — the 63-model
  foundation: catalog/commerce/inventory/etc., plus a first pass at
  `identity` (users, sessions, OTP, roles/permissions, the join tables).
- `20260811192730_identity_rbac_devices_2fa` (Phase 004) — extends
  `identity` for real authn/authz: role inheritance (`roles.parent_id`),
  structured permissions (`permissions.module`/`action`), per-user
  allow/deny exceptions (`user_permission_overrides`), device tracking
  (`user_devices`), TOTP 2FA (`user_two_factor_credentials`), and identity
  security events (`security_events`) — plus `actor_device` on
  `system.audit_logs`. This migration is also the first one that had to
  backfill existing data (`permissions.module`/`action` on the four rows
  Phase 003's seed already created) rather than just add empty structure —
  see that migration's own header comment for the nullable-then-backfill
  pattern used.
- `20260812105606_catalog_merchandising_foundation` (Phase 005) — rewrites
  `catalog` for real product management/merchandising (brands, hierarchical
  categories, manual/dynamic collections, the full `Product` publication
  lifecycle, the `ProductVariant`/`ProductSku` split, storage-agnostic
  `Media`, localizable admin-defined attributes) and repoints
  `inventory.InventoryItem`/`commerce.CartItem`/`commerce.OrderItem`/
  `finance.ProductPrice`/`finance.PriceHistory` from `productVariantId` to
  `productSkuId`. Full detail:
  [`catalog-erd.md`](./catalog-erd.md) and
  [`docs/adr/ADR-005-catalog-architecture.md`](../adr/ADR-005-catalog-architecture.md).
  This migration carries data forward rather than dropping and recreating
  (nullable → backfill → NOT NULL throughout) — see its own header comment.
- `20260812180528_inventory_warehouse_ledger_foundation` (Phase 006) —
  completely rewrites `inventory` for real multi-warehouse stock management:
  `Warehouse`/`WarehouseLocation` (a warehouse needs ≥1 location to hold
  stock), `InventoryItem` re-keyed to `(productSkuId, warehouseId,
locationId)` with a full 7-bucket quantity model, `InventoryLedger`
  (append-only, replaces `InventoryTransaction`), `InventoryReservation`
  (idempotency-key-protected, replaces `StockReservation`), and four new
  tables (`InventoryThreshold`, `StockTransfer`/`StockTransferItem`,
  `InventoryAdjustment`, `StockCount`/`StockCountItem`). Full detail:
  [`inventory-erd.md`](./inventory-erd.md) and
  [`docs/adr/ADR-006-inventory-architecture.md`](../adr/ADR-006-inventory-architecture.md).
  Data-preserving (existing warehouse/inventory-item/transaction rows carried
  forward, mapped to the new movement-type vocabulary) — see its own header
  comment for the exact old→new mapping.
- `20260812225852_cart_checkout_pricing_foundation` (Phase 007) — extends
  `commerce` for real cart/checkout/pricing: `Cart`/`CartItem` extended
  (guest-token rename, configuration snapshot/hash), six new tables
  (`CartItemOption`, `CartPriceSnapshot`, `CartCoupon`,
  `CartShippingSelection`, `ShippingMethod`) and the entire
  `CheckoutSession`/`CheckoutAddress`/`CheckoutTotals`/
  `CheckoutValidationResult`/`CheckoutReservation` subtree. Full detail:
  [`cart-checkout-erd.md`](./cart-checkout-erd.md) and
  [`docs/adr/ADR-007-cart-checkout.md`](../adr/ADR-007-cart-checkout.md).
  Not data-preserving in the Phase 005/006 sense — 0 rows existed in
  `carts`/`cart_items` at authoring time (confirmed directly) — but the
  `guest_token` rename still uses `RENAME COLUMN` for semantic honesty; see
  its own header comment.
- `20260813000000_payment_orchestration_foundation` (Phase 008) — drops
  Phase 003's placeholder `commerce.Payment`/`Refund`/`PaymentStatus`/
  `RefundStatus` (keyed on the nonexistent `Order`, unusable) and replaces
  them with the real payment orchestration subtree: 5 new enums, 7 new
  tables (`PaymentProvider`, `PaymentIntent`, `PaymentAttempt`,
  `PaymentTransaction`, `PaymentCallback`, `Refund`,
  `ReconciliationRecord`). Full detail: [`payment-erd.md`](./payment-erd.md)
  and [`docs/adr/ADR-008-payment-orchestration.md`](../adr/ADR-008-payment-orchestration.md).
  Not data-preserving in the Phase 007 sense — 0 rows existed in the
  placeholder `payments`/`refunds` tables at authoring time (confirmed
  directly) — `down.sql` restores that exact placeholder shape; see its
  own header comment.
- `20260814000000_order_fulfillment_foundation` (Phase 009) — drops
  Phase 003's placeholder `commerce.Order`/`OrderItem`/
  `OrderStatusHistory`/`finance.Invoice`/`InvoiceLine` (a shared
  placeholder `OrderStatus` enum, no real payment link) and replaces
  them with the real subtree: 6 new enums, 9 new tables (`Order`,
  `OrderItem`, `OrderStatusHistory`, `Fulfillment`, `FulfillmentItem`,
  `Shipment`, `ShipmentEvent` in `commerce`; `Invoice`,
  `InvoiceItem` — renamed from `InvoiceLine` — in `finance`), plus two
  real Postgres sequences (`commerce.order_number_seq`,
  `finance.invoice_number_seq`) hand-added after the Prisma-generated
  DDL. Full detail: [`order-erd.md`](./order-erd.md) and
  [`docs/adr/ADR-009-order-fulfillment.md`](../adr/ADR-009-order-fulfillment.md).
  Not data-preserving in the Phase 008 sense — 0 rows existed in the
  placeholder `orders`/`invoices` tables at authoring time (confirmed
  directly) — `down.sql` restores that exact placeholder shape; see its
  own header comment.
- `20260819000000_promotion_pricing_foundation` (Phase 010) — drops
  Phase 003's placeholder `marketing.Coupon`/`Promotion`/
  `CouponRedemption`/`PromotionProduct` (a ruleless, all-or-nothing
  discount with no eligibility engine, no coupon lifecycle, no
  concurrency-safe redemption ledger) and replaces them with the real
  subtree: 6 new enums, `Promotion`/`PromotionRule`/`PromotionTarget`/
  `Coupon`/`CouponRedemption` in `marketing`, plus a new
  `commerce.order_promotions` immutable-snapshot table. Two hand-added
  Postgres `CHECK` constraints (`promotion_usage_within_limit`,
  `coupon_usage_within_limit`) back a real database-enforced usage-limit
  invariant — Prisma's schema DSL has no stable `@@check` support, same
  limitation item 8 above already documents for inventory. Full detail:
  [`promotion-erd.md`](./promotion-erd.md) and
  [`docs/adr/ADR-010-promotion-engine.md`](../adr/ADR-010-promotion-engine.md).
  Not data-preserving in the Phase 009 sense — 0 rows existed in the
  placeholder `coupons`/`promotions`/`coupon_redemptions`/
  `promotion_products` tables at authoring time (confirmed directly) —
  `down.sql` restores that exact placeholder shape; see its own header
  comment.
- `20260819120000_order_lifecycle_hardening` (Phase 011) — purely
  additive, no drops: `commerce.fulfillments.idempotency_key` (nullable
  `TEXT`, `UNIQUE` index — fulfillment-creation idempotency, ADR-011
  decision 2); `commerce.orders_payment_status_idx`/
  `orders_fulfillment_status_idx`/`orders_placed_at_idx` (three new
  `btree` indexes backing the new admin search/filter query patterns,
  ADR-011 decision 6); `commerce.shipments.tracking_number` gained a
  `UNIQUE` index (ADR-011 decision 5). Unlike every migration above,
  this one _is_ data-preserving in the ordinary sense — real rows already
  existed (`commerce.orders`: 108, `commerce.fulfillments`: 28,
  `commerce.shipments`: 10 at authoring time) — and one real pre-existing
  duplicate `tracking_number` value was found and resolved before the new
  `UNIQUE` index could be applied; see the migration file's own header
  comment for the exact remediation. Full detail:
  [`order-erd.md`](./order-erd.md) and
  [`docs/adr/ADR-011-order-lifecycle-hardening.md`](../adr/ADR-011-order-lifecycle-hardening.md).
- `20260820000000_returns_refunds_credit_notes` (Phase 012) — purely
  additive, no drops: `commerce.return_requests`/`return_items`/
  `return_status_history` (the new `ReturnRequest` aggregate), a
  nullable, real-FK `return_request_id` column on the existing
  `commerce.refunds` table plus a new `commerce.refund_lines` child
  table (every existing `refunds` column and row untouched — exactly one
  refund pathway still exists), and `finance.credit_notes`/
  `credit_note_lines` (a real, minimal credit-note lifecycle,
  `invoice_id` a real enforced FK, `Invoice` itself never mutated). Two
  new Postgres sequences (`commerce.return_number_seq`,
  `finance.credit_note_number_seq`), same technique as
  `order_number_seq`/`invoice_number_seq`. Full detail:
  [`return-erd.md`](./return-erd.md) and
  [`docs/adr/ADR-012-returns-refunds-credit-notes.md`](../adr/ADR-012-returns-refunds-credit-notes.md).
  Data-preserving in the ordinary sense — real rows already existed
  (`commerce.orders`: 545, `commerce.order_items`: 546,
  `commerce.refunds`: 78, `finance.invoices`: 545,
  `commerce.fulfillments`: 243 at authoring time) — round-tripped
  UP -> DOWN -> UP with row counts identical throughout, and `prisma
migrate diff` against a fresh shadow database confirming zero drift in
  both directions (live vs. shadow, shadow vs. `schema.prisma`). A real
  schema-authoring bug was caught this way: `prisma format` kept
  silently reintroducing a `commerce -> finance` FK via a stray
  `ReturnRequest.creditNotes` back-relation this schema's own
  unenforced-cross-schema convention rules out — see the migration
  file's own header comment and `return-erd.md`'s "Key design
  decisions" for the fix.

This is **not** full coverage of blueprint §57's eventual table list. See
["Deliberately out of scope"](#deliberately-out-of-scope) below for exactly
what's missing and why it was left out of this pass rather than rushed.

## Schemas

`identity`, `customer`, `catalog`, `commerce`, `inventory`, `marketing`,
`cms`, `finance`, `notification`, `analytics`, `system` — one PostgreSQL
schema per business domain, via Prisma's `multiSchema` (GA since Prisma 6,
no `previewFeatures` flag needed; `@@schema("domain_name")` per model). Full
entity list and relationships: [`erd.md`](./erd.md).

This is a deliberately smaller list than the 14-schema version from Phase
001's placeholder scaffolding (`procurement`, `retail`, `crm`,
`communication` are gone) — folded into what exists (`communication` →
`notification`) or deferred entirely (`procurement`, `retail` — see
below) once real entities had to be designed rather than named.

## Conventions

1. **UUID primary keys** everywhere (`@default(uuid()) @db.Uuid`), never a
   bare auto-increment `id`.
2. **Money is always `BigInt`** (Rial, integer) — never `Float`, anywhere,
   for any amount. Floating-point currency is a correctness bug waiting to
   happen, not a style preference.
3. **Audit fields follow the entity's actual nature, not a blanket rule** —
   three tiers, applied consistently across every schema:
   - **Lifecycle entities** (created, edited, eventually soft-deleted by a
     human — e.g. `Product`, `Customer`, `Order`) get the full
     `createdAt` / `updatedAt` / `deletedAt` trio.
   - **Append-only records** (a fact captured once, never edited — e.g.
     `InventoryLedger`, `LoyaltyTransaction`, `AuditLog`) get
     `createdAt` only. A fabricated `updatedAt`/`deletedAt` on an immutable
     log row would be actively misleading, not extra rigor — nothing ever
     updates or deletes one, so those columns would always read as "never".
   - **Pure join tables** (`UserRole`, `RolePermission`, ...) get a
     composite PK and `createdAt` only.
   - Beyond the trio, `system.AuditLog` (blueprint §54) is the substantive
     "who changed what" record — every sensitive mutation across every
     domain should write one row there, on top of whatever timestamps its
     own table has.
4. **Snake_case in PostgreSQL, PascalCase/camelCase in Prisma** — `@@map`/
   `@map` throughout; the TypeScript-facing model/field names never leak
   into SQL and vice versa.
5. **Migrations only** — nobody hand-edits schema with a manual
   `ALTER TABLE`. `pnpm --filter @iecp/database migrate:dev` /
   `migrate:deploy` / `migrate:rollback`. See ["Migrations"](#migrations).
6. **Prisma is the only DB client** — no service opens its own `pg`/raw
   connection; everything imports `prisma` from `@iecp/database`.
7. **Order ≠ live product** (blueprint §17/§25) — `commerce.OrderItem`
   snapshots `sku`/`name`/`unit_price` at creation. An order's totals never
   silently change because the product it references was later repriced,
   renamed, or deleted.
8. **Stock is a ledger, not a mutable counter** (blueprint §24/§27) —
   `inventory.InventoryLedger` is append-only (Phase 006 — see
   [`inventory-erd.md`](./inventory-erd.md)) and is the source of truth for
   _why_ `InventoryItem`'s quantity buckets are what they are; those columns
   are a maintained cache, never edited directly, and
   `available_quantity >= 0` is enforced transactionally rather than by a
   database constraint (Prisma has no `@@check(...)` support).

## Cross-schema references are intentionally unenforced

Every `FOREIGN KEY` constraint in this schema is intra-schema — you'll never
see a Postgres FK from, say, `commerce.orders` to `customer.customers`.
Cross-domain references (`orders.customer_id`,
`inventory_items.product_variant_id`, `notification_logs.customer_id`, ...)
exist as plain `uuid` columns instead.

This is a deliberate choice, not a Prisma or Postgres limitation — verified
directly: Prisma's `multiSchema` fully supports declaring a `@relation`
across two models in different `@@schema`s, and it generates a real,
working, enforced cross-schema `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN
KEY` in Postgres. The capability is there; it's not used across schema
boundaries here because:

- **Each domain schema should be reason-about-able on its own.** A
  reviewer or a future service reading `catalog`'s DDL shouldn't need
  `commerce`'s tables to exist to understand `catalog`'s own referential
  integrity.
- **It keeps a future schema-per-service split honest.** If `inventory`
  ever needs to move to its own database, a hard cross-schema FK from
  `commerce` into it would have to be found and removed first. No such FK
  existing means that migration is additive, not a breaking hunt through
  constraint dependencies.
- **Referential integrity across domains is an application-layer
  concern.** The domain that owns the referenced row (e.g. `customer` for
  `Customer`) is responsible for that invariant; a service in `commerce`
  should not be able to violate a `customer` invariant just by holding a
  database connection with `DELETE` rights on `customer` tables.

The trade-off is explicit: nothing at the database level stops
`commerce.orders.customer_id` from pointing at a `customer_id` that no
longer exists. That's intentional, not an oversight — application code
(service-layer validation, and in the fullness of time, outbox-pattern
consistency checks) owns that invariant instead. Every such reference is
called out on its table in [`erd.md`](./erd.md) as `-> schema.table.column,
unenforced`.

## Roles & least privilege

Two Postgres roles (`infrastructure/postgres/init/02-roles.sql`):

- **`iecp_migrator`** — owns the schema, runs `prisma migrate`/`prisma db
push`. Full DDL on every domain schema plus `public` (Prisma's own
  `_prisma_migrations` bookkeeping table lives there regardless of how many
  domain schemas the data model uses). Nothing at runtime uses this role —
  only migration/seed/backup tooling.
- **`iecp_app`** — used by every running service. `SELECT`/`INSERT`/
  `UPDATE`/`DELETE` only: no `CREATE`, `ALTER`, `DROP`, and no ability to
  grant privileges to anyone else. `ALTER DEFAULT PRIVILEGES` ensures
  tables created by a _future_ migration are automatically grantable to
  `iecp_app` too — nobody has to remember to re-run a grant by hand after
  every migration.

Verified empirically, not just by reading the grants: `iecp_app` was
confirmed unable to run DDL (raw `psql`) and confirmed able to run the full
Prisma-generated CRUD + the seed script (`prisma/seed.ts`) end-to-end.

**Local dev only right now** — the passwords in `02-roles.sql` are local
defaults, never meant to be reused anywhere real. A real environment needs
a secrets manager, environment-specific credentials, and rotation; none of
that exists yet since there's no managed cloud database target chosen (see
`docs/deployment/README.md`).

## Migrations

```bash
pnpm --filter @iecp/database migrate:dev       # dev: create + apply a new migration
pnpm --filter @iecp/database migrate:deploy    # apply pending migrations (CI/prod)
pnpm --filter @iecp/database migrate:rollback -- <migration_name>
```

Prisma has no built-in down-migration. Rollback here works by hand-pairing
every migration with a `down.sql` generated via `prisma migrate diff`, and
`scripts/db-rollback.sh` (`packages/database/scripts/db-rollback.sh`)
applies it, then removes the migration's row from `_prisma_migrations`
directly — `prisma migrate resolve --rolled-back` was tried first and
rejected with `P3012`, because that command only accepts a migration Prisma
itself marked "failed" (a partial `migrate deploy`), not one that finished
successfully and is now being undone by hand. See the comments at the top
of `db-rollback.sh` and each migration's own `down.sql` for the full
detail, including the one caveat the `--to-empty` diff recipe carried at
Phase 003: it was only valid for a single-migration history
(undo-the-last-migration and undo-everything were the same operation).
That stopped being true once Phase 004 landed a second migration —
`down.sql` for `20260811192730_identity_rbac_devices_2fa` and
`20260812105606_catalog_merchandising_foundation` (Phase 005) were each
hand-authored to diff against the _previous_ migration's state, not empty,
and each was verified independently.

Tested end-to-end at every phase: migrate up → verify the schema → roll
back → verify the previous schema → re-apply → verify again, against a
real local PostgreSQL:

- Phase 003: 63 tables across 11 schemas, round-tripped twice.
- Phase 004: identity's RBAC/device/2FA/security-event additions,
  round-tripped once, `prisma migrate diff` confirming zero drift at each
  step.
- Phase 005: the 71-model `catalog` rewrite (8 new/changed tables, 5
  cross-schema column repoints), round-tripped once — up → down → up —
  with `prisma migrate diff` confirming zero drift at each step and seed
  data intact after the round trip. Two real bugs were caught this way,
  not by reading the SQL: `down.sql` initially tried to drop `catalog.media`
  before the FK constraints referencing it were dropped, and initially
  didn't recreate `products_status_idx` after restoring the old-typed
  `status` column — see that migration's own `down.sql` header comment.
- Phase 006: the `inventory` rewrite (11 tables, replacing Phase 003's
  3-table placeholder shape), round-tripped once — up → down → up — with
  `prisma migrate diff` confirming zero drift at each step, Phase 005's
  catalog seed data (18 products, 1 brand, 6 SKUs) confirmed intact
  throughout, and the seed re-run 3 times confirming idempotency after the
  round trip. Two real bugs were caught this way: `stock_counts_location_id_fkey`
  needed `ON DELETE SET NULL` (Prisma's default for that relation shape),
  not the `RESTRICT` the migration initially wrote, and `down.sql`'s
  collapse queries needed `MIN(id::text)::uuid` — Postgres has no `MIN(uuid)`
  aggregate — with the cast placed outside the `OVER(...)` window clause, not
  inside it. See that migration's own `down.sql` header comment.
- Phase 007: the `commerce` cart/checkout extension (10 new tables +
  `Cart`/`CartItem` extended), round-tripped **twice** — up → down → up,
  repeated a second time to confirm reproducibility after fixing an
  enum-reapply bug — with `prisma migrate diff` confirming zero drift at
  every step and `catalog.products`/`inventory.warehouses` row counts
  confirmed intact throughout both rounds. One real bug caught this way:
  `CartStatus`'s two new enum values (`CHECKOUT_STARTED`, `EXPIRED`) can't
  be removed by `down.sql` (Postgres has no `ALTER TYPE ... DROP VALUE`),
  so a bare `ADD VALUE` on reapply failed with "enum label already
  exists" — fixed by wrapping each `ADD VALUE` in a
  `DO $$ ... IF NOT EXISTS ... $$` guard. See that migration's own header
  comment.
- Phase 008: the `commerce` payment orchestration addition (5 new enums,
  7 new tables, replacing Phase 003's 2-table placeholder shape),
  round-tripped once — up → down → up — with `prisma migrate diff`
  confirming zero drift at every step and `catalog.products`/
  `inventory.warehouses`/`commerce.checkout_sessions` row counts confirmed
  intact throughout. The rollback restores the exact Phase 003 placeholder
  `payments`/`refunds` shape (0 rows either way), so the round trip is
  reproducible regardless of how many times it repeats. See
  [`payment-erd.md`](./payment-erd.md)'s own "Migration" section.
- Phase 009: the order/fulfillment/shipment addition to `commerce` plus
  the invoice addition to `finance` (6 new enums, 9 new tables,
  replacing Phase 003's placeholder `Order`/`OrderItem`/
  `OrderStatusHistory`/`Invoice`/`InvoiceLine`), round-tripped once — up
  → down → up — with `prisma migrate diff` confirming zero drift at
  every step and `catalog.products`/`inventory.warehouses`/
  `commerce.carts`/`commerce.checkout_sessions`/`identity.users`/
  `commerce.payment_intents`/`commerce.payment_transactions` row counts
  confirmed intact throughout. The rollback restores the exact Phase 003
  placeholder `orders`/`invoices` shape (0 rows either way), so the
  round trip is reproducible regardless of how many times it repeats.
  See [`order-erd.md`](./order-erd.md)'s own "Migration" section.
- Phase 010: the promotion/coupon engine addition to `marketing` plus
  the `order_promotions` snapshot addition to `commerce` (6 new enums,
  5 new tables, replacing Phase 003's placeholder `Coupon`/`Promotion`/
  `CouponRedemption`/`PromotionProduct`), round-tripped **twice** — up →
  down → up, repeated a second time after an unrelated environment
  rebuild — with `prisma migrate diff` confirming zero drift at every
  step and `catalog.products`/`inventory.warehouses`/`commerce.carts`/
  `commerce.checkout_sessions`/`commerce.orders`/payment intent/
  transaction row counts confirmed intact throughout both rounds. The
  rollback restores the exact Phase 003 placeholder `coupons`/
  `promotions`/`coupon_redemptions`/`promotion_products` shape (0 rows
  either way). See [`promotion-erd.md`](./promotion-erd.md)'s own
  "Migration" section.
- Phase 011: purely additive hardening on `commerce`
  (`fulfillments.idempotency_key`, three `orders` indexes,
  `shipments.tracking_number` UNIQUE) — no table drops, nothing to
  replace. Round-tripped — up → down → up — against the live dev
  database with real accumulated data (440 `commerce.orders`, 189
  `commerce.fulfillments`, 89 `commerce.shipments` at round-trip time),
  row counts confirmed identical before rollback, after rollback, and
  after reapplying; `prisma migrate status` reported "up to date" after.
  See [`order-erd.md`](./order-erd.md)'s own "Migration" section.
- Phase 012: purely additive (`commerce.return_requests`/`return_items`/
  `return_status_history`, `commerce.refunds.return_request_id` +
  `commerce.refund_lines`, `finance.credit_notes`/`credit_note_lines`)
  — no table drops, nothing to replace. Round-tripped — up -> down -> up
  — against the live dev database with real accumulated data
  (`commerce.orders`: 545, `commerce.order_items`: 546,
  `commerce.refunds`: 78, `finance.invoices`: 545,
  `commerce.fulfillments`: 243 at authoring time), row counts confirmed
  identical throughout, and `prisma migrate diff` against a fresh shadow
  database confirming zero drift in both directions (live vs. shadow,
  shadow vs. `schema.prisma`) — not merely a syntax check. See
  [`return-erd.md`](./return-erd.md)'s own "Migration" section.

## Seeding

```bash
pnpm --filter @iecp/database seed
```

`prisma/seed.ts` walks one coherent slice through every schema — an admin
user and a demo customer (identity/customer), 57 real RBAC permissions
across identity/catalog/inventory/payment/order with 12 roles including a
deny-override (identity), three products including two
priced/published/stocked SKUs — one with a catalog-level discount
(catalog/finance), two warehouses/three locations with real stock, two
reservations, a low-stock example, and a transfer (inventory), a coupon
(marketing), two shipping methods + pricing settings + an active customer
cart + a guest cart + a checkout-ready fixture with a real reservation + an
expired checkout (commerce, Phase 007), a ZarinPal payment provider + three
payment-intent chains covering a verified success with a partial refund, a
verified-but-mismatched failure, and an unresolved reconciliation finding
(commerce, Phase 008), four order fixtures covering paid/unpaid/cancelled/
fulfilled — including a real DELIVERED fulfillment + shipment + tracking
history and three issued invoices (commerce/finance, Phase 009), three
promotions (percentage/fixed-amount/automatic-free-shipping) and five
coupons covering active/expired/future/single-use fixtures, two new
RBAC roles (`promotion_manager`/`promotion_editor`) (marketing, Phase
010), a home page/menu/FAQ (cms), notification templates + the demo
customer's channel preferences (notification), a feature flag + two
settings (system), two full-lifecycle COMPLETED return fixtures against
the FULFILLED order — one REFUND-resolution with a real `Refund` +
`RefundLine`, one CREDIT_NOTE-resolution with a real ISSUED
`CreditNote` — plus 9 new `return.*`/`credit_note.*` permissions and two
new RBAC roles (`returns_manager`/`returns_clerk`) (commerce/finance,
Phase 012). Idempotent throughout (`upsert`, keyed on each
model's real unique constraint, or a `findUnique`-then-create guard
where no natural unique key exists) — safe to run against a
freshly-migrated database or one that already has this data. Verified
idempotent (ran repeatedly across Phases 006-012, row counts unchanged)
and verified runnable under `iecp_app`
alone — the seed only needs DML, confirming the least-privilege role is
sufficient for real application-style writes, not just raw `psql`.

## Backup/restore

Scripts: `infrastructure/postgres/scripts/backup.sh` and `restore.sh` — see
that directory's `README.md` for usage. Both were run for real against the
local database while building this: a full `pg_dump -Fc` backup, restored
into a separate `iecp_restore_drill` database (not the real one), verified
table count (63) and spot-checked actual row data (`WELCOME10` coupon,
2 users) matched the source, then the drill database was dropped.

This covers the **"Daily Full Backup"** leg of blueprint §101's four-part
strategy:

```text
Daily Full Backup   ✅ scripted + tested (backup.sh / restore.sh)
Hourly WAL           ⬜ needs archive_mode/archive_command on a real Postgres
                        server config — not applicable to the ad-hoc local
                        instance this phase was built against
PITR                 ⬜ depends on WAL archiving above being in place first
Offsite Backup       ⬜ depends on a chosen storage target (S3-compatible or
                        similar) — no managed cloud target chosen yet
```

Target RPO/RTO (blueprint §101): **< 1 hour / < 4 hours** to start,
tightening to **< 15 min / < 1 hour** for production — both require the WAL/
PITR/offsite legs above, which is why they're marked not-yet-done rather
than silently assumed. `pg_dump`-based backups alone bound RPO to "how often
you run backup.sh", which is a cron-job decision for whatever host actually
runs Postgres in each environment — not something this repo can commit to
without knowing that host.

## Deliberately out of scope

Left out of this foundation pass, on purpose, rather than rushed to hit
every table in blueprint §57:

- **Procurement / supplier management** — no `procurement` schema. Phase 006
  gave `inventory` real receiving/quarantine vocabulary
  (`PURCHASE_RECEIPT`/`RETURN_RECEIPT`/`QUARANTINE`/
  `RELEASE_FROM_QUARANTINE` movement types with polymorphic
  `referenceType`/`referenceId`) a future procurement/returns phase can
  write against, but no supplier/purchase-order tables exist yet — see
  `docs/adr/ADR-006-inventory-architecture.md` decision 9.
- **Retail / POS / in-store appointments** — no `retail` schema. The
  blueprint's omnichannel ambitions (§29-§31) are real, but nothing in the
  online-commerce path needs them yet.
- **Full promotion rule engine** — `marketing.Promotion` today is a basic
  all-or-nothing percentage/fixed discount scoped to specific products.
  Segment + category + cart-total _conditions_ (blueprint §14) are not
  modeled.
- **Complete lens configuration/compatibility/pricing engine** —
  `catalog.LensType`/`LensCoating` are minimal lookup tables, not linked to
  anything yet. Blueprint §13's full index/coating combination and pricing
  rules are future work.
- **OAuth/social login (`oauth_accounts`)** — blueprint §5 lists it, §56
  says "Google/Apple where applicable"; Phase 004's `authentication.methods`
  spec didn't ask for it, so it's not modeled. Adding it later is additive
  (a new table + provider adapters), not a redesign of anything Phase 004
  built.
- **`user_credentials` as its own table** — Phase 003 already put
  `password_hash` directly on `users`, and Phase 004 kept that rather than
  splitting credentials into blueprint §5's separate table. One user, one
  password, no per-credential metadata (multiple password history entries,
  per-credential expiry, ...) that would justify the extra join yet.

Each of these gets its own schema design pass once the feature that needs
it is actually being built — not invented speculatively now.

## Search

PostgreSQL full-text search first; OpenSearch is provisioned in
`infrastructure/docker/docker-compose.yml` but nothing indexes into it yet
(blueprint §63). When that's wired, PostgreSQL stays the source of truth —
the index is rebuilt from DB change events, never written to directly.
