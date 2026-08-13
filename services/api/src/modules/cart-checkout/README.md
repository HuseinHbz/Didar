# modules/cart-checkout

Phase 007's clean-architecture module for cart, checkout, server-side
pricing resolution, and inventory reservation integration. Same layering
convention `modules/identity`, `modules/catalog`, and `modules/inventory`
established (see any of those modules' own README for the full explanation
of the pattern):

```
cart-checkout/
├── domain/
│   ├── entities/    — plain TS classes: Cart, CartItem, CartItemOption,
│   │                  CartPriceSnapshot, CartCoupon, CartShippingSelection,
│   │                  ShippingMethod, CheckoutSession, CheckoutAddress,
│   │                  CheckoutTotals, CheckoutValidationResult,
│   │                  CheckoutReservation. No Prisma/NestJS dependency.
│   ├── ports/       — two aggregate-root composite repository ports
│   │                  (CartRepositoryPort, CheckoutSessionRepositoryPort —
│   │                  no separate port per child entity, mirroring Phase
│   │                  006's StockTransferRepositoryPort precedent), plus
│   │                  ShippingMethodRepositoryPort, CustomerLookupPort,
│   │                  CouponLookupPort.
│   └── services/    — pure business logic, zero I/O, unit-tested without a
│                      database (42 tests across 8 spec files):
│                        CartConsolidationRules       — configuration hashing
│                        CartQuantityRules             — quantity validity/availability
│                        DiscountCalculator            — coupon math, deterministic rounding
│                        TaxCalculator                 — per-line tax on the post-discount amount
│                        ShippingCalculator             — method eligibility + cost
│                        PricingResolver                — the one place base_price ->
│                                                          resolved_unit_price -> discount ->
│                                                          tax -> shipping -> grand_total happens
│                        CheckoutStateMachine            — the 6-state checkout graph
│                        PrescriptionReferenceValidator — honestly incomplete (see below)
├── application/     — CartService, CheckoutService, CartPricingService (the
│                      application-layer home for the configurable pricing
│                      inputs — tax default, coupon rules, shipping cost).
├── infrastructure/
│   ├── repositories/   — one Prisma-backed implementation per port.
│   ├── cart.mapper.ts / checkout.mapper.ts — Prisma-row -> domain-entity
│   │                      mappers, incl. bigint<->string breakdown JSON
│   │                      (de)serialization (`breakdownToJson`/`breakdownFromJson`).
│   └── queues/          — BullMQ producers/consumers (see "Queues").
└── presentation/
    ├── controllers/  — CartController (/cart/*), CheckoutController (/checkout/*).
    ├── dto/           — request/response DTOs, class-validator + @nestjs/swagger.
    ├── guards/        — ActorResolverGuard (see "Guest + authenticated auth").
    ├── decorators/    — @CurrentActor().
    ├── filters/       — CartCheckoutDomainExceptionFilter.
    └── request-context.ts — CartCheckoutActor/ActorResolvedRequest shapes.
```

Dependency direction is one-way:
`presentation → application → domain ← infrastructure`, verified the same
way identity/catalog/inventory's is — `domain/services/*.spec.ts`
unit-tests the pure logic with zero DB, zero NestJS test module, zero
mocks.

Full design rationale for every non-obvious decision below:
[`docs/adr/ADR-007-cart-checkout.md`](../../../../../docs/adr/ADR-007-cart-checkout.md).

## Cart and Checkout are separate aggregates, different lifetimes

`Cart` is long-lived and freely-mutable (`ACTIVE|CHECKOUT_STARTED|
ABANDONED|CONVERTED|EXPIRED`, survives across browsing sessions, a 30-day
rolling TTL that resets on every mutation via `CartService.touch()`).
`CheckoutSession` is short-lived and increasingly locked down
(`OPEN → VALIDATING → READY_FOR_PAYMENT`, a fixed 20-minute TTL extended
only by an explicit `POST /checkout/:id/refresh`, with `EXPIRED`/
`CANCELLED` off-ramps from any non-terminal state and `CONVERTED` reachable
only from `READY_FOR_PAYMENT`). `CheckoutSession.cartId` points back at the
cart it snapshot; the cart itself moves to `CHECKOUT_STARTED` while a
checkout is in flight (ADR-007 decision 1).

## Reservation and catalog reads are real service injection, never reimplemented

The brief's own absolute rule: "use Phase 006 inventory reservation instead
of direct stock mutation," "do not duplicate reservation logic." This
module imports `CatalogModule` (for `ProductsService`/`SkusService`/
`PricingService`) and `InventoryModule` (for `ReservationService`/
`AllocationService`/`StockQueryService`) and injects those real services
directly — both modules gained small, additive `exports` arrays for exactly
this purpose (ADR-007 decisions 4-5). `CheckoutService.reserve()` is the
one place this module touches inventory: `AllocationService.allocate()`
picks a warehouse, `ReservationService.reserve()` holds the stock with
`sourceType: 'CHECKOUT'` and a deterministic idempotency key
(`checkout__<checkoutSessionId>__<productSkuId>`), and a `CheckoutReservation`
row remembers which `InventoryReservation` backs which cart line — never a
second copy of reservation state.

## Pricing is always server-side, never trusted from the client

