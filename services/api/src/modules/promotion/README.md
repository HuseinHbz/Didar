# modules/promotion

Phase 010's clean-architecture module for the promotion/discount/coupon
engine: replaces Phase 003's placeholder `marketing` schema subtree with
a real multi-promotion eligibility + discount + stacking engine, a
coupon lifecycle with a concurrency-safe redemption ledger, and the
`cart-checkout`/`order` integration hooks that let both consume it
without either duplicating its math. Same layering convention every
prior module established:

```
promotion/
├── domain/
│   ├── entities/    — plain TS classes: Promotion, PromotionRule,
│   │                  PromotionTarget, Coupon, CouponRedemption. No
│   │                  Prisma/NestJS dependency. Constructors are public
│   │                  (lighter than some prior modules' private-
│   │                  constructor pattern — these are plain data
│   │                  holders with no invariant a constructor itself
│   │                  needs to guard); every one also exposes a static
│   │                  `fromPersistence()` factory.
│   ├── value-objects/ — CouponCode (`normalize()`/`isValidShape()` —
│   │                    trim+uppercase, one real unique DB constraint
│   │                    downstream, never an app-level convention alone).
│   ├── errors/      — CouponNotApplicableError (the one error every
│   │                  "why didn't my coupon work" case collapses into —
│   │                  ADR-010 decision 2's no-enumeration-leakage rule),
│   │                  InvalidPromotionTransitionError,
│   │                  InvalidCouponTransitionError,
│   │                  CouponUsageLimitExceededError.
│   ├── ports/       — PromotionRepositoryPort (aggregate root over
│   │                  rules/targets — same "child rows, no independent
│   │                  lifecycle" shape OrderRepositoryPort already
│   │                  established), CouponRepositoryPort (owns the one
│   │                  concurrency-critical `reserve()` contract — see
│   │                  its own doc comment), CustomerContextPort (the
│   │                  one DB-touching boundary the pure resolver needs
│   │                  resolved for it — segment membership,
│   │                  first-purchase status).
│   └── services/    — pure business logic, zero I/O, unit-tested without
│                      a database:
│                        EligibilityEngine   — the *only* place that
│                                              decides whether a
│                                              promotion applies (time
│                                              window, status, cart
│                                              minimum, targeting,
│                                              PromotionRule conditions,
│                                              usage limits already
│                                              fetched)
│                        DiscountEngine      — the *only* place that
│                                              decides how much; dispatches
│                                              by discountType, floor-caps
│                                              every result at zero and at
│                                              maximumDiscount
│                        PromotionResolver   — orders eligible promotions
│                                              (priority ASC, id ASC),
│                                              applies stacking/exclusivity
│                                              (ADR-010 decision 5), and
│                                              runs DiscountEngine per
│                                              accepted promotion against a
│                                              running per-line remaining
│                                              amount so stacked
│                                              percentages compound
│                                              correctly. No DB calls.
│                        PromotionLifecycle,
│                        CouponLifecycle     — state machines
├── application/     — PromotionService, CouponService (admin CRUD +
│                      lifecycle), PromotionResolutionService (the
│                      cart-facing entry point — resolves live catalog/
│                      customer context, then calls PromotionResolver),
│                      CouponRedemptionService (reserve/finalize/release,
│                      the ledger's own application-layer facade).
├── infrastructure/
│   ├── repositories/ — PrismaPromotionRepository, PrismaCouponRepository
│   │                    (raw `SELECT ... FOR UPDATE` via `tx.$queryRaw`
│   │                    for `reserve()`), PrismaCustomerContextRepository
│   │                    (reuses `customer.CustomerSegment`/
│   │                    `CustomerSegmentMember` directly — no new table).
│   └── queues/        — BullMQ producers/consumers (see "Queues").
└── presentation/
    ├── controllers/  — PromotionAdminController (/admin/promotions/*),
    │                   CouponAdminController (/admin/coupons/*). The
    │                   customer-facing `/cart/coupon` routes live in
    │                   `cart-checkout`'s own `CartController` — this
    │                   module has no customer-facing controller of its
    │                   own, only the admin surface (ADR-010 decision 7).
    ├── dto/           — request/response DTOs, class-validator + @nestjs/swagger.
    └── filters/       — PromotionDomainExceptionFilter.
```

