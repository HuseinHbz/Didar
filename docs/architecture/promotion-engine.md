# Promotion, discount & coupon engine architecture (Phase 010)

Full design rationale: [`docs/adr/ADR-010-promotion-engine.md`](../adr/ADR-010-promotion-engine.md).
Full layering/scope detail: [`services/api/src/modules/promotion/README.md`](../../services/api/src/modules/promotion/README.md).
This document is the short "where does the promotion engine fit in the
system" view — read it alongside
[`docs/architecture/README.md`](README.md), which it extends rather than
replaces.

## Where it sits

```
storefront / admin / pwa / mobile
                │
        services/api (NestJS)
                │
        modules/promotion           ← Phase 010, this document
   (domain → application → infrastructure/presentation)
        │              │              │
   cart-checkout      order        catalog / customer
   (CartPricingService, (OrderConversion   (SkuRepository reads for
    CheckoutService)     Service)           targeting; CustomerSegment
        │                                   reads for eligibility)
   BullMQ queues (in-process — promotion_expiration,
   coupon_reservation_cleanup)
        │
   packages/database (Prisma)      Redis (queues only — never
        │                           authoritative for promotion state)
   PostgreSQL
   marketing schema (promotions/promotion_rules/promotion_targets/
   coupons/coupon_redemptions), commerce schema (order_promotions)
```

Same shape every other domain module in `services/api` follows — the
seventh full clean-architecture example after `modules/identity` (Phase
004), `modules/catalog` (Phase 005), `modules/inventory` (Phase 006),
`modules/cart-checkout` (Phase 007), `modules/payment` (Phase 008), and
`modules/order` (Phase 009). Unlike `order` (which is _composed from_
four prior modules' services), this module is composed the other way:
`cart-checkout` and `order` each import `PromotionModule` and consume
its exported `PromotionResolutionService`/`CouponRedemptionService` —
this module depends on neither of them.

## A discount is never a price change — it's a transactional adjustment computed at pricing time

Two real pricing surfaces already existed before this phase:
`finance.ProductPrice` (a SKU's catalog price, Phase 005) and
`cart-checkout`'s `PricingResolver`/`DiscountCalculator` (the one real
place `subtotal → discount → tax → shipping → grandTotal` happens, Phase
007). This phase never writes to `ProductPrice` — a promotion always
produces a computed adjustment at resolution time, never a stored price
mutation, so the same SKU's catalog price stays the single source of
truth for "what does this cost with no promotions at all."

`PricingResolver.resolve()`'s single `coupon: CouponRule | null` input
became `adjustments: readonly PricingAdjustmentInput[]` (ADR-010
decision 7) — a strict superset, not a rewrite. `PromotionResolutionService`
(this module) is the only producer of that array; every pre-existing
`cart-checkout` pricing test kept its exact expected numbers after the
change.

## Eligibility and discount calculation are two separate, pure services

`EligibilityEngine` decides _whether_ a promotion applies (time window,
status, cart minimum, targeting, `PromotionRule` conditions, usage
limits already fetched). `DiscountEngine` decides _how much_, dispatched
by `discountType`. Neither calls the other; `PromotionResolver` is the
only caller of both, always in that order. Both are zero-I/O, unit-tested
without a database — the pure-function boundary this codebase has used
for every domain-layer state machine and calculator since Phase 004.

`PromotionResolver` itself takes no input but the cart lines, the
already-resolved customer/segment context, and the already-fetched list
of active promotions/coupons — no DB calls, no wall-clock read inside
the pure function (the caller resolves "now" once and passes it in), so
the same cart + the same promotion/coupon state always produces the same
result.

## Stacking and exclusivity resolve to one deterministic answer, never DB row order

Every eligible promotion is ordered `(priority ASC, id ASC)` — `id` as
the final tiebreak so Postgres's lack of an ordering guarantee without an
explicit `ORDER BY` is never relied on. `PromotionResolver` walks that
list once (ADR-010 decision 5's acceptance rules), then re-orders the
_accepted_ set into calculation order
(`FIXED_PRICE`/`BUNDLE_PRICE → item FIXED_AMOUNT → BUY_X_GET_Y →
PERCENTAGE → cart FIXED_AMOUNT → FREE_SHIPPING`) and applies each step
against a running per-line _remaining_ amount, so stacked percentages
compound multiplicatively (20% then 10% = 28% off, never 30%).

## PostgreSQL is the single source of truth; one real invariant is enforced with a row lock and a CHECK constraint, not application trust

**Coupon/promotion usage-limit reservation**
(`PrismaCouponRepository.reserve()`) — `SELECT ... FOR UPDATE` on the
coupon (or the promotion, for the couponless path) inside a transaction,
re-summing already-active (`RESERVED`/`REDEEMED`) redemptions under that
lock before inserting the new row and bumping the cached `usageCount`.
Two truly concurrent reservation attempts for the same coupon/promotion
serialize on this lock rather than racing a check-then-insert — the same
`mutateInventoryItem`/`lockAndSumFulfilled` technique already proven in
`inventory`/`order`. A real Postgres `CHECK` constraint
(`promotion_usage_within_limit`/`coupon_usage_within_limit`) backstops
the cached counter directly in the database — even a future bug in the
application-layer lock discipline cannot push it past its declared
limit.

Redis is used **only** for the two BullMQ sweep queues
(`promotion_expiration`, `coupon_reservation_cleanup`), never to answer
"is this coupon still valid" — every such read goes to Postgres.

## The redemption ledger is one table for two usage paths

`marketing.CouponRedemption` tracks every accepted promotion — coupon-
gated or automatic (`couponId` nullable, `promotionId` always set) —
rather than two near-duplicate tables (ADR-010 decision 8): an automatic
promotion's usage limit (Promotion C's free-shipping threshold) is just
as real an invariant as a coupon's, so both share one concurrency-safe
`reserve()`/`finalize()`/`release()` lifecycle. `RESERVED` at checkout
`readyForPayment()`, `REDEEMED` at order PAID
(`CouponRedemptionService.finalize()`, called from
`OrderConversionService`), `RELEASED` at checkout cancel/expire or via
the `coupon_reservation_cleanup` sweep. A row is never deleted.

## What changed outside `modules/promotion` itself

- **`packages/database/prisma/schema.prisma`** — the Phase 003
  placeholder `marketing.Coupon`/`Promotion`/`CouponRedemption`/
  `PromotionProduct` subtree dropped and replaced with the real one: 6
  new enums, `Promotion`/`PromotionRule`/`PromotionTarget`/`Coupon`/
  `CouponRedemption` in `marketing`, plus a new `commerce.OrderPromotion`
  immutable-snapshot table and an `Order.promotions` relation — see
  `docs/database/promotion-erd.md`.
- **`packages/types`** — 6 new branded IDs, 6 new enum unions.
- **`services/api/app.module.ts`** — registers `PromotionModule`.
- **`services/api/src/modules/cart-checkout/domain/services/discount-calculator.ts`/`pricing-resolver.ts`**
  — `coupon: CouponRule | null` → `adjustments: readonly PricingAdjustmentInput[]` +
  `freeShipping: boolean`; a new `applyAdjustments()`/
  `allocateByProductSkuId()` pair generalizes the existing
  `allocateByLineShare()` cart-scoped allocator to line-scoped adjustments
  too, same floor-then-remainder-to-last-line rounding rule.
- **`services/api/src/modules/cart-checkout/application/cart-pricing.service.ts`/`cart.service.ts`/`checkout.service.ts`**
  — inject `PromotionResolutionService`/`CouponRedemptionService`
  directly (the "next phase adds an additive hook" pattern); the old
  `COUPON_LOOKUP_PORT`/`PrismaCouponLookupRepository` (a Phase 007
  placeholder reading the Phase 003 schema directly) are deleted outright,
  not left dangling.
- **`services/api/src/modules/order/domain/ports/order.repository.port.ts`/`prisma-order.repository.ts`**
  — additive `addPromotions(orderId, promotions[])`.
- **`services/api/src/modules/order/application/order-conversion.service.ts`**
  — after order creation, reads the frozen checkout's
  `pricingSnapshot.appliedPromotions`, maps `productSkuId → real
OrderItem.id`, writes the immutable `OrderPromotion` snapshot; after
  the PAID transition, calls `CouponRedemptionService.finalize()`.
- **RBAC data** — 13 new `promotion.*`/`coupon.*` permissions, two new
  roles (`promotion_manager`, `promotion_editor`) — see
  `docs/security/promotion-security.md`.

Nothing in `cart-checkout`'s or `order`'s own pre-existing behavior
changed beyond these additive hooks — verified by re-running every prior
phase's own e2e suite unchanged (with one expected, documented exception:
one `cart-checkout.e2e-spec.ts` assertion updated from a hardcoded
`shippingTotal: '500000'` to `'0'`, because the newly-seeded automatic
free-shipping promotion now correctly zeroes it for a cart that clears
its minimum — a real behavior change from a real seeded promotion, not a
regression).

