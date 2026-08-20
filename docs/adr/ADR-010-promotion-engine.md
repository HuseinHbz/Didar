# ADR-010: Promotion, Discount, Coupon & Pricing Rules Engine

## Status

Accepted — Phase 010.

## Context

Two real pricing surfaces already exist before this phase:

- **`finance.ProductPrice`/`PriceHistory`** (Phase 005) — a SKU's catalog
  price. Scheduled via `validFrom`/`validTo`, never touched by a discount.
  Promotions must never write to this table — a discount is a
  transactional adjustment applied at pricing time, not a price change.
- **`cart-checkout`'s `PricingResolver`/`DiscountCalculator`** (Phase 007)
  — the one real place `subtotal -> discount -> tax -> shipping ->
grandTotal` happens, pure and deterministic. Today it accepts exactly
  one `CouponRule | null`, resolved from a Phase-003 placeholder
  `marketing.Coupon` row via `CartCoupon` (one coupon slot per cart,
  `commerce.cart_coupons.cart_id @unique`) and `CouponLookupPort`.

Phase 003 also left a **placeholder** promotion subtree in the
`marketing` schema (`Coupon`, `CouponRedemption`, `Promotion`,
`PromotionProduct`) explicitly doc-commented as "future work" — a
ruleless, all-or-nothing percent/fixed discount scoped to a flat list of
products, with no eligibility engine, no stacking, no coupon lifecycle,
no concurrency-safe redemption ledger.

This phase replaces that placeholder with a real promotion engine and
**extends** (never duplicates) the Phase 007 pricing pipeline so multiple
simultaneous promotions can be resolved, ordered, and applied
server-side, with the exact same Money-safe, deterministic,
proportional-allocation arithmetic already proven in production for one
coupon.

## Decision 1 — Aggregate boundary: `Promotion` is the root, `Coupon` is a separate aggregate that unlocks it

`Promotion` owns its own eligibility (`PromotionRule`) and targeting
(`PromotionTarget`) child rows — same "aggregate root over child rows
with no independent lifecycle" shape `Order`/`Fulfillment` already
established. A `Promotion` can be:

- **Automatic** (`requiresCoupon = false`) — resolved into every eligible
  cart's pricing automatically, no code needed (Promotion C — free
  shipping — is this phase's example).
- **Coupon-gated** (`requiresCoupon = true`) — only resolved once the
  customer supplies a valid `Coupon.code` referencing it (Promotion A/B).

`Coupon` is **not** a child row of `Promotion` in the "owned, no
independent lifecycle" sense — it has its own status lifecycle
(`ACTIVE -> PAUSED -> ...`), own validity window, own usage limits,
layered _on top of_ the promotion's own limits (both are checked; the
tighter one wins). A promotion can have zero coupons (automatic), one
(the common case), or several (e.g. distinct one-time codes reusing one
discount definition) — modeled as a plain FK (`Coupon.promotionId`), not
a join table, since a coupon never unlocks more than one promotion.

**Deviation from the literal §3 field list**, made explicit rather than
silently done: `Promotion` does **not** carry its own `code` column.
Every code-gated activation goes through a `Coupon` row instead (§ below
— "Decision 2"). Duplicating a `code` string on both `Promotion` and
`Coupon` would create two sources of truth for the same lookup and two
enumeration surfaces to defend (§21) for the same concept; an automatic
promotion (Promotion C) also has _no_ code at all, which a mandatory
column can't represent as cleanly as omitting it. Every other §3 field
(`name`, `description`, `status`, `priority`, `startsAt`, `endsAt`,
`usageLimit`, `perCustomerLimit`, `usageCount`, `stackable`, `exclusive`,
`minimumCartValue`, `maximumDiscount`, `currency`, `createdAt`,
`updatedAt`) is present as specified.

**Deviation 2**: `PromotionAction` is not a separate table. §3 itself
allows "need not be separate tables for every concept if architecture
allows cleaner modeling" — no requirement this phase needs more than one
discount action per promotion (BOGO's "buy X get Y" and bundle pricing
are still a single action, just with extra parameters), so the action's
fields (`discountType`, `discountValue`, `buyQuantity`, `getQuantity`,
`getDiscountBasisPoints`, `bundlePrice`) live directly on `Promotion`. A
future promotion needing more than one action per campaign is a real
schema change, not a workaround.

## Decision 2 — Coupon lifecycle, normalization, and lookup safety

`Coupon.code` is stored **normalized**: trimmed and upper-cased at write
time (`CouponCode.normalize()`, domain value object) and looked up the
same way, so `didar20`/`DIDAR20`/`DiDaR20` all resolve to one row — a
real unique DB constraint (`@unique` on the normalized column), not an
app-level convention someone can bypass with a raw insert.

