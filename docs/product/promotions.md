# Promotions, discounts & coupons (Phase 010)

Full architecture rationale: [`docs/adr/ADR-010-promotion-engine.md`](../adr/ADR-010-promotion-engine.md).
This document is the product-scope companion every prior phase wrote —
what's real this phase versus deliberately deferred.

## What's real

- **Promotions** — admin-created, `DRAFT -> SCHEDULED -> ACTIVE ->
{PAUSED, EXPIRED, ARCHIVED}`. Automatic (apply without a code) or
  coupon-gated (require a valid `Coupon.code`).
- **Six discount types** — `PERCENTAGE`, `FIXED_AMOUNT`, `FIXED_PRICE`,
  `FREE_SHIPPING`, `BUY_X_GET_Y`, `BUNDLE_PRICE`. No other type exists.
- **Targeting** — product / SKU / category / brand / collection,
  composable (OR'd); untargeted = whole cart.
- **Eligibility** — time window, cart minimum, minimum quantity, customer
  segment (reuses Phase 007's real `CustomerSegment`), first-purchase-
  only, usage limits (global + per-customer, on both the promotion and
  any coupon gating it).
- **Stacking & exclusivity** — deterministic ordering
  (`priority ASC, id ASC`), exclusive promotions lock out everything
  else, non-stackable promotions block later non-stackable ones. Full
  rule in ADR-010 decision 5.
- **Coupons** — normalized, unique codes; `ACTIVE/PAUSED/EXPIRED/
DISABLED` lifecycle; concurrency-safe redemption (reserve at checkout,
  redeem at order, release on cancel/expire), database-enforced usage
  caps (a real `CHECK` constraint, not just application locking).
- **Cart/checkout/order integration** — `POST /cart/coupon` /
  `DELETE /cart/coupon` for the one coupon slot per cart (unchanged
  Phase 007 shape); automatic promotions recomputed live on every
  `price()` call; checkout freezes the full resolution (every accepted
  promotion, its discount, and its coupon if any) at
  `readyForPayment()`, never recalculated later; the order carries an
  immutable copy.
- **Admin API** — full CRUD + lifecycle transitions for promotions and
  coupons, RBAC-gated, audited.
- **Concurrency, proven** — `usageLimit = 1` against 15 concurrent
  redemption attempts (full HTTP checkout flow) and, independently, 20
  concurrent attempts directly at the repository layer, both yield
  exactly one success, proven against real PostgreSQL.

## Deliberately deferred (see ADR-010 decision 11 for why)

- Live recalculation of an already-open cart the instant an admin edits
  a promotion mid-flight.
- Customer-facing promotion discovery/browsing (which promotions do I
  qualify for) — only apply/remove + admin CRUD this phase.
- Channel-based targeting (no channel concept exists yet).
- A/B experiments, scheduled auto-activation beyond `startsAt`,
  analytics dashboards beyond the raw `promotion.analytics.read` reads.
- Automatic coupon-usage "un-burn" on refund — same no-automatic-restock
  precedent `docs/product/payment.md` already set for inventory.

## Deliberately deferred from earlier phases, now closed by this one

- The Phase-003 placeholder `marketing.Coupon`/`Promotion`/
  `CouponRedemption`/`PromotionProduct` — replaced outright by the real
  schema this phase introduces (see `docs/database/promotion-erd.md`).