## Frontend: deliberately not built this phase

Same precedent every prior backend phase set. No promotion-discovery or
coupon-entry UI exists; `POST /cart/coupon`/`DELETE /cart/coupon` and the
admin `/admin/promotions/*`/`/admin/coupons/*` routes are the complete
surface this phase ships.

## Known, deliberate gaps

- **No live recalculation of an already-open cart** the instant an admin
  edits a promotion mid-flight — a cart's automatic promotions are only
  as fresh as its last `price()` call, the same staleness window a
  coupon's own re-validation already tolerated in Phase 007.
- **No customer-facing promotion discovery/browsing endpoint** — only
  apply/remove + admin CRUD exist this phase.
- **No channel-based targeting** — no channel concept exists yet in this
  codebase to target against.
- **`OrderResponseDto` does not yet expose an order's applied
  promotions** — the data is real and correctly written
  (`commerce.order_promotions`), it just isn't surfaced in that one
  customer-facing response shape yet; verified directly via Prisma in
  the e2e suite instead.
- **No automatic coupon-usage "un-burn" on refund** — same no-automatic-
  restock precedent `docs/product/payment.md` already set for inventory
  restock-on-cancellation, extended here rather than special-cased.

## Concurrency, proven not assumed

`test/promotion.e2e-spec.ts`'s concurrency section fires 15 concurrent
`ready-for-payment` confirmations through the full HTTP checkout flow
against a `usageLimit: 1` coupon and asserts exactly one succeeds — the
other 14 either get a real `409` or a known transport-layer `ECONNRESET`
under the harness's connection-pool pressure (filtered out before
asserting, same documented artifact `inventory.e2e-spec.ts`'s own 100-way
concurrency test already established). `test/promotion-repository.e2e-spec.ts`
independently proves the same invariant directly at the repository layer
— 20 concurrent `reserve()` calls, no HTTP, no connection-pool pressure
at all — plus per-customer limits (genuinely per-customer, not a
disguised global cap), the re-reservation upsert (never a double-count),
and the full `RESERVED → REDEEMED`/`RELEASED` lifecycle's idempotency.