Lifecycle: `ACTIVE -> PAUSED` (admin can freeze a coupon without deleting
its history) `-> ACTIVE` again, `ACTIVE|PAUSED -> DISABLED` (terminal,
admin-only, e.g. abuse detected), and `ACTIVE|PAUSED -> EXPIRED`
(automatic, once `expiresAt` passes — read at lookup time, no need for a
sweep to flip the enum for correctness, though the `coupon_expiration`
queue — Decision 9 — does flip it for admin-list readability). A
`DISABLED` coupon never reactivates automatically.

**No enumeration leakage**: `POST /cart/coupon` returns the _same_ 422
shape (`COUPON_NOT_APPLICABLE`, a generic message) whether the code
doesn't exist, is disabled, is expired, is not yet valid, or the cart
just doesn't qualify for its minimum — a caller brute-forcing codes gets
no signal distinguishing "wrong code" from "right code, wrong cart",
mirroring the login flow's own "don't reveal which part was wrong"
discipline (`docs/security/README.md`).

## Decision 3 — Discount types (minimum set, exact scope)

`PromotionActionType`: `PERCENTAGE`, `FIXED_AMOUNT`, `FIXED_PRICE`,
`FREE_SHIPPING`, `BUY_X_GET_Y`, `BUNDLE_PRICE`. No type beyond this list
is implemented this phase. Each is a pure function from
`(targeted line subtotals, promotion parameters) -> per-line discount
BigInt`, computed by `domain/services/discount-engine.ts`:

- `PERCENTAGE` — `Money.applyBasisPoints(discountValue)` per targeted
  line, same basis-point convention `ProductPrice`/existing
  `DiscountCalculator` already use.
- `FIXED_AMOUNT` — a flat Rial amount off the targeted subtotal, capped
  at the targeted subtotal (never negative).
- `FIXED_PRICE` — targeted lines' _total_ is forced down to
  `discountValue` (the discount is `targetedSubtotal - discountValue`,
  floored at 0 — a `FIXED_PRICE` above the current subtotal is a no-op
  discount, not a markup).
- `FREE_SHIPPING` — not a line discount at all; a `shippingWaived: true`
  flag `PricingResolver` reads to zero `shippingCost` before the grand
  total sum (§16).
