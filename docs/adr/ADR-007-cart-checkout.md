# ADR-007 — Cart, Checkout, Pricing Resolution & Inventory Reservation Integration

**Status**: Accepted
**Phase**: 006 → **007** (`services/api/src/modules/cart-checkout`)

## Context

Phase 005 gave this repo a real sellable unit (`catalog.product_skus` +
`finance.product_prices`). Phase 006 gave it a real, concurrency-safe stock
ledger and reservation engine. Neither phase has a way for a customer to
actually put something in a basket and reach a payment-ready state — `Cart`/
`CartItem`/`Order`/`OrderItem` have existed since Phase 003 as an
unmodified placeholder shape (a bare quantity + price snapshot, no
configuration, no checkout concept, no reservation link). Phase 007 replaces
that placeholder with a real cart + checkout engine: server-side price
resolution, inventory reservation integration, an idempotent checkout
session, and a payment-ready result — explicitly stopping short of payment
provider integration (Phase 008) and the full `Order` lifecycle (a later
phase).

## Decision 1 — Cart and Checkout are separate aggregates, not one state machine

A `Cart` is a long-lived, freely-mutable wishlist (`ACTIVE` for days,
survives browser restarts via a guest token or customer binding).
A `CheckoutSession` is a short-lived, increasingly-locked-down process
(`OPEN → VALIDATING → READY_FOR_PAYMENT`, expires in minutes) that snapshots
a cart at one point in time and drives it toward payment. Collapsing these
into one entity (the way `Cart.status` alone tried to in Phase 003 —
`ACTIVE|CONVERTED|ABANDONED`) would force the same row to mean two
different things at two different lifetimes. `CheckoutSession.cartId` points
back at the cart it was started from; the cart's own status moves to
`CHECKOUT_STARTED` while a checkout is in flight (so a second concurrent
`POST /checkout` against the same cart is a real conflict, not silently
allowed) and to `CONVERTED` once that checkout reaches
`READY_FOR_PAYMENT` and payment orchestration takes over (Phase 008).

## Decision 2 — Quantity buckets are still a cache; the ledger discipline extends here too

`CheckoutSession` carries its own current `subtotal`/`discountTotal`/
`taxTotal`/`shippingTotal`/`grandTotal` columns for fast reads, but every
call to `POST /checkout/:id/price` also appends a row to `CheckoutTotals` —
an append-only history of every recalculation, each with its own
`breakdown` (per-line resolved price, discount basis, tax basis). This is
the same cache-plus-ledger split ADR-006 decision 2 established for
`InventoryItem`/`InventoryLedger`, reapplied here because the brief's own
rule is identical: "historical checkout calculations must be reproducible."
A `CartPriceSnapshot` plays the same role at the cart level, one layer
earlier — recorded whenever a cart is priced before checkout even starts,
so a customer's basket total is never silently a stale, unrecomputed value.

## Decision 3 — No separate `checkout_expiration` table

The brief lists `checkout_expiration` as a domain concern in scope, but
Phase 006 already established the pattern for "a row that expires": a
plain `expiresAt` column on the entity itself (`InventoryReservation.
expiresAt`) plus a BullMQ job. There is nothing this module's checkout
sessions need beyond that same shape — `CheckoutSession.expiresAt` + a
`checkout_expiration` BullMQ queue is the concern, not a new table
recording every expiry event (that event is already fully
reconstructable from `CheckoutSession.status = EXPIRED` + `updatedAt`, no
extra row needed).