Dependency direction is one-way:
`presentation → application → domain ← infrastructure`, verified the same
way every prior module's is — `domain/services/*.spec.ts` and
`domain/value-objects/*.spec.ts` unit-test the pure logic with zero DB,
zero NestJS test module, zero mocks.

Full design rationale for every non-obvious decision below:
[`docs/adr/ADR-010-promotion-engine.md`](../../../../../docs/adr/ADR-010-promotion-engine.md).

## This module extends `cart-checkout`'s pricing pipeline; it never duplicates it

`PricingResolver.resolve()` (Phase 007) used to take a single
`coupon: CouponRule | null`. It now takes
`adjustments: readonly PricingAdjustmentInput[]` — a strict
generalization, not a rewrite: one cart-scoped coupon was always
expressible as one cart-scoped adjustment, so every pre-existing
`cart-checkout` pricing test keeps its exact expected numbers unchanged.
`PromotionResolutionService.resolve()` is the _only_ producer of
`PricingAdjustmentInput[]` — it calls `PromotionResolver` (this module's
own pure domain service) and maps its output, never reimplementing
percentage/fixed/bundle math a second time anywhere in `cart-checkout`.

`CartPricingService` (cart-checkout) injects `PromotionResolutionService`
directly; `CheckoutService` (cart-checkout) injects
`CouponRedemptionService` directly; `OrderConversionService` (order)
injects `CouponRedemptionService` directly too — the same "next phase
adds an additive hook to the previous phase's service" composition
pattern every prior phase used, not a network hop or a duplicated
implementation.

## `PromotionModule` is imported directly by `cart-checkout` and `order`

