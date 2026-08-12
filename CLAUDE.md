# Didar — IECP (Iran Eyewear Commerce Platform)

**Full product/architecture blueprint: [`docs/product/blueprint.md`](docs/product/blueprint.md) — read it before making
architectural decisions.** This file is a compressed summary for quick orientation; the blueprint is the source of truth
for anything not covered here.

## Positioning

This is **not** an Iranian clone of Lenskart. Lenskart is the _benchmark_, not the spec. The product is an
**Iranian Eyewear Commerce Platform (IECP)** — an enterprise-grade commerce platform (catalog + CMS + CRM +
inventory + POS + loyalty + marketing + AI + mobile + PWA + notifications + analytics) that must exceed Lenskart
specifically in: ERP-like operations, multi-warehouse inventory, CRM, loyalty, CMS, Iranian localization
(payments/SMS/invoicing/tax), notifications (SMS/Telegram/WhatsApp as adapters), POS, and backend architecture.

## The one non-negotiable architecture rule

**No business-critical data is ever hardcoded in frontend code.** No `const products = [...]`, no
`const categories = [...]`, no `const menuItems = [...]`. Every product, category, brand, price, discount,
banner, menu, page, campaign, filter, attribute — everything business- or content-related — lives in
PostgreSQL and reaches clients only through the API:

```
Frontend → API → Service Layer → PostgreSQL
Admin → CMS → PostgreSQL → API → Web / Android / PWA
```

PostgreSQL is the **single source of truth**. Redis is cache/session/queue/rate-limit only — never a source of
truth; if it's flushed, the system keeps working (just slower). Application code (services, business logic) is
_code_, not data — don't confuse "everything from the database" with "the app is generated from the database."

## Three clients, one backend

1. **Web App** (Next.js) — full storefront + PWA
2. **Android App** (Flutter) — same backend
3. **iPhone** — PWA (installable, app-like via Safari), not native (native Flutter iOS is a possible future add)

No business logic is duplicated across clients — it all lives in the backend.

In the actual repo, "Web App" and "PWA" became two separate apps —
`apps/storefront` (desktop-first) and `apps/pwa` (mobile-first, installable,
Serwist service worker) — rather than one app with a PWA layer, per the Phase 001
foundation task's explicit `apps: [storefront, admin, pwa, mobile]` structure.
This is an open question, not a settled reversal of the point above — see
`docs/architecture/README.md`'s "Open question" section before assuming either
shape is final.

## Repository layout

