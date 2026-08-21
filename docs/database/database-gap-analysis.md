# Database gap analysis — Phase 014 audit

Companion to [`docs/roadmap/master-roadmap-audit.md`](../roadmap/master-roadmap-audit.md)
§5. `schema.prisma`: 153 models, 11 `@@schema`-tagged Postgres schemas.

## What is real and strong, verified

- **Financial integrity for every built domain is enforced at the
  database layer, not trusted from application code.** `InventoryLedger`
  is append-only and the sole source of truth for stock movements
  (`InventoryItem`'s quantity buckets are an explicitly documented
  maintained cache, never authoritative). `Refund`, `CreditNote`, and
  `ReturnSettlement` transitions all go through `SELECT ... FOR UPDATE`
  row locks or single-statement atomic claims (`UPDATE ... WHERE col IS
NULL RETURNING id`) — verified present in the Phase 013 code, proven
  under real concurrency (10 named PostgreSQL proofs + 5 crash-window
  failure-injection tests, per that phase's own final report).
- **Money is `BigInt` Rial everywhere**, no floating-point currency field
  found anywhere in the schema.
- **Every migration for a built domain ships a hand-authored `down.sql`**,
  and every phase's final report documents a real UP→DOWN→UP-plus-fresh-
  shadow-DB round trip — this was independently re-verified for Phase 013
  in the same session that built it, including catching a real historical-
  data backfill need by booting against accumulated dev data (18 duplicate
  ledger rows found and fixed), not merely inspecting the migration file.
- **Least-privilege roles** (`iecp_migrator` for DDL, `iecp_app` for DML
  only) — CI's own `test` job deliberately runs the e2e suite under
  `iecp_app`, specifically so a test that only passes with migrator's
  extra rights can't mask a real deployment bug. This is a genuinely good
  practice, correctly enforced by the pipeline itself, not just documented.
- **Seed idempotency** — every phase's seed additions are guarded
  (`findUnique`-before-create or equivalent), and CI re-runs `seed` after
  `migrate deploy` specifically as a drift regression check, not merely a
  fixtures step.

## Gaps

### D1 — ~40% of the schema has zero application code (MEDIUM, see product-gap-analysis for the business framing)

Confirmed by cross-referencing every model in `customer`, `cms`,
`marketing.Campaign`, and `analytics` against `services/api/src` — zero
references found for `FamilyMember`, `LoyaltyAccount`/`LoyaltyTransaction`,
`WalletAccount`/`WalletTransaction`, `CustomerSegment`/
`CustomerSegmentMember`, every `cms.*` model, `marketing.Campaign`
(distinct from `cms.Campaign` — two same-named models in different
schemas, both unused), and `analytics.AnalyticsEvent`. This is not
incorrect schema design — Phase 003 deliberately modeled the entire
blueprint's data shape up front — but it means the ERD, migrations, and
seed script all carry real weight for zero present business value, and
every future phase touching these schemas inherits whatever assumptions
Phase 003 made 10 phases ago without them ever having been exercised by
real code.

### D2 — No `Prescription` model exists anywhere in the schema (HIGH — see risk register R5)

The category-defining domain concept for an eyewear commerce platform has
no database representation at all — only a standalone Zod value-range
validator in `packages/validation`, explicitly not tied to any table,
order, or customer record.

### D3 — No Purchase Order / Supplier model (MEDIUM — see risk register R8)

Blueprint PHASE 4 (Inventory) names both explicitly; inventory's own
schema (19 models) covers warehouses, locations, ledger, transfers,
adjustments, and stock counts, but not procurement.

### D4 — Two same-named, unrelated models across schemas (`cms.Campaign` vs `marketing.Campaign`) — both currently unused (LOW)

Not a conflict today (Prisma schema-qualifies them, no ambiguity at the
ORM level), but worth resolving — likely one supersedes the other's
intended purpose — before either is ever built out, to avoid two teams
independently building "Campaign" features against different tables.

### D5 — Migration-drift verification (`prisma migrate diff`) has only ever been run against this sandbox's accumulated dev database, never against a byte-for-byte fresh database matching what CI provisions (LOW)

Every phase's "zero drift confirmed" claim is real and was actually run —
but always in this same long-lived sandbox Postgres instance. CI itself
does run `prisma migrate deploy` against a fresh `postgres:17-alpine`
container every time, which is a genuine independent verification — but
no artifact from an actual CI run was available to this audit to confirm
it has ever succeeded end-to-end for Phases 003–011 (Gate 1's merge in
the critical path will produce the first such artifact for 012/013).

## Verification performed this audit (not carried forward from claims)

- `prisma migrate status` / `prisma migrate diff --from-schema-datasource
... --to-schema-datamodel ...` were **not** re-run in this audit (no
  source changes were made, and re-running them against the sandbox's
  long-lived dev database would not add evidence beyond what Phase 013's
  own validation gate already established for the state at that time).
  This audit's own validation gate (§ below in the final report) re-runs
  the structure/format/lint/typecheck/build/test suite, which is the
  audit-appropriate subset per the brief.
