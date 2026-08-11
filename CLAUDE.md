# Didar — IECP (Iran Eyewear Commerce Platform)

**Full product/architecture blueprint: [`docs/product/blueprint.md`](docs/product/blueprint.md) — read it before making
architectural decisions.** This file is a compressed summary for quick orientation; the blueprint is the source of truth
for anything not covered here.

## Positioning

This is **not** an Iranian clone of Lenskart. Lenskart is the *benchmark*, not the spec. The product is an
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
*code*, not data — don't confuse "everything from the database" with "the app is generated from the database."

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
  WhatsApp/Telegram are *not* load-bearing for Iran — SMS is the reliable fallback
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
(`docker-compose.yml`), CI (lint/typecheck/build), and status docs. This is
scaffolding, not features: `services/api` has exactly two modules (`health`, real;
`identity`, structurally real but backed by one placeholder DB model), no
auth/RBAC exists anywhere, and every notification-channel adapter is a stub. See
`docs/architecture/README.md`, `docs/security/README.md`, and
`docs/deployment/README.md` for precise "what's real vs. planned" breakdowns —
don't assume a piece works just because a file for it exists.

**Next up is still Phase 1** (see end of blueprint doc "وضعیت فعلی"): the actual
PostgreSQL ERD (every table, column, type, PK/FK, index, enum, relation),
migration/seed strategy, audit/soft-delete/versioning model, API contract,
permission matrix, event map, and the precise order state machine — *before* any
further UI/design-system work or real domain modules. The stated ordering
principle: settle the database/domain skeleton first, then design system + admin
panel structure + web/PWA sitemap + Android structure.

Treat any new architectural decision as needing to stay consistent with this document, or update it explicitly.