The queue itself diverges from Phase 006's shape in one way: Phase 006
schedules one _delayed_ job per reservation (job id = reservation id).
This module instead runs a small recurring _sweep_ (`upsertJobScheduler`,
BullMQ v6's repeat-job API) that re-reads
`CheckoutSessionRepositoryPort.listExpirable()` every minute and expires
whatever is due. The reason: `POST /checkout/:id/refresh` can push a
session's `expiresAt` forward _after_ a delayed job for it might already
be scheduled, which would either require rescheduling on every refresh or
risk an early false expiry — a sweep that always re-reads current state
sidesteps that entirely. `Cart` gets the identical treatment via a second,
slower `cart_abandonment` sweep (every 15 minutes, since a cart's TTL is
30 days, not 20 minutes) — `CartService.touch()` extends `Cart.expiresAt`
on every meaningful mutation, exactly mirroring how `refresh()` extends a
checkout session's.

## Decision 4 — Reservation is _used_, never reimplemented

The brief's own absolute rule: "Use Phase 006 inventory reservation instead
of direct stock mutation" / "Do not duplicate reservation logic." Concretely:
`InventoryModule` now `exports` its `ReservationService`, `AllocationService`,
and `StockQueryService` (a small, additive change to Phase 006's module —
no behavior change, just visibility); `CartCheckoutModule` imports
`InventoryModule` and injects those three services directly, the same way
any two peer NestJS modules compose. `CheckoutService.reserve()` calls
`AllocationService.allocate()` once per cart line to pick a warehouse
(config-driven, explainable — ADR-006's own allocation engine, not
reimplemented here), then `ReservationService.reserve()` with
`sourceType: 'CHECKOUT'`, `sourceId: <checkoutSessionId>` — exactly the
polymorphic seam ADR-006 decision 5 built and left unfilled for "a future
cart/checkout module." A `CheckoutReservation` join row records which
`InventoryReservation` backs which cart line, satisfying "preserve
reservation reference in checkout session" without duplicating any
reservation state.

Reservation idempotency reuses `InventoryReservation.idempotencyKey`
directly: the key passed to `ReservationService.reserve()` is derived
deterministically as `checkout__<checkoutSessionId>__<productSkuId>`
(joined with `__`, not `:` — the character BullMQ itself rejects in a
custom job id, a lesson Phase 006 learned the hard way; this key isn't a
BullMQ job id, but the double-underscore join is used consistently
anyway), so calling `POST /checkout/:id/reserve` twice for the same line
always resolves to the exact same `InventoryReservation` row — no
separate idempotency ledger needed for this operation (satisfies the
brief's explicit "do not create duplicate reservation" without a
speculative generic idempotency-key store).

## Decision 5 — Cross-module catalog reads are real service injection, not a re-derived port

Phase 006 built `SkuLookupPort` as a deliberately minimal, Prisma-direct
read of `catalog.product_skus` specifically to avoid importing catalog's
domain/application layers for a case where doing so would duplicate SKU
_identity_. Cart/checkout's need is different: it must call catalog's
_actual_ `ProductsService.get()` (lifecycle status) and
`PricingService.get()` (the authoritative current price + validity window)
— real, already-correct domain logic, not identity duplication risk. So
`CatalogModule` now `exports` `ProductsService`, `SkusService`, and
`PricingService` (same additive, non-breaking change as decision 4), and
`CartCheckoutModule` imports `CatalogModule` and injects them directly.
This is the more idiomatic NestJS cross-module composition pattern; the
`SkuLookupPort`-style minimal-port approach stays reserved for cases where
importing the whole module really would create a duplicate identity
concept, which pricing/lifecycle reads are not.

## Decision 6 — Tax reuses the SKU's own field; no new tax-rule table

`catalog.product_skus.tax_rate_basis_points` (Phase 005) is already exactly
"a configurable, per-SKU, non-hardcoded tax rate" — a `null` value means
non-taxable, a set value is the exact basis-point rate to apply. Building a
parallel `TaxRule` table this phase would duplicate that column for no
reason. The one gap — a SKU with no explicit rate — is filled by a single
`system.Setting` row (`key: 'pricing.default_tax_rate_basis_points'`),
reusing the exact config-store precedent ADR-006 decision 7 set for
allocation rules, rather than hardcoding a default in application code.
This satisfies "tax rules must be configurable" / "must not be hardcoded"
without building a jurisdiction-aware tax engine — explicitly out of scope
per the brief's own "do not claim tax-law compliance beyond the implemented
configurable rules."

## Decision 7 — Shipping is one new table, deliberately flat

`ShippingMethod` (commerce schema) is the one new table: `code`, `name`,
`type` (`HOME_DELIVERY`/`STORE_PICKUP`), `baseCost`, an optional
`freeAboveAmount` threshold, an optional `warehouseId` (for `STORE_PICKUP`,
pointing at a Phase 006 warehouse — unenforced cross-schema, same
convention as everywhere else), and an optional `zoneMatch` JSON column
(nullable — `null` means "available nationwide," a set value is a simple
province/city match list). This is deliberately **not** a full
zone-graph/rate-table shipping engine — the brief's own "shipping zone
resolution foundation" wording, and its explicit "do not integrate external
carriers this phase." `CartShippingSelection` records a cart's current pick
(for a running total before checkout); `CheckoutSession.shippingSnapshot`
freezes the chosen method's name/cost/type once checkout starts, so a later
`ShippingMethod` price change never retroactively changes an in-flight
checkout — the same "order ≠ live product" principle this repo already
applies to pricing, extended to shipping.

## Decision 8 — Coupons: apply against the real `marketing.Coupon`, snapshot the result

`CartCoupon` stores a plain, unenforced pointer to `marketing.coupons.id`
plus a snapshot of the resolved discount amount at application time — the
coupon's own `value`/`type`/`minOrderAmount`/`maxDiscountAmount` rules
(already real since an earlier phase) are read and validated at apply-time
by a `DiscountCalculator` domain service, never re-read live at checkout
(a coupon deactivated between cart-apply and checkout-price must not
silently change an already-quoted total mid-flow — checkout's own
`POST /checkout/:id/price` step re-validates the coupon is still usable and
surfaces a validation failure if not, rather than silently dropping it).
Stacking/complex promotion rules and full loyalty-point redemption are
explicitly out of scope this phase (brief's own `discount_foundation.
do_not_implement`).

## Decision 9 — Prescription reference: readiness only, honestly incomplete

No `Prescription` entity exists anywhere in this schema yet — only an
`OrderStatus` enum value (`PRESCRIPTION_REVIEW`) hints one is planned for a
future phase. `CartItemOption` (`optionType: 'PRESCRIPTION_REFERENCE'`)
accepts and stores a reference id, satisfying "never store sensitive
prescription data redundantly... a reference... is sufficient" — but the
brief's own "validate existence and ownership" requirement **cannot be
implemented** against a table that does not exist. This is documented here
rather than faked: `PrescriptionReferenceValidator` (domain layer) is a
real, unit-tested pure function with the correct _shape_ (validate a
reference id looks well-formed, is owned by the checkout's customer once a
real prescription module exists to check against), but its actual
existence/ownership check is a documented no-op returning `unverified`
today, never a fabricated `true`. See `docs/product/cart-checkout.md`'s
"What's explicitly not real yet."

## Decision 10 — Guest carts use the existing `Cart.sessionToken` shape, renamed and hardened

Phase 003's `Cart.sessionToken` already was an opaque, unique, nullable
string for exactly this purpose; Phase 007 renames it `guestToken`
(clearer given `CheckoutSession` also needs to carry it for ownership
checks) and generates it with `crypto.randomBytes(32)` base64url-encoded
(256 bits of entropy — not guessable, not sequential, satisfying "prevent
cart enumeration"). A guest request authenticates by presenting this token
in an `X-Cart-Token` header; there is no session/cookie mechanism built
this phase beyond that header — the client (a future storefront phase) is
responsible for persisting it. `POST /cart/merge` (called once a guest
authenticates) folds the guest cart's line items into the now-authenticated
customer's cart (consolidating duplicate SKU+configuration lines,
preserving distinct ones) and marks the guest cart `ABANDONED` — no sixth
`CartStatus` value was added for "merged away," since `ABANDONED`'s
existing meaning ("no longer active, superseded") already fits.

## Decision 11 — Customer resolution: a minimal lookup, not a new customer module

`Cart.customerId`/`CheckoutSession.customerId` point at
`customer.customers.id` (matching the existing, unmodified `Order.
customerId` convention from Phase 003), not `identity.users.id` directly.
Building a full customer-registration module is out of scope this phase —
a `CustomerLookupPort` (Prisma-direct read of `customer.customers` by
`userId`, same minimal-port precedent as Phase 006's `SkuLookupPort`)
resolves the caller's JWT `userId` to their `customer.customers` row. If
none exists (an authenticated user with no customer profile — e.g. an
admin/staff account), cart/checkout for that user fails with a clear,
documented error rather than silently creating a placeholder customer row;
a future customer-registration phase is expected to guarantee this row
exists before a real shopper ever reaches checkout.

## Consequences

- Cart/checkout state is trivially reconstructable and auditable — every
  price the customer ever saw is a real row (`CartPriceSnapshot`/
  `CheckoutTotals`), never only computed transiently and discarded.
- `InventoryModule`/`CatalogModule` gained `exports` arrays — a small,
  behavior-preserving change verified by re-running every existing Phase
  005/006 test (unit + e2e) unchanged.
- Payment orchestration (Phase 008) has exactly one seam to integrate
  against: a `CheckoutSession` in `READY_FOR_PAYMENT` with a fixed,
  reproducible `grandTotal` and a fixed reservation set — it does not need
  to know anything about how the cart got there.

## Deferred (explicitly out of scope this phase)

- Full `Order` creation/lifecycle — `CheckoutSession` is the interim
  payment-ready artifact; converting one into a real `Order` row is a
  later phase's job (Phase 008/009).
- Any payment provider integration (Phase 008).
- Full promotion-stacking/campaign engine, full loyalty-point redemption.
- Real prescription existence/ownership validation (no `Prescription`
  table exists yet — decision 9).
- Multi-currency (this repo is IRR-only throughout, unchanged).
- External carrier rate integration, multi-zone shipping graphs.
- A dedicated generic idempotency-key store — idempotency is achieved
  per-operation via existing unique keys / state-machine guards (decision 4).
- Admin CRUD for `ShippingMethod` — this phase treats it as seed/config
  data (`ShippingMethodRepositoryPort` is read-only: `findById`/
  `findByCode`/`listActive`), consistent with how `pricing.
default_tax_rate_basis_points` and `cart.max_quantity_per_line` are also
  seed-managed `system.Setting` rows rather than admin-editable via a new
  endpoint this phase. A future phase can add write methods without
  touching this module's customer-facing read/select path.
- New RBAC permissions — every endpoint this module exposes (`api.cart`/
  `api.checkout`) is customer- or guest-facing, gated by
  `ActorResolverGuard` + per-resource ownership checks
  (`CartService.assertOwnership`/`CheckoutService.assertOwnership`), not
  by `@RequirePermission`/`@RequireModule`. There are no admin-only writes
  in this module this phase (see the point above), so
  `packages/database/prisma/seed.ts`'s `permissionDefs` gains no new
  `cart_checkout.*` entries — the brief's "all privileged admin operations
  use Phase 004 RBAC" rule is honored vacuously, not skipped, because this
  module has none yet.