pnpm workspaces + Turborepo monorepo. `apps/` (storefront, admin, pwa Next.js
apps + mobile Flutter app), `services/` (api, worker, notification-worker,
scheduler — NestJS), `packages/` (ui, database, types, validation, config,
eslint-config — shared, pre-built via tsup), `infrastructure/` (docker, nginx,
postgres, redis, monitoring), `docs/` (architecture, database, api, security,
deployment — status docs distinguishing what's real vs. planned). Full picture:
`docs/architecture/README.md`. Every directory has its own `README.md` — read
the local one before working in it.

## Stack

- **Backend**: NestJS + TypeScript (modular, DI, RBAC, OpenAPI, event-driven, queues)
- **Web**: Next.js, TypeScript, React, Tailwind, shadcn/ui, React Hook Form, Zod, TanStack Query, PWA
- **Mobile**: Flutter (Android now, iOS-native later)
- **Database**: PostgreSQL 16/17+, domain-based schemas (identity, customer, catalog, commerce, inventory,
  procurement, retail, crm, marketing, cms, finance, communication, analytics, system), UUID PKs, soft deletes,
  audit logs, migrations only (no manual `ALTER TABLE` on production)
- **Cache/Queue**: Redis + BullMQ
- **Search**: PostgreSQL full-text search first, OpenSearch later (index built from PG via events, not source of truth)
- **Storage**: Object storage for binaries, PostgreSQL holds metadata only
- **Notifications**: multi-channel adapters (SMS, Telegram, WhatsApp, Email, Push, In-App) behind one interface;
  WhatsApp/Telegram are _not_ load-bearing for Iran — SMS is the reliable fallback
- **Payments**: gateway-abstraction layer (`createPayment/verifyPayment/refundPayment/getTransaction`) — never
  lock the system to one Iranian provider

## Backend structure: domain-based, not layer-based

Not `controllers/ services/ models/ utils/` as one big pile. Instead, one directory per domain (identity,
customer, catalog, pricing, promotion, cart, checkout, order, payment, fulfillment, inventory, procurement,
supplier, store, pos, prescription, optometry, appointment, loyalty, wallet, crm, support, cms, marketing,
notification, search, recommendation, ai, analytics, reporting, finance, system), each internally layered as
domain / application / infrastructure / presentation (DDD-ish).

## Key domain rules worth remembering

- **Order ≠ live product.** Orders snapshot product name/SKU/price/discount/tax/lens/prescription at purchase
  time — a later price change must never retroactively change a placed order.
- **Inventory is a ledger, not a counter.** `stock = 10` is not enough; every change (purchase, sale, damage,
  return, transfer, reservation) is a transaction row, and available stock is derived: `Available = Stock - Reserved`.
- **Loyalty/wallet points are also ledgers** (append-only transactions), not a single mutable `points` field.
- **AI never invents product IDs.** AI stylist/search must resolve to real DB products — it parses intent, the
  real catalog/search engine executes the query.
- **Prescription system is more rigorous than Lenskart's** — structured SPH/CYL/AXIS/ADD/PD per eye, family
  profiles, optometrist review workflow for anything needing professional sign-off. The system validates format/
  range, but does not invent medical judgement.
- **Sensitive admin actions need approval workflows** (draft → review → approve → publish) — e.g. large price
  changes, big discounts/promotions, CMS/landing page publishing — to prevent a fat-fingered 99% discount.
- **Four-eyes principle** for sensitive financial operations (creator ≠ approver).
- Money is integer (e.g. `amount BIGINT`, currency IRR) — never floating point.
- Everything user-facing is fa-IR first (with en-US available); backend stores UTC, display converts to
  Asia/Tehran, frontend uses the Jalali calendar.

## 10 USPs vs. Lenskart

Iranian Prescription Engine · AI Persian Eyewear Stylist · Multi-Branch + Multi-Warehouse · POS + Online Unified ·
Customer 360 · Loyalty Engine · Persian CMS · Iranian Payment Architecture · SMS+Telegram+WhatsApp+Push ·
ERP Integration.

## Current status

Phase 0 (product/architecture definition, `docs/product/blueprint.md`) is done at
a "design scope" level. The Phase 001 foundation task built the monorepo
**structure and toolchain** — pnpm+Turborepo workspace, all seven `apps`/`services`
scaffolded and buildable, five shared `packages`, local-dev infrastructure
(`docker-compose.yml`), and status docs. At that point this was scaffolding, not
features: `services/api` had exactly two modules (`health`, real; `identity`,
structurally real but backed by one placeholder DB model), no auth/RBAC existed
anywhere, and every notification-channel adapter was a stub. Phases 003/004
below made the database and identity/RBAC pieces of that statement no longer
true — see `docs/architecture/README.md`, `docs/security/README.md`, and
`docs/deployment/README.md` for precise, currently-maintained "what's real vs.
planned" breakdowns — don't assume a piece works just because a file for it
exists.

Phase 002 added the enterprise git workflow + CI quality gate: `main`
(production) / `develop` (integration) / `feature`+`bugfix`+`hotfix` branches
(`docs/deployment/ci-pipeline.md`), and `.github/workflows/ci.yml`'s four jobs
(`lint`, `test` — unit + integration against a real Postgres service container,
`security` — dependency + secret scan, `build` — frontend/backend split) gated
by a `quality-gate` job. Branch protection requiring that check is still a
manual GitHub-admin step (not configurable from inside the repo) — see that
doc. `develop` currently equals `feature/foundation-monorepo`'s content since
that branch was never merged to `main` (no PR was requested).

Phase 003 built the real PostgreSQL foundation (blueprint's "settle the
database/domain skeleton first" ordering principle): the full ERD across all
11 domain schemas, hand-authored migrations with rollback (`down.sql`) scripts,
a convergent seed script, backup/restore scripts, and `docs/database/README.md`

- `docs/database/erd.md` (Mermaid) as the maintained source of truth. CI now
  applies migrations and runs the seed as a regression check before the e2e
  suite.

Phase 004 built the real identity/RBAC system on top of that foundation:
`services/api/src/modules/identity` is a full clean-architecture module (see
its own `README.md`) covering mobile OTP + email/password login, refresh-token
rotation, TOTP 2FA, role inheritance, a permission matrix with per-user
allow/deny overrides (deny always wins), module- and field-level access
control, and sessions/devices/API-key/audit-log self-service endpoints. A
global `JwtAuthGuard` + `AuthorizationGuard` now protect every route in
`services/api` by default (opt out per-route with `@Public()`) — the
foundation task's "no auth/RBAC exists anywhere" is no longer accurate.
`docs/security/README.md`'s "In place today" table is the maintained record of
exactly what this covers and what's still explicitly open (rate limiting,
OAuth/social login, API-key request authentication, Security Center
dashboards, KMS-backed key rotation).

Phase 005 built the real product catalog/merchandising domain on top of
that foundation: `services/api/src/modules/catalog` (see its own
`README.md`) covers brands, unlimited-depth categories, manual/dynamic
collections, the full product publication lifecycle (`DRAFT → IN_REVIEW →
APPROVED → PUBLISHED → UNPUBLISHED`/`ARCHIVED`, enforced by a domain-layer
state machine independent of RBAC), the `ProductVariant`/`ProductSku` split
(merchandising configuration vs. the sellable/priced/inventoried unit —
`docs/adr/ADR-005-catalog-architecture.md` decision 1), storage-agnostic
media, localizable admin-defined attributes, and pricing
(`finance.ProductPrice`/`PriceHistory`, extended not duplicated). It's the
second full clean-architecture module in this repo and reuses Phase 004's
auth/RBAC/audit-log infrastructure wholesale rather than reinventing it — 21
new `catalog.*` permissions, a new `catalog_editor` role, and catalog is the
first module to actually **write** `system.AuditLog` (Phase 004 only ever
read it). The public storefront read surface (`GET /catalog/...`) is
Postgres-only search this phase, deliberately not Elasticsearch/OpenSearch
— see `docs/adr/ADR-005-catalog-architecture.md` decision 5.
**Backend-only, same as Phase 004**: `apps/admin`/`apps/storefront` are
still untouched (decision 7) — see `docs/product/catalog.md` for exactly
what a future frontend phase would need from this API surface.

Phase 006 built the real multi-warehouse inventory domain on top of
catalog: `services/api/src/modules/inventory` (see its own `README.md`)
covers warehouses/locations, an append-only stock ledger (13-value movement
vocabulary — `InventoryLedger` is the source of truth for _why_ stock is
what it is, `InventoryItem`'s 7 quantity buckets are a maintained cache), an
idempotent, transactionally concurrency-safe reservation engine
(`available = on_hand - reserved - damaged - quarantined - blocked`, never
negative — proven under real concurrent load: 100 simultaneous reservations
against 10 available units yields exactly 10 successes, 0 oversells), stock
transfers (a real 9-state lifecycle), adjustments (with "warehouse operators
cannot approve their own sensitive adjustments" enforced by simply never
granting them `inventory.adjust`), stock counts with variance calculation, a
configuration-driven allocation engine, barcode/SKU lookup (reusing
catalog's `product_skus` without duplicating product identity), a public
storefront availability surface, and this repo's first background job
queues — 3 BullMQ queues registered in-process inside `services/api` (not
`services/worker`, since their processors share the HTTP controllers' exact
domain-service/Prisma-transaction context; see
`docs/adr/ADR-006-inventory-architecture.md` decision 8). PostgreSQL remains
the single source of truth throughout — Redis is used only for queue
scheduling, never to answer an inventory-state read. It's the third full
clean-architecture module in this repo and reuses Phase 004's auth/RBAC/
audit-log infrastructure wholesale — 13 new `inventory.*` permissions, 4 new
roles (`inventory_manager`/`warehouse_operator`/`store_manager`/
`inventory_auditor`), and inventory is the second module to actually
**write** `system.AuditLog` (after catalog). **Backend-only, same
precedent**: `apps/admin`/`apps/storefront` are still untouched — see
`docs/product/inventory.md`.

**Next up is still the rest of Phase 1** (see end of blueprint doc "وضعیت
فعلی"): the remaining real domain modules (`customer`, `order`, …) beyond
`identity`/`catalog`/`inventory`, each landing once its slice of the ERD/API
contract/permission matrix/event map is designed — _before_ further
UI/design-system work. The stated ordering principle: settle the
database/domain skeleton first (done for identity, catalog, and inventory;
the rest still pending), then design system + admin panel structure +
web/PWA sitemap + Android structure.

Treat any new architectural decision as needing to stay consistent with this document, or update it explicitly.