`PricingResolver.resolve()` (pure, zero I/O) is the one place
`base_price → resolved_unit_price → discount → tax → shipping → subtotal →
grand_total` happens — every caller (`POST /cart/price`,
`POST /checkout/:id/price`) goes through it. Money is `bigint` throughout
(never `Float`); discount allocation across lines uses BigInt floor
division with the rounding remainder assigned to the last line, so
per-line discounts always sum to exactly the coupon's total discount.
Tax is computed on the **post-discount** amount, per line. A `CartPriceSnapshot`/
`CheckoutTotals` row is appended on every recalculation (never only computed
transiently and discarded) — the same cache-plus-ledger split ADR-006
decision 2 established for `InventoryItem`/`InventoryLedger`, reapplied here
(ADR-007 decision 2) so "historical checkout calculations must be
reproducible" is a structural property.

## Guest + authenticated auth (`ActorResolverGuard`)

Every cart/checkout controller is `@Public()` (the global `JwtAuthGuard`
would reject any request with no Bearer token, which would make guest
checkout impossible) plus a custom `ActorResolverGuard`. A _present_ Bearer
token still verifies strictly (a malformed/expired token is a real 401,
never silently downgraded to "guest") and resolves to the caller's
`customer.customers` row — if none exists for an authenticated user
(no `Customer` row for their `userId`), the request 401s rather than
silently creating a placeholder. Absence of a token is a legitimate guest
request, identified via the `X-Cart-Token` header. The guard writes
`request.actor: {customerId, guestToken}` (exactly one non-null); the
`@CurrentActor()` decorator reads it — the same "guard writes, decorator
reads" shape identity's own `JwtAuthGuard`/`CurrentUserId` pair uses.

## Prescription reference: readiness only, honestly incomplete

No `Prescription` entity exists anywhere in this schema (a later phase's
job). `PrescriptionReferenceValidator.validate()` returns `'unverified'`
(never a fabricated `'valid'`) for any well-formed UUID reference passed as
a `CartItemOption` with `optionType: 'PRESCRIPTION_REFERENCE'`, and
`'invalid_shape'` for a malformed one — this module supports carrying the
_reference_ through cart/checkout and rejects a structurally malformed one
at `POST /checkout/:id/validate`, but makes no claim about whether the
referenced prescription actually exists, belongs to the customer, or is
compatible with the product. See ADR-007 decision 9.

## Queues

Two BullMQ queues, registered in-process inside `services/api` (same
ADR-006 decision 8 precedent) via `infrastructure/queues/cart-checkout-queue.module.ts`:

- **`checkout_expiration`** — a recurring sweep (BullMQ v6's
  `upsertJobScheduler`, every 60s) that reads
  `CheckoutSessionRepositoryPort.listExpirable()` and calls
  `CheckoutService.expire()` on each due session, releasing every
  reservation it holds.
- **`cart_abandonment`** — the same shape, every 15 minutes, calling
  `CartService.abandon()` on every `ACTIVE` cart whose `expiresAt` has
  passed.

A recurring sweep (not one delayed job per resource, the shape
`ReservationExpirationQueueService` uses) is the deliberate choice here:
`refresh()`/`touch()` can push `expiresAt` forward _after_ a delayed job
might already be scheduled, so a sweep that always re-reads current state
is simpler and correct where a per-resource job would need to reschedule
on every extension. See ADR-007 decision 3 for the full rationale.

The queue module cannot import this module's own composition root
(`cart-checkout.module.ts` imports the queue module, not the reverse — that
would be a cycle), so it re-declares `CartService`/`CheckoutService`/
`CartPricingService` as separate instances with their own repository-port
bindings — the same precedent `InventoryQueueModule` set for
`ReservationService`/`LowStockService`. It _does_ import `CatalogModule`/
`InventoryModule` directly (no cycle risk there) and reuses their exported
singletons rather than re-declaring those too.

## Concurrency safety, proven

Idempotent-under-real-race, not just idempotent-on-sequential-retry: two
`prisma.upsert()` calls racing on the same unique key (`CheckoutSession.
idempotencyKey`, `CartItem`'s `(cartId, productSkuId, configurationHash)`)
can both pass Postgres's default READ COMMITTED "does a row exist" check
and both attempt the insert branch — the unique index lets exactly one
`INSERT` through and surfaces the loser as a `P2002` violation. Both
`PrismaCheckoutSessionRepository.create()` and `PrismaCartRepository.
addItem()` catch that violation and re-read the winner's row instead of
ever letting a concurrent duplicate throw — found and fixed via this
module's own e2e concurrency suite (`test/cart-checkout.e2e-spec.ts`'s
"Concurrency safety (mandatory)" section), not assumed correct.

Reservation-level overselling is Phase 006's own proven invariant, reused
unmodified — this module never re-implements the `SELECT ... FOR UPDATE`
row-locking that guarantees it.

## Deliberately out of scope this phase

Same list as [`docs/product/cart-checkout.md`](../../../../../docs/product/cart-checkout.md)
and ADR-007's own "Deferred" section:

- Full `Order` creation/lifecycle — `CheckoutSession` reaching
  `READY_FOR_PAYMENT` is the interim payment-ready artifact.
- Any payment provider integration (Phase 008).
- Full promotion-stacking/campaign engine, full loyalty-point redemption —
  coupons apply against the real `marketing.Coupon`/`CouponRedemption`
  (read-only from this module).
- Real prescription existence/ownership/compatibility validation.
- Admin CRUD for `ShippingMethod` — seed/config data this phase (read-only
  port: `findById`/`findByCode`/`listActive`).
- Multi-currency, external carrier rate integration, multi-zone shipping
  graphs.
- A dedicated generic idempotency-key store — idempotency is achieved
  per-operation via existing unique keys / state-machine no-op checks.
