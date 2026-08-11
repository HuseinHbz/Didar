# Database

Full domain/table rationale: [`docs/product/blueprint.md`](../product/blueprint.md)
§4, §57-§66. The actual Prisma project is `packages/database` — see that
package's `README.md` first; this document is about conventions and status, not
setup commands.

## ⚠️ Status: conventions proven, ERD not designed yet

`packages/database/prisma/schema.prisma` has exactly one model (`User`,
placeholder). The full ERD — every table, column, type, PK/FK, index, unique
constraint, enum, and relation across all 14 domain schemas — is explicitly
**Phase 1** work (see blueprint, "وضعیت فعلی" section), done deliberately as its
own pass rather than improvised while scaffolding the repo. Nothing here should be
read as "the schema", only as "the rules the schema will follow".

## Decisions already made (load-bearing, not placeholder)

1. **One PostgreSQL database, 14 domain-based schemas**, not one flat namespace —
   `identity`, `customer`, `catalog`, `commerce`, `inventory`, `procurement`,
   `retail`, `crm`, `marketing`, `cms`, `finance`, `communication`, `analytics`,
   `system`. Implemented via Prisma's `multiSchema` preview feature
   (`@@schema("domain_name")` per model).
2. **UUID primary keys** everywhere (`@default(uuid()) @db.Uuid`), never a bare
   auto-increment `id`.
3. **Audit timestamps** on every model: `createdAt`/`updatedAt`
   (`@default(now())` / `@updatedAt`), mapped to `created_at`/`updated_at`.
4. **Soft delete** (`deletedAt DateTime? @map("deleted_at")`) on anything user- or
   business-facing; physical deletes stay reserved for controlled cases.
5. **Snake_case table names** via `@@map(...)` — Prisma model names stay
   PascalCase in TypeScript, the actual SQL table is `snake_case`.
6. **Migrations only** — nobody hand-edits production schema with a manual
   `ALTER TABLE`. `pnpm --filter @iecp/database migrate:dev` /
   `migrate:deploy`.
7. **Prisma is the only DB client** — no service opens its own `pg`/raw connection;
   everything imports `prisma` from `@iecp/database`.

## What Phase 1 needs to answer (not yet)

- Every table in blueprint §57's list, fully typed.
- Index strategy (which FKs get an index, which columns need composite indexes for
  the filter/search patterns in blueprint §16-§17).
- The exact `order_status_history`/`inventory_transactions` ledger shapes
  (blueprint §19/§24 already specify the *values*, not the *columns*).
- Migration + seed strategy for the full model (blueprint §106-§107).
- Whether `multiSchema` FKs across schemas (e.g. an `order` in `commerce`
  referencing a `customer` in `customer`) behave the way early testing assumed —
  verify this early in Phase 1, since it's a foundational assumption the whole
  domain-schema split depends on.

## Search

PostgreSQL full-text search first; OpenSearch is provisioned in
`infrastructure/docker/docker-compose.yml` but nothing indexes into it yet
(blueprint §63). When that's wired, PostgreSQL stays the source of truth — the
index is rebuilt from DB change events, never written to directly.
