# Cart/checkout architecture (Phase 007)

Full design rationale: [`docs/adr/ADR-007-cart-checkout.md`](../adr/ADR-007-cart-checkout.md).
Full layering/scope detail: [`services/api/src/modules/cart-checkout/README.md`](../../services/api/src/modules/cart-checkout/README.md).
This document is the short "where does cart-checkout fit in the system"
view — read it alongside [`docs/architecture/README.md`](README.md), which
it extends rather than replaces.

## Where it sits

```
storefront / admin / pwa / mobile
                │
        services/api (NestJS)
                │
        modules/cart-checkout     ← Phase 007, this document
   (domain → application → infrastructure/presentation)
        │              │                │
        │              │          modules/catalog (real service
        │              │           injection: ProductsService/SkusService/
        │              │           PricingService — no re-derived port)
        │              │
        │        modules/inventory (real service injection:
        │         ReservationService/AllocationService/StockQueryService —
        │         never a second reservation implementation)
        │
   BullMQ queues (in-process — checkout_expiration, cart_abandonment)
        │                    │
   packages/database (Prisma)      Redis (queues only — never
        │                           authoritative for cart/checkout state)
   PostgreSQL
   commerce schema (Cart*/CheckoutSession* tables)
```

Same shape every other domain module in `services/api` follows — the
fourth full clean-architecture example after `modules/identity` (Phase
004), `modules/catalog` (Phase 005), and `modules/inventory` (Phase 006).
It is the **first** module composed almost entirely from other modules'
exported services rather than owning its own catalog/inventory logic:
where inventory reused identity's audit-log repository and catalog's
`SkuLookupPort`, cart-checkout goes further and imports `CatalogModule`/
`InventoryModule` wholesale for their real `ProductsService`/
`SkusService`/`PricingService`/`ReservationService`/`AllocationService`/
`StockQueryService` — see ADR-007 decisions 4-5 for exactly why that's the
right call here (pricing/lifecycle/reservation logic is not an identity
concept worth re-deriving through a minimal port, unlike SKU existence).

## PostgreSQL is the single source of truth

The brief's own absolute rule, reapplied from Phase 006: Redis is used
**only** for the two BullMQ sweep queues (`checkout_expiration`,
`cart_abandonment`), never to answer "what's in this cart" or "is this
checkout still valid" — every such read goes to Postgres. `Cart`/
`CheckoutSession` carry current totals as a fast-read cache (mirroring
`InventoryItem`'s own cache-plus-ledger split), but `CartPriceSnapshot`/
`CheckoutTotals` are the append-only ledger living in the same database, in
the same transaction — "cache" means "derived and kept in sync," never "a
different, potentially-stale store."

## What changed outside `modules/cart-checkout` itself

- **`packages/database/prisma/schema.prisma`** — the `commerce` schema's
  cart/checkout section was rewritten: `Cart`/`CartItem` extended
  (guest-token rename, configuration snapshot/hash, new `expiresAt`), six
  new models (`CartItemOption`, `CartPriceSnapshot`, `CartCoupon`,
  `CartShippingSelection`, `ShippingMethod`, and the entire
  `CheckoutSession`/`CheckoutAddress`/`CheckoutTotals`/
  `CheckoutValidationResult`/`CheckoutReservation` subtree) — see
  `docs/database/cart-checkout-erd.md`.
- **`packages/types`** — 11 new branded IDs, 6 new enum unions, and
  `PriceLineBreakdown`/`PricingResolutionResult` shapes for the pricing
  engine's output contract.
- **`services/api/app.module.ts`** — registers `CartCheckoutModule`
  alongside `HealthModule`/`IdentityModule`/`CatalogModule`/`InventoryModule`.
- **`services/api/src/modules/catalog/catalog.module.ts`** — additive
  `exports: [ProductsService, SkusService, PricingService]`.
- **`services/api/src/modules/inventory/inventory.module.ts`** — additive
  `exports: [ReservationService, AllocationService, StockQueryService]`.
- **`services/api/src/modules/identity/identity.module.ts`** — additive
  `exports: [JwtTokenService]`, used by `ActorResolverGuard` to verify an
  optional Bearer token without reimplementing JWT verification.
- **RBAC data** — none. Every route this module exposes is customer/guest
  facing, gated by `ActorResolverGuard` + per-resource ownership checks,
  not `@RequirePermission`/`@RequireModule` — see
  `docs/security/cart-checkout-security.md`.

Nothing in `modules/identity`, `modules/catalog`, or `modules/inventory`'s
own domain/application logic changed beyond the three additive `exports`
arrays above — every one of those changes is behavior-preserving, verified
by re-running each phase's own existing unit/e2e suite unchanged.

## Frontend: deliberately not built this phase

`apps/storefront`/`apps/admin` are untouched — same precedent every prior
backend phase set (see `docs/product/cart-checkout.md`). The API surface
this phase ships (`docs/api/cart-checkout.md`) is what a future storefront
phase integrates against, and what Phase 008 (payment orchestration)
integrates against at the service level: a `CheckoutSession` reaching
`READY_FOR_PAYMENT` with a fixed, reproducible `grandTotal` and a fixed
reservation set is the exact seam that phase builds on.

## Cart and Checkout are separate aggregates, not one state machine

A `Cart` is a long-lived, freely-mutable wishlist. A `CheckoutSession` is a
short-lived, increasingly-locked-down process that snapshots a cart at one
point in time and drives it toward payment. Collapsing these into one
entity (the way `Cart.status` alone tried to in Phase 003) would force the
same row to mean two different things at two different lifetimes — see
ADR-007 decision 1 for the full state graph and why `CheckoutSession.
cartId` (not a shared status field) is the link between them.

## Concurrency, proven not assumed

The mandatory concurrency suite
(`services/api/test/cart-checkout.e2e-spec.ts`'s "Concurrency safety
(mandatory)" section) found and fixed a real gap during this phase's own
development, not just confirmed a design on paper: `prisma.upsert()` alone
is not race-safe against two truly simultaneous callers racing on the same
unique key (`CheckoutSession.idempotencyKey`, a `CartItem`'s
`(cartId, productSkuId, configurationHash)`) — Postgres's default READ
COMMITTED isolation lets both callers pass the "does a row exist" check,
and the loser surfaces as a `P2002` unique-constraint violation instead of
silently falling back to the update branch. Both affected repository
methods now catch that violation and re-read the winner's row, so
"idempotent" holds for concurrent racers, not only sequential retries. See
that e2e file's own doc comments for the full account.