- `BUY_X_GET_Y` — `buyQuantity`/`getQuantity`/`getDiscountBasisPoints`
  (10000 = free). Computed against the targeted lines' units, cheapest
  units first (the customer-favorable, industry-standard tie-break —
  documented so it's never ambiguous which units are "free").
- `BUNDLE_PRICE` — every `PromotionTarget` row must be satisfied by at
  least one unit in cart (an all-or-nothing bundle, not a partial one);
  the bundle's targeted lines are forced to `bundlePrice` total, same
  floored-at-0 math as `FIXED_PRICE`.

Every type is capped by `Promotion.maximumDiscount` (never exceeded) and
never allowed to push a line, the cart subtotal, or the grand total
negative — the exact same `NegativeTotalError` guard `PricingResolver`
already throws, now checked after summing every stacked adjustment, not
just one coupon.

## Decision 4 — Targeting: composable, unioned, explicit precedence

`PromotionTarget` rows (`PRODUCT`/`SKU`/`CATEGORY`/`BRAND`/`COLLECTION`,
each an unenforced cross-schema pointer into `catalog`, same convention
`CartCoupon.couponId` already uses into `marketing`) are **OR'd**: a cart
line is "targeted" by a promotion if it matches _any_ target row.
**Zero target rows means the promotion targets the whole cart** — there
is no separate `ALL` target type, since "no rows" already means that
unambiguously and a redundant explicit-`ALL` row would be a second way to
say the same thing (a determinism hazard, not a feature). This is the
one precedence rule §5 requires never be left ambiguous, and it is fixed
here, not left to the resolver to infer per-call.

Customer-segment/first-purchase-only conditions are **not** targeting —
they are `PromotionRule` eligibility conditions (Decision 6), a different
axis: targeting decides _which cart lines_ a promotion's discount can
touch; rules decide _whether the promotion is eligible at all_ for this
cart/customer/time. Keeping them separate is what §26 requires
structurally, not just by convention.

## Decision 5 — Stacking, exclusivity, and deterministic ordering

Every eligible promotion for a cart is ordered by `(priority ASC, id
ASC)` — `id` as the final deterministic tiebreak so **row order from the
database is never relied on** (§11's explicit requirement; Postgres gives
no ordering guarantee without an `ORDER BY`). Default `priority = 100`;
admins can move a promotion earlier (a smaller number resolves first).

Resolution walks the ordered list and, for each promotion:

1. Skip it if it fails eligibility (Decision 6) or targets nothing in
   the cart.
2. If an **exclusive** promotion has already been accepted this
   resolution, skip every remaining promotion — an exclusive promotion
   that wins locks out everything else, coupon or automatic alike.
3. If this promotion is **exclusive** and any promotion has _already_
   been accepted, skip it (an exclusive promotion never joins a stack
   already in progress — symmetric with 2, not just one direction).
4. Otherwise, if this promotion is **stackable**, or the stack is still
   empty, accept it: compute its discount (Decision 3), add it to the
   accepted list, and continue.
5. A **non-stackable, non-exclusive** promotion accepted first blocks
   every later non-stackable promotion from joining (same reasoning as
   3, one notch looser) but does not block a later **stackable** one —
   stackable promotions can always layer onto a non-stackable "base"
   discount unless that base was itself exclusive.

This is intentionally simple and total — every combination of
`stackable`/`exclusive` on every promotion in the list resolves to one
answer, never a state the resolver has to guess at. Coupon-gated
promotions are ordered into the exact same list as automatic ones (a
`Coupon` only decides _whether_ its promotion is eligible, not where it
sits in the order) — one coupon (Phase 007's existing one-slot-per-cart
`CartCoupon`) plus any number of automatic promotions can combine in one
resolution, capped by the stacking rules above.

Within the accepted set, **calculation order** follows the proposed
default from the spec, confirmed as the real order after inspecting the
existing pipeline (`FIXED_PRICE`/`BUNDLE_PRICE` first, since they replace
a base amount other percentage math must apply _after_):

```
FIXED_PRICE / BUNDLE_PRICE -> item-level FIXED_AMOUNT -> BUY_X_GET_Y
  -> PERCENTAGE -> cart-level FIXED_AMOUNT -> FREE_SHIPPING
```

Each step operates on the _post-previous-step_ per-line amount (never
the original base price), so two stacked percentage promotions compound
multiplicatively (20% then 10% = 28% total off, not 30%) — the
conventional, unambiguous interpretation, stated here so it's never
implicit. **Same cart + same promotion/coupon state -> same result,
always** — the resolver takes no input but the cart lines, the resolved
customer/segment context, and the already-fetched list of active
promotions/coupons; no randomness, no wall-clock read inside the pure
functions (the caller resolves "now" once and passes it in).

## Decision 6 — Eligibility engine, structurally separated from discount calculation

`domain/services/eligibility-engine.ts` is the _only_ place that decides
whether a promotion applies; `discount-engine.ts` (Decision 3) is the
_only_ place that decides how much. Neither calls the other. Checks,
all pure functions of already-fetched data:

- **Time window** — `now` between `startsAt`/`endsAt` (either may be
  null = unbounded on that side).
- **Status** — `Promotion.status === 'ACTIVE'` (a `PAUSED`/`DRAFT`/
  `SCHEDULED`/`EXPIRED`/`ARCHIVED` promotion is never eligible,
  regardless of its window).
- **Cart minimum** — `subtotal >= minimumCartValue` (null = no minimum).
- **Targeting** — at least one cart line matches (Decision 4); a
  promotion with targets but no matching line in the cart is simply not
  eligible (not an error).
- **`PromotionRule` conditions** — `MINIMUM_QUANTITY` (cart holds >= N
  units across the promotion's targeted lines), `CUSTOMER_SEGMENT`
  (customer is a member of the given `customer.CustomerSegment` —
  reusing Phase 007's real segmentation table, not a new one),
  `FIRST_PURCHASE_ONLY` (customer has zero prior `commerce.orders` in a
  non-cancelled state — passed in as an already-resolved boolean by the
  application layer, since "has this customer ordered before" is a DB
  read, not something the pure engine may perform itself).
- **Usage limits** (`Promotion.usageLimit`/`perCustomerLimit`,
  `Coupon.usageLimit`/`perCustomerLimit`) — checked against
  already-fetched counts (Decision 8 covers where those counts come
  from); the pure engine only compares numbers, it never queries.
- **Coupon-specific** (when gated) — `Coupon.status === 'ACTIVE'`,
  coupon's own window, coupon not already redeemed past its limits.

## Decision 7 — Cart/checkout/order integration: extend, never duplicate

- **Cart** (`POST /cart/coupon`, `DELETE /cart/coupon`) — unchanged
  storage shape: still one `CartCoupon` row per cart (Phase 007's real,
  `@unique` model, untouched by this migration). Automatic promotions are
  **never** persisted onto the cart — they are recomputed by the resolver
  on every `price()` call, the same "never trust yesterday's number"
  discipline the coupon itself already had to earn via
  `resolveCouponRule()`'s live re-validation.
- **`PricingResolver.resolve()`** (cart-checkout) is extended in place:
  its single `coupon: CouponRule | null` input becomes
  `adjustments: readonly PricingAdjustment[]` — a `PricingAdjustment` is
  either cart-scoped (allocated proportionally across every line, the
  exact math `DiscountCalculator.allocateByLineShare` already has) or
  line-scoped (allocated only to the targeted line indices, a new sibling
  allocator using the same floor-then-remainder-to-last-line rule so the
  per-line sum always equals the adjustment's total, to the Rial). The
  promotion module's pure resolver is the _only_ producer of
  `PricingAdjustment[]`; `DiscountCalculator`'s per-type math (Decision 3) is reused by that resolver rather than reimplemented — the module
  imports `@iecp/types`' `Money` the same way `DiscountCalculator`
  already does, never floating point, matching §14 exactly. Existing
  single-coupon behavior is a strict subset of the new shape (one
  cart-scoped `PricingAdjustment`), so no existing `cart-checkout`
  pricing test changes its expected numbers.
- **Checkout** (`CheckoutService.price()`/`readyForPayment()`) — already
  the one place pricing freezes (Phase 007, unchanged control flow, see
  `pricing-resolver.ts`'s and `checkout.service.ts`'s own doc comments).
  This phase adds coupon-usage **reservation** at the same moment
  `readyForPayment()` freezes `pricingSnapshot`: every accepted
  promotion/coupon in the frozen resolution gets a `RESERVED`
  `CouponRedemption` row (Decision 8) — capacity-checked and written
  inside the same transaction that reads the promotion/coupon rows, so a
  reservation can never be created past a usage limit. The frozen
  snapshot from that point on is never recalculated against today's
  promotion rules, even if the promotion changes or expires five minutes
  later — exactly §8's requirement.
- **Order** — `OrderConversionService.convertFromCheckout()` (Phase 009,
  the only place an `Order` is ever created) copies the frozen
  `pricingSnapshot`'s promotion/coupon fields onto the new `Order`/
  `OrderItem` rows verbatim (immutable snapshot, Decision 10) and
  finalizes every `RESERVED` redemption to `REDEEMED` in the same
  transaction as the `PAID` transition — mirroring exactly how invoice
  issuance already piggybacks on that same transaction boundary.
  Checkout cancellation/expiry releases every `RESERVED` redemption
  (`RELEASED`) through the same `ReservationService.release()`-shaped
  symmetry Phase 007 already established for inventory.

## Decision 8 — Redemption ledger: one table for both coupon-gated and automatic usage limits

A single `marketing.CouponRedemption` ledger (not two near-duplicate
tables) rows track _every_ accepted promotion, whether or not a coupon
was involved — `couponId` is nullable, `promotionId` is always set. This
is the same "don't duplicate a concept just because the spec names it
twice" reasoning as Decision 1: automatic promotions need the exact same
reserve/redeem/release lifecycle and the exact same concurrency
technique a coupon does (Promotion C's usage limit is just as real an
invariant as `DIDAR20`'s), so one ledger with one concurrency-safe
repository method serves both.

**Lifecycle**: `RESERVED` (checkout `readyForPayment()`) `-> REDEEMED`
(order conversion, PAID) or `-> RELEASED` (checkout cancel/expire, or the
`coupon_reservation_cleanup` queue sweeping any `RESERVED` row whose
checkout has been terminal for longer than a safety window — a crash
between "reserve" and "release" must not permanently burn a slot). A row
is never deleted — `RELEASED` is a terminal status, not a deletion, so
the ledger stays a real audit trail (§20/§29).

**Concurrency, the mandatory invariant (§30)**: reserving a redemption
row-locks the `Coupon` (or `Promotion`, for the couponless path)
(`SELECT ... FOR UPDATE`) inside a transaction, re-sums already-active
(`RESERVED`/`REDEEMED`) redemptions for that coupon/promotion (global)
and for that customer (per-customer) under the lock, and only then
inserts the new row and bumps the cached `usageCount` — the exact
`mutateInventoryItem`/`lockAndSumFulfilled` technique this codebase
already uses for "never let a race exceed a numeric cap," applied here
to coupon capacity instead of stock/fulfillment quantity. A **real
Postgres `CHECK` constraint** is the backstop, not just the lock:
`coupons.usage_count <= coupons.usage_limit` (and the same shape on
`promotions`) whenever the limit is non-null — even a future bug in the
application-layer lock discipline cannot push a cached counter past its
declared limit; the database itself refuses the write. This is what
makes §30's "the database must enforce the invariant, not merely
application-level locking" literally true, not just aspirational.

`@@unique([checkoutSessionId, promotionId])` on the ledger means
re-running `price()`/re-freezing the same checkout **updates** its
existing `RESERVED` row (an upsert, never a duplicate reservation for
the same checkout+promotion pair) — the same idempotent-by-construction
shape `CheckoutReservation`/`CartCoupon` already use.

## Decision 9 — Queues (BullMQ, only where justified)

Two, matching the spec's own suggested list, no more:

- **`coupon_reservation_cleanup`** — every 5 minutes, releases any
  `RESERVED` `CouponRedemption` whose checkout session is terminal
  (`CANCELLED`/`EXPIRED`) or has been `RESERVED` for over 30 minutes with
  no matching order — the reliability backstop for a crash between
  "reserve" and "release"/"redeem," same shape as Phase 009's
  `order_conversion` sweep.
- **`promotion_expiration`** — every 5 minutes, flips any `Promotion`/
  `Coupon` past its `endsAt`/`expiresAt` from `ACTIVE` to `EXPIRED` —
  admin-list/audit readability only; eligibility checks already read the
  window live and never depend on this queue for correctness (a
  promotion is ineligible the instant `now > endsAt` even if this sweep
  hasn't run yet).

No job is added for "recalculate active carts when a promotion changes"
— out of scope this phase (Decision 11).

## Decision 10 — Tax and rounding: discount-before-tax, confirmed not chosen fresh

Inspection of `pricing-resolver.ts` confirms the pipeline is already
`subtotal -> discount -> tax (on the post-discount amount) -> shipping ->
grandTotal`. This phase does not change that order — every stacked
promotion discount is summed and allocated _before_ `TaxCalculator` ever
runs, so tax is always computed on the post-discount taxable amount, per
line. Rounding is the same floor-then-remainder-to-the-last-line
convention `DiscountCalculator.allocateByLineShare` already uses,
extended to per-promotion, per-line allocation so the sum of every
adjustment's per-line pieces always equals that adjustment's total
discount to the Rial, and the sum of every adjustment's total always
equals `discountTotal` to the Rial. Never floating point anywhere in
this chain (§14) — `BigInt` and `Money.applyBasisPoints()` throughout.

## Decision 11 — Refunds, order snapshotting, and deliberately deferred scope

A refunded/cancelled order's promotion/coupon snapshot fields
(`Order.discountTotal`, `OrderItem.discountAmount`, plus the new
promotion-identity fields — Decision 7) stay exactly as they were at
order creation — historical record, never rewritten by a later refund.
A refund does **not** automatically restock a coupon's usage count or
reopen a `REDEEMED` redemption — the same "no automatic un-burn" choice
already documented for inventory restock-on-cancellation
(`docs/product/payment.md`), extended here rather than special-cased.

Deliberately out of scope this phase (documented, not silently dropped):

- Recalculating an **already-`ACTIVE`, in-progress cart's** promotions
  the instant an admin changes a promotion mid-flight — a cart's
  automatic promotions are only as fresh as its last `price()` call, the
  same staleness window a coupon's own re-validation already tolerates.
- Customer-facing promotion **browsing/discovery** UI or endpoint (e.g.
  "here are all promotions you qualify for") — only apply/remove and
  admin CRUD exist; the storefront surfacing them is a future frontend
  phase, same scope line every backend-only phase before this one drew.
- Channel-based targeting (web vs. mobile vs. POS) — no channel concept
  exists yet in this codebase to target against.
- A/B promotion experiments, scheduled auto-activation beyond the simple
  `startsAt` window, and analytics dashboards beyond the raw
  `promotion.analytics.read`-gated read endpoints (§17) — reporting
  aggregation itself is future work.

## Consequences

- Every discount a customer sees is proven server-computed, from a
  database-enforced usage cap, through a deterministic ordering rule, to
  an immutable order snapshot — no step trusts a client-supplied number.
- `cart-checkout`'s pricing pipeline gained multi-adjustment support
  without changing its existing single-coupon behavior or its existing
  tests' expected numbers — a strict extension, not a rewrite.
- The redemption ledger is the one new concurrency-critical surface this
  phase adds; it reuses a technique (row-lock + re-sum + `CHECK`
  backstop) already proven three times over in this codebase
  (inventory, fulfillment, order-status), rather than inventing a fourth
  shape.