Not the other way around — this module has no dependency on either.
`PromotionQueueModule` (this module's own BullMQ registration) cannot
import `PromotionModule` back (cycle risk: `PromotionModule` imports
_it_), so it re-declares its own repository-port bindings as fresh
instances bound to the same stateless Prisma implementations — the same
"separate instance for the queue processors" precedent
`InventoryQueueModule`/`CartCheckoutQueueModule`/`OrderQueueModule`
already established.

## The redemption ledger: one table, two usage paths, one concurrency technique

`marketing.CouponRedemption` tracks _every_ accepted promotion —
coupon-gated or automatic alike (`couponId` nullable, `promotionId`
always set), generalized rather than split into two near-duplicate
tables (ADR-010 decision 8). Lifecycle: `RESERVED` (checkout
`readyForPayment()`) → `REDEEMED` (order PAID, via
`CouponRedemptionService.finalize()`) or → `RELEASED` (checkout
cancel/expire, or the `coupon_reservation_cleanup` sweep). A row is
never deleted.

**Concurrency, the mandatory invariant**: `CouponRepositoryPort.reserve()`
row-locks the `Coupon` (or `Promotion`, couponless path) with
`SELECT ... FOR UPDATE` inside a transaction, re-sums already-active
(`RESERVED`/`REDEEMED`) redemptions under that lock, and only then
inserts the new row and bumps the cached `usageCount` — the same
`mutateInventoryItem`/`lockAndSumFulfilled` technique this codebase
already uses for "never let a race exceed a numeric cap." A real Postgres
`CHECK` constraint (`promotion_usage_within_limit`/
`coupon_usage_within_limit`) is the backstop, not just the lock — even a
future bug in the application-layer lock discipline cannot push a cached
counter past its declared limit; the database itself refuses the write.

Proven, not assumed: `test/promotion.e2e-spec.ts`'s concurrency section
fires 15 concurrent `ready-for-payment` confirmations against a
`usageLimit: 1` coupon through the _full_ HTTP checkout flow;
`test/promotion-repository.e2e-spec.ts` independently fires 20 concurrent
`reserve()` calls directly at the repository layer, no HTTP involved.
Both converge to exactly one success.

## Eligibility and discount calculation are structurally separate services

`EligibilityEngine` is the only place that decides _whether_ a promotion
applies; `DiscountEngine` is the only place that decides _how much_.
Neither calls the other — `PromotionResolver` is the only caller of
both, in that order. This is what makes each one unit-testable in
isolation and keeps a future new discount type from being able to
silently change eligibility, or a future new eligibility rule from being
able to silently change a calculation.

## Targeting: composable, OR'd, zero rows = whole cart

`PromotionTarget` rows (`PRODUCT`/`SKU`/`CATEGORY`/`BRAND`/`COLLECTION`)
are OR'd — a cart line is targeted if it matches _any_ row. There is no
`ALL` target type: zero target rows already means "the whole cart"
unambiguously, and a redundant explicit-`ALL` row would just be a second
way to say the same thing. See ADR-010 decision 4 for why this is fixed
as a rule, not left to the resolver to infer per-call.

## Stacking and exclusivity: deterministic, total, never DB-row-order-dependent

Every eligible promotion is ordered `(priority ASC, id ASC)` — `id` as
the final tiebreak so row order from the database is never relied on.
`PromotionResolver` walks that list once, applying the acceptance rules
in ADR-010 decision 5, then re-orders the _accepted_ set into calculation
order (`FIXED_PRICE`/`BUNDLE_PRICE` → item-level `FIXED_AMOUNT` →
`BUY_X_GET_Y` → `PERCENTAGE` → cart-level `FIXED_AMOUNT` →
`FREE_SHIPPING`) and runs `DiscountEngine` against each step's _current_
remaining per-line amount — so two stacked 20%/10% promotions compound to
28% off, not 30%, and this is never implicit.

## Queues

Two BullMQ queues, registered in-process inside `services/api` via
`infrastructure/queues/promotion-queue.module.ts` — both reliability
backstops, neither correctness-critical (eligibility always reads the
live window; `reserve()`'s own lock is what's actually concurrency-safe):

- **`promotion_expiration`** — every 5 minutes, flips any `Promotion`/
  `Coupon` past its `endsAt`/`expiresAt` from an active status to
  `EXPIRED` — admin-list/audit readability only.
- **`coupon_reservation_cleanup`** — every 5 minutes, releases any
  `RESERVED` `CouponRedemption` older than 30 minutes — the backstop for
  a checkout that crashed or expired without ever calling
  `CheckoutService.expire()`'s own explicit release.

## No enumeration leakage, proven

`POST /cart/coupon` returns the exact same `400 CouponNotApplicableError`
shape whether the code doesn't exist, is expired, is not yet valid, is
disabled, or the cart simply doesn't qualify — proven by
`test/promotion.e2e-spec.ts` looping `DOESNOTEXIST`/`EXPIREDCODE`/
`FUTURECODE` through the same assertion.

## Known, deliberate gaps this phase

Same list as
[`docs/product/promotions.md`](../../../../../docs/product/promotions.md)
and ADR-010's own "Decision 11" section:

- No live recalculation of an already-open cart the instant an admin
  edits a promotion mid-flight — a cart's automatic promotions are only
  as fresh as its last `price()` call.
- No customer-facing promotion discovery/browsing endpoint — only
  apply/remove + admin CRUD.
- No channel-based targeting, A/B experiments, or scheduled
  auto-activation beyond the simple `startsAt` window.
- No automatic coupon-usage "un-burn" on refund — same no-automatic-
  restock precedent `docs/product/payment.md` already set for inventory.
- `OrderResponseDto` does not yet expose an order's applied promotions
  over the customer-facing API — the data is real and correctly written
  (`commerce.order_promotions`, verified directly via Prisma in
  `test/promotion.e2e-spec.ts`'s "checkout freeze and order snapshot"
  test), it just isn't surfaced in that one response shape yet.
