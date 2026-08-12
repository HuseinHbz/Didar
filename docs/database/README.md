# Database

Full domain/table rationale: [`docs/product/blueprint.md`](../product/blueprint.md)
§4, §57-§66. The actual Prisma project is `packages/database` — see that
package's `README.md` for setup/commands; this document is conventions,
architecture decisions, and operational strategy.

ERD: [`erd.md`](./erd.md) — one Mermaid diagram per schema plus a
cross-schema overview.

## Status

`schema.prisma` defines 78 models across the 11 schemas below, across four
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

## Seeding

```bash
pnpm --filter @iecp/database seed
```

`prisma/seed.ts` walks one coherent slice through every schema — an admin
user and a demo customer (identity/customer), 38 real RBAC permissions
across identity/catalog/inventory with 8 roles including a deny-override
(identity), two products including one priced, published, stocked SKU
(catalog/finance), two warehouses/three locations with real stock, a
reservation, a low-stock example, and a transfer (inventory), a coupon
(marketing), a home page/menu/FAQ (cms), notification templates + the demo
customer's channel preferences (notification), and a feature flag + a
setting (system). Idempotent throughout (`upsert`, keyed on each model's
real unique constraint) — safe to run against a freshly-migrated database or
one that already has this data. Verified idempotent (ran three times across
Phase 006, row counts unchanged) and verified runnable under `iecp_app`
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
