# Cart/checkout security (Phase 007)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the one module Phase 007 added. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers
what's specific to the cart/checkout domain.

Unlike `docs/security/inventory-security.md` or
`docs/security/catalog-security.md`, this module registers **no** new
`inventory.*`/`catalog.*`-style RBAC permissions — every endpoint it
exposes is customer- or guest-facing (see `docs/api/cart-checkout.md`),
never an admin/staff route. The access-control model here is per-resource
ownership, not role-based permission.

## Guest + authenticated auth model

`ActorResolverGuard` (`presentation/guards/actor-resolver.guard.ts`)
replaces the global `JwtAuthGuard` for every route in this module — the
brief's own "cart must support guest and authenticated customers" rule
would otherwise be impossible (the global guard rejects any tokenless
request outright). A **present** Bearer token is still verified strictly
via `JwtTokenService.verifyAccessToken()` (imported from `IdentityModule`,
never reimplemented) — an invalid or expired token is a real `401`.
A verified token must resolve to a `customer.customers` row for its
`userId`; if none exists, the request `401`s with "No customer profile
exists for this account" rather than silently proceeding as a guest or
fabricating a customer record. A **missing** Bearer token is a legitimate
guest request, identified via the `X-Cart-Token` header instead.

## IDOR protection

`CartService.assertOwnership()`/`CheckoutService.assertOwnership()` run on
every read and mutation:

- An authenticated customer may only act on a cart/checkout whose
  `customerId` matches their own.
- A guest may only act on a cart/checkout whose `guestToken` matches the
  one they presented via `X-Cart-Token`.
- Neither may act on the other's resource, and a guest token guessed or
  reused against the wrong cart never succeeds — `guestToken` is
  `crypto.randomBytes(32).toString('base64url')`, 256 bits of entropy,
  making enumeration or guessing infeasible.

Proven, not just declared: `test/cart-checkout.e2e-spec.ts`'s "Cart IDOR
protection" and "Authenticated customer cart" sections assert a mismatched
actor never reaches another actor's cart, and that a Bearer token with no
backing customer profile is rejected outright.

## Never trusting client-supplied price, discount, or availability

The brief's own absolute rule, structurally enforced: `PricingResolver.
resolve()` is the **only** place a total is computed, and every input it
reads (`base_price` from a real catalog `PricingService.get()` call,
`taxRateBasisPoints` from the live SKU, coupon rules re-validated against
`marketing.Coupon` on every apply _and_ every reprice, shipping cost
resolved server-side from `ShippingMethod` + destination) comes from
real storage, never a request body. There is no DTO field anywhere in this
module that accepts a price, discount amount, or tax amount from the
client. Inventory availability is checked the same way — every add-to-cart
and every `validate()` call re-reads `StockQueryService.getAvailability()`
live, never trusting a cart line's stale `unitPriceSnapshot`/quantity as
proof of current availability.

## Idempotency and replay

See `docs/api/cart-checkout.md`'s "Idempotency" table for the full
per-operation mechanism. The security-relevant property: `CheckoutSession.
idempotencyKey` and `InventoryReservation.idempotencyKey` are both real
unique database constraints, not an application-level "have I seen this
key before" cache that a restart or a race could bypass — and both are now
race-safe under real concurrent duplicate submissions, not only sequential
retries (found via this module's own concurrency e2e suite; see
`docs/architecture/cart-checkout.md`'s "Concurrency, proven not assumed"
section for the exact failure mode and fix).

## Reservation integration reuses Phase 006's proven invariants

This module never mutates inventory state directly — `CheckoutService.
reserve()`/`cancel()`/`expire()` call Phase 006's real `ReservationService.
reserve()`/`release()`, inheriting that module's own concurrency-safe,
never-oversells guarantee (`SELECT ... FOR UPDATE` row locking, proven by
Phase 006's own mandatory concurrency test) rather than re-implementing
any part of it. This module's own mandatory concurrency suite
(`test/cart-checkout.e2e-spec.ts`) re-proves the invariant holds end-to-end
through the checkout API surface specifically: multiple guest checkouts
racing for the same limited-stock SKU never oversell, and a checkout
reservation racing against a direct/POS reservation for the same stock
never lets their combined total exceed what's actually available.

## Prescription reference: no fabricated validation

`PrescriptionReferenceValidator` never claims a prescription reference is
`'valid'` — only `'unverified'` (a well-formed UUID, existence/ownership
unknown) or `'invalid_shape'` (malformed). `POST /checkout/:id/validate`
rejects the malformed case (`PRESCRIPTION_REFERENCE_UNVERIFIED` issue code)
but never asserts the referenced prescription actually exists or belongs
to the customer — no `Prescription` table exists yet to check against. This
is a deliberate, documented gap (ADR-007 decision 9), not a silently
incomplete check presented as complete.

## What's proven, not just declared

- **Guest cart enumeration is infeasible.** 256-bit random guest tokens,
  never sequential or derivable from any other value.
- **IDOR is rejected**, proven directly in `test/cart-checkout.e2e-spec.ts`,
  not inferred: one guest cannot read or mutate another guest's cart; an
  admin Bearer token (no customer profile) is rejected on every cart
  route; merging a guest cart requires authentication.
- **Illegal checkout state transitions are rejected**, independent of
  ownership — even the checkout's own owner gets a `409` from
  `CartCheckoutDomainExceptionFilter` for an out-of-order transition (e.g.
  `ready-for-payment` straight from `OPEN`, skipping `VALIDATING`).
- **Overselling is rejected under real concurrency**, both at the
  checkout-vs-checkout level and the checkout-vs-direct-reservation level
  — see "Reservation integration" above.
- **No direct-mutation endpoint exists for price, discount, tax, or
  inventory availability anywhere in this module.**

## Deliberately not built this phase

- **No rate limiting specific to cart/checkout mutation** — same blanket
  nginx `limit_req_zone` as everything else in this service (see
  `docs/security/README.md`'s "Not yet" list). The brief's "rate-limit
  guest cart mutation where appropriate" is not a per-module control this
  phase adds.
- **No audit logging for cart/checkout mutations.** Unlike catalog/
  inventory (which write `system.AuditLog` for admin-privileged actions),
  cart/checkout has no privileged admin operations to audit — every
  mutation here is a customer/guest acting on their own resource, the
  same category of action identity's own `system.AuditLog` doesn't cover
  either (it's scoped to permission-gated admin actions).
- **No separate service-to-service auth** for the reservation calls this
  module makes into `modules/inventory` — same in-process direct service
  injection as every other cross-module call in this codebase, not a
  network hop needing its own credential.
- **No CAPTCHA/bot-mitigation on guest cart creation** — `POST /cart` with
  no token is unauthenticated by design; abuse mitigation beyond the
  blanket rate limit above is out of scope this phase.
