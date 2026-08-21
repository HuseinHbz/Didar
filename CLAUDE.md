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
doc. Every phase's `feature/*` branch is merged to `main` once its PR lands
(all of Phase 001-009's PRs are merged as of Phase 009; `develop` tracks the
same tip, with later phases' own branches pushed and pending) — see
`docs/deployment/ci-pipeline.md`'s "Numbered branch naming" section for the
two-digit prefix (`01-feature-foundation-monorepo`, …,
`12-feature-returns-refunds-credit-notes`) every phase branch carries from
Phase 001 onward, and for the naming rule to keep following on every
future branch.

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

Phase 007 built the real cart/checkout/pricing-resolution domain on top of
catalog and inventory: `services/api/src/modules/cart-checkout` (see its
own `README.md`) covers guest and authenticated carts (dual-auth
`ActorResolverGuard`, not the global `JwtAuthGuard` — guest checkout would
otherwise be impossible), configuration-aware line consolidation, a real
server-side pricing engine (`base_price → resolved_unit_price → discount →
tax → shipping → grand_total`, `PricingResolver`, pure and unit-tested,
never trusting a client-supplied total), coupons re-validated against the
real `marketing.Coupon` on every apply and reprice, database-driven
shipping methods, a 6-state checkout session (`OPEN → VALIDATING →
READY_FOR_PAYMENT → {EXPIRED|CANCELLED|CONVERTED}`) with idempotent
creation, and real inventory reservation integration — `CatalogModule`/
`InventoryModule` gained small additive `exports` arrays so this module
injects their real `ProductsService`/`PricingService`/`ReservationService`/
`AllocationService` directly rather than reimplementing any catalog or
reservation logic. It's the fourth full clean-architecture module in this
repo and the first composed almost entirely from other modules' exported
services; it registers **no** new RBAC permissions (every route is
customer/guest ownership-scoped, not admin-gated) but does add two more
in-process BullMQ queues (`checkout_expiration`, `cart_abandonment`,
following Phase 006's own precedent for where queue processors live). Its
own mandatory concurrency e2e suite found and fixed a real gap during
development — `prisma.upsert()` alone is not race-safe against two truly
simultaneous callers on the same unique key, so both
`PrismaCheckoutSessionRepository.create()` and `PrismaCartRepository.
addItem()` now catch the resulting `P2002` and re-read the winner's row
instead of ever throwing — see `docs/architecture/cart-checkout.md`.
**Backend-only, same precedent**: `apps/admin`/`apps/storefront` are still
untouched — see `docs/product/cart-checkout.md`.

Phase 008 built the real, provider-independent payment orchestration
domain on top of cart-checkout: `services/api/src/modules/payment` (see
its own `README.md`) covers a three-level `PaymentIntent → PaymentAttempt
→ PaymentTransaction` model (a payment is never one atomic row — a
customer can be redirected, abandon, and retry), a real ZarinPal v4 REST
adapter (`request.json` → `Authority` → `/pg/StartPay/:authority` redirect
→ `verify.json` → `RefID`, plus `reverse.json` for refunds) behind a
`PaymentProviderAdapter` interface — the actual provider-independence
boundary, implemented once for real and ready for a second gateway with
zero changes to the domain/application layers — server-side verification
that is never inferred from the customer's redirect return (only a real
server-to-server `verifyPayment()` call, matched against the intent's own
frozen amount/currency via `VerificationMatcher`), refunds bounded to the
captured amount (`RefundValidator`), and provider-comparison
reconciliation that only ever records a finding, never silently
self-corrects. It imports `CartCheckoutModule` and injects its exported
`CheckoutService` directly (`markConverted()` on a verified payment,
reused rather than reimplementing checkout state) and reuses its
`ActorResolverGuard` for the customer/guest-facing intent routes; admin
refund/reconciliation routes are real RBAC (5 new `payment.*`
permissions, `payment_manager`/`finance_auditor` roles). It's the fifth
full clean-architecture module in this repo and adds three more in-process
BullMQ queues (`payment_verification_retry`, `reconciliation`,
`refund_status_sync`). Its own mandatory concurrency e2e suite proved
(not just declared) three real races fixed the same way Phase 007
established: `prisma.create()` alone is not race-safe against two truly
simultaneous callers on the same unique key, so intent creation
(`checkoutSessionId`), callback recording (`dedupeKey`), and transaction
verification (`(providerId, providerReference)`) all catch the resulting
`P2002` and re-read the winner's row — see `docs/architecture/payment.md`.
This sandboxed development environment cannot reach `sandbox.zarinpal.com`
(outbound proxy policy denial, confirmed directly) — the adapter is
written against ZarinPal's real documented contract, but live-network
verification is a documented gap for a staging environment to close, not
hidden. **Backend-only, same precedent**: `apps/admin`/`apps/storefront`
are still untouched — see `docs/product/payment.md`.

Phase 009 built the real order/invoice/fulfillment domain on top of
cart-checkout/catalog/inventory/payment at once —
`services/api/src/modules/order` (see its own `README.md`) covers an
`Order` created only from a verified `PaymentTransaction`
(`OrderConversionService.convertFromCheckout()`, idempotent on
`checkoutSessionId`/`paymentIntentId` and crash-recovery-resumable if a
prior call died mid-flight — a real gap this phase found and fixed on
itself, twice, once in the synchronous method and once in its own
sweep's second pass), an 8-state order lifecycle plus separate
fulfillment/shipment/invoice state machines, automatic invoice issuance
with a real server-generated number (`finance.invoice_number_seq`),
partial-fulfillment-aware fulfillment tracking with a row-locked
never-over-fulfill invariant (`SELECT ... FOR UPDATE`, reusing
`mutateInventoryItem`'s own Phase 006 technique), and a
`ManualShippingProvider` behind a `ShippingProviderPort` — no live
courier integration exists yet, and this phase says so rather than
faking one. It imports four prior modules at once
(`CartCheckoutModule`, `CatalogModule`, `InventoryModule`,
`PaymentModule`) — the deepest composition chain in this repo so far —
and reuses `cart-checkout`'s `ActorResolverGuard` for customer/guest
order routes; admin routes are real RBAC (14 new `order.*` permissions,
`order_manager`/`fulfillment_clerk` roles). It's the sixth full
clean-architecture module in this repo and adds two more in-process
BullMQ queues (`order_conversion`, `invoice_generation`). Its own
mandatory concurrency e2e suite proved (not just declared) a real race
this time in a different layer than every prior phase's own P2002-catch-
and-reread findings: `OrderService.cancel()`'s check-then-act pattern
(read the order, decide via the state machine, then write) was not
atomic — six concurrent cancel requests on one order originally produced
six `OrderStatusHistory` rows, not one — fixed by row-locking the order
(`SELECT ... FOR UPDATE`) and re-checking the state machine against the
_locked_ status before writing, inside `PrismaOrderRepository
.updateStatus()` itself so every caller benefits, not just `cancel()` —
see `docs/architecture/order.md`. **Backend-only, same precedent**:
`apps/admin`/`apps/storefront` are still untouched — see
`docs/product/order-fulfillment.md`.

Phase 010 built the real promotion/discount/coupon engine and extended
(never duplicated) `cart-checkout`'s own single-coupon pricing pipeline
to support any number of simultaneous promotions —
`services/api/src/modules/promotion` (see its own `README.md`) covers 6
discount types (`PERCENTAGE`/`FIXED_AMOUNT`/`FIXED_PRICE`/
`FREE_SHIPPING`/`BUY_X_GET_Y`/`BUNDLE_PRICE`), composable OR'd targeting
(product/SKU/category/brand/collection, zero rows = whole cart),
deterministic stacking/exclusivity resolution (`priority ASC, id ASC`,
never DB row order), and a coupon lifecycle with no enumeration leakage
(the same code returns the same generic rejection whether it doesn't
exist, is expired, or the cart just doesn't qualify). It generalizes
"usage limit" into one redemption ledger
(`marketing.CouponRedemption`, `RESERVED → REDEEMED`/`RELEASED`) shared
by coupon-gated and automatic promotions alike, row-locked
(`SELECT ... FOR UPDATE`) the same way `mutateInventoryItem`/
`lockAndSumFulfilled` already proved safe, backstopped by a real
Postgres `CHECK` constraint Prisma's schema DSL can't express — proven
under real concurrency twice, once through the full HTTP checkout flow
(15 concurrent confirmations against a `usageLimit: 1` coupon) and once
directly at the repository layer (20 concurrent `reserve()` calls, no
HTTP), both converging to exactly one success. `cart-checkout`'s
`PricingResolver` traded its single `coupon: CouponRule | null` input
for `adjustments: readonly PricingAdjustmentInput[]` — a strict
superset, not a rewrite, so every pre-existing cart-checkout pricing
test kept its exact expected numbers. `cart-checkout` and `order` each
import `PromotionModule` directly and consume its exported
`PromotionResolutionService`/`CouponRedemptionService` — this module
depends on neither of them, the composition runs the other direction
than Phase 009's four-module `order` did. It's the seventh full
clean-architecture module in this repo and adds two more in-process
BullMQ queues (`promotion_expiration`, `coupon_reservation_cleanup`).
Explicit security coverage beyond RBAC/enumeration: a client cannot
inject a discount amount (`forbidNonWhitelisted` rejects it) or forge a
total (`/cart/price` binds no request body at all), a negative
`discountValue` from bad/malicious admin input can never inflate a
price (`DiscountEngine`'s own floor-at-zero), and replaying
`ready-for-payment` never double-reserves — see
`docs/security/promotion-security.md`. **Backend-only, same precedent**:
`apps/admin`/`apps/storefront` are still untouched — see
`docs/product/promotions.md`.

Phase 011 hardened Phase 009's order/fulfillment/shipping module rather
than rebuilding it — an audit against a real concurrency/security
scenario list, not a new feature set. It found and fixed the exact same
check-then-act status-transition race Phase 009 had already found and
fixed on `Order` (`SELECT ... FOR UPDATE` + re-check-the-locked-row),
still open on `Fulfillment`/`Shipment` specifically — proven via 20
concurrent identical status updates against each, collapsing to exactly
one real transition (`test/order-repository.e2e-spec.ts`). It closed the
subtler version of "don't trust a client PATCH to COMPLETED" that Phase
009 hadn't fully closed: `OrderService.complete()` used to trust the
`fulfillmentStatus` cache column alone; a new `OrderCompletionValidator`
(pure domain service) now re-derives readiness from the order's real
`Fulfillment` rows, requiring every non-cancelled one to be genuinely
`DELIVERED`. Delivery confirmation moved to its own dedicated route and
permission (`order.shipment.deliver`, deliberately withheld from
`fulfillment_clerk`) — the generic status-update routes' own DTOs now
reject `DELIVERED` outright at the validation layer. It added
fulfillment-creation idempotency keys, a `UNIQUE` tracking-number index
with a real lookup route, database-backed admin order search/filtering
(never fetched-then-filtered), and finally surfaced Phase 010's own
`OrderPromotion` snapshot on the order read path — a gap Phase 010's own
final report had flagged. It deliberately did **not** implement
inventory restock-on-cancellation — re-evaluated, not merely carried
forward unexamined, and reaffirmed deferred because a correct
implementation needs reservation-lineage tracking this phase's brief
didn't ask for (`docs/adr/ADR-011-order-lifecycle-hardening.md` decision
8). A related, lower-severity finding — six pre-existing
`OrderRepositoryPort.updateStatus()` call sites can each write one
harmless duplicate `AuditLog` row on a losing race, never a duplicate
`OrderStatusHistory` row — was found and documented but deliberately not
retrofitted this phase (too large a blast radius for a cosmetic gap).
See `docs/architecture/order.md`'s "Phase 011" section for the full
account. **Backend-only, same precedent**: `apps/admin`/`apps/storefront`
are still untouched.

Phase 012 closed the returns/refunds/credit-notes gap every phase from
008 onward had explicitly deferred — a new `modules/return`, additive
extensions to `modules/payment` (`Refund.returnRequestId` + a new
`RefundLine` child table — **exactly one refund pathway still exists,
extended, never duplicated**) and `modules/inventory`
(`AdjustmentService.receiveReturnedStock()`, wrapping a previously-
uncalled `receiveStock()` primitive). A 10-state `ReturnRequest`
lifecycle, eligibility checked against real `Fulfillment.deliveredAt`
data (never a client-supplied flag), refund/credit-note amounts always
derived from `OrderItem`'s own immutable snapshot
(`lineTotal - discountAmount + taxAmount`, never live catalog/promotion
data), a row-locked return-quantity invariant
(`lockAndSumReturnedQuantity`, the direct analogue of Phase 009's
over-fulfillment guard), inventory restock gated on a real
`INSPECTING -> APPROVED_FOR_REFUND` transition (never on a mere request,
never on a rejection, proven to collapse to exactly one restock under 20
concurrent approve-for-refund calls), and a real, minimal credit-note
lifecycle with server-generated sequential numbering from a Postgres
sequence — `Invoice` itself is never mutated. All six required
concurrency proofs ran against real PostgreSQL, never a mocked
repository (`test/return-repository.e2e-spec.ts`). A genuine,
pre-existing latent race in the e2e test harness itself was found and
mitigated along the way: OTP login for the shared seed admin phone can
lose a race across Jest's parallel per-file workers when enough spec
files contend on it at once (`VerifyOtpUseCase` correctly honors only
the _latest_ requested code, so two concurrent login sequences for one
phone can invalidate each other) — fixed for this phase's own two new
e2e files by giving them a dedicated second admin fixture rather than
patching identity's (correct) OTP semantics; the same latent contention
remains open for the other nine files that still share the one hot
phone number, documented rather than silently carried forward. See
`docs/adr/ADR-012-returns-refunds-credit-notes.md` and
`docs/architecture/returns.md` for the full account. **Backend-only,
same precedent**: `apps/admin`/`apps/storefront` are still untouched.

**Next up** is the rest of Phase 1 (see end of blueprint doc "وضعیت
فعلی"): the remaining real domain modules beyond
`identity`/`catalog`/`inventory`/`cart-checkout`/`payment`/`order`/
`promotion`/`return`, each landing once its slice of the ERD/API
contract/permission matrix/event map is designed — _before_ further
UI/design-system work. The stated
ordering principle: settle the database/domain skeleton first (done for
identity, catalog, inventory, cart-checkout, payment, order, promotion,
and return; the rest still pending), then design system + admin panel
structure + web/PWA sitemap + Android structure.

Treat any new architectural decision as needing to stay consistent with this document, or update it explicitly.
