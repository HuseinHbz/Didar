# Promotion & coupon security (Phase 010)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the module Phase 010 added. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers
what's specific to the promotion/discount/coupon domain.

Same two-model split `docs/security/order-security.md` documents — see
`docs/api/promotions.md`'s "Auth" section for the exact route grouping.

## Two auth models, not one

- **`/cart/coupon`** — customer/guest-facing, `cart-checkout`'s own
  `ActorResolverGuard` (reused directly, never reimplemented) — a cart's
  coupon is owned by exactly whoever owns the cart. `CartService
.applyCoupon()`/`.removeCoupon()` never accept a cart ID or coupon ID
  from anywhere but the caller's own resolved actor.
- **`/admin/promotions/*`, `/admin/coupons/*`** — RBAC, behind the
  service's global `JwtAuthGuard` + `AuthorizationGuard`, gated per-route
  by `@RequirePermission`.

## RBAC model

13 new `promotion.*`/`coupon.*` permissions, matching exactly what every
controller checks (`docs/api/promotions.md` has the full route-to-
permission mapping):

| Permission                 | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `promotion.read`           | Read any promotion                                             |
| `promotion.create`         | Create a promotion                                             |
| `promotion.update`         | Update a promotion's fields/rules/targets                      |
| `promotion.activate`       | Activate a promotion                                           |
| `promotion.pause`          | Pause an active promotion                                      |
| `promotion.archive`        | Archive a promotion (terminal)                                 |
| `promotion.delete`         | Permanently delete a promotion (no route wired yet)            |
| `promotion.analytics.read` | Read promotion usage/redemption analytics (no route wired yet) |
| `coupon.read`              | Read any coupon                                                |
| `coupon.create`            | Create a coupon                                                |
| `coupon.update`            | Update a coupon's own fields/lifecycle (pause/activate)        |
| `coupon.disable`           | Permanently disable a coupon                                   |
| `coupon.delete`            | Permanently delete a coupon (no route wired yet)               |

Two new roles, real least-privilege boundaries, not labels:

- **`promotion_manager`** — every `promotion.*`/`coupon.*` permission (a
  marketing department head — can delete/disable and read analytics once
  those routes exist).
- **`promotion_editor`** — `promotion.{read,create,update,activate,
pause,archive}` + `coupon.{read,create,update,disable}` only. The same
  "floor role can't reach its own destructive/reporting action" shape
  `fulfillment_clerk`/`warehouse_operator` already established:
  day-to-day authoring and lifecycle management is safe to grant broadly,
  but `promotion.delete`/`coupon.delete`/`promotion.analytics.read` are
  not — `promotion_editor` never receives them, proving deletion is
  never auto-granted to every editor-tier role by default.

`admin` continues to receive every `promotion.*`/`coupon.*` permission
alongside its existing grants — no separate carve-out.

Proven, not just declared: `test/promotion.e2e-spec.ts`'s RBAC section
logs in as `promotion_editor` (`+989120000014`) via the real OTP flow and
asserts it can create a promotion and a coupon on it, and a plain
customer token gets `403` on every `/admin/promotions` route (both GET
and POST).

## No enumeration leakage — a coupon-brute-force attempt learns nothing

`POST /cart/coupon` returns the exact same `400 CouponNotApplicableError`
shape whether the submitted code doesn't exist, is expired, is not yet
valid, is disabled, or the cart simply doesn't qualify for its minimum —
the same "don't reveal which part was wrong" discipline this codebase's
login flow already established. Proven: `test/promotion.e2e-spec.ts`
loops `DOESNOTEXIST`/`EXPIREDCODE`/`FUTURECODE` through the identical
assertion, and `Coupon.code` normalization (trim+uppercase, a real
`@unique` constraint) means there is no timing- or case-sensitivity
side-channel a caller could use to distinguish "almost right" from "not
even close."

## IDOR protection

- **`/cart/coupon`** — ownership is enforced transitively through the
  cart itself (`ActorResolverGuard` + `CartService`'s own ownership
  checks, unchanged from Phase 007); a coupon applied to one guest cart
  is structurally invisible to a different guest token, since every
  lookup is scoped to `current.cart.id` resolved from the caller's own
  actor, never a client-supplied cart ID. Proven:
  `test/promotion.e2e-spec.ts`'s IDOR test applies a coupon to one guest
  cart and asserts a second, unrelated guest cart's own `discountTotal`
  is unaffected (`0`), while the first cart's discount is unaffected by
  the second cart's existence.
- **`/admin/coupons/:id`, `/admin/coupons/:id/disable`** — a real,
  existing, known coupon ID reached by a caller without `coupon.read`/
  `coupon.disable` still yields `403`, never a `200` leaking its state or
  a mutation silently succeeding. Proven:
  `test/promotion.e2e-spec.ts`'s IDOR test creates a real coupon as
  `promotion_manager`, then asserts a plain customer token gets `403`
  reading and disabling it by its real ID.

## Client-supplied totals are never trusted, structurally

The single most important invariant in this module, enforced two
different ways depending on the route shape:

- **`ApplyCouponDto` only declares `code`.** The service-wide
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
  rejects any extra field (`discountAmount`, `resolvedDiscount`, or
  anything else) with a real `400` before the request handler ever runs
  — there is no code path where a client-supplied discount amount
  reaches the pricing pipeline. Proven:
  `test/promotion.e2e-spec.ts` posts `{ code, discountAmount:
'999999999' }` to `/cart/coupon` and asserts `400`.
- **`POST /cart/price`/`POST /checkout/:id/price` bind no `@Body()` at
  all.** A forged body (`{ grandTotal, discountTotal, subtotal }`) is
  never parsed against anything the handler reads — every total is
  recomputed from scratch, server-side, on every call. Proven:
  `test/promotion.e2e-spec.ts` sends exactly such a forged body and
  asserts the response still reflects the real, server-computed
  `discountTotal`.

## A promotion can never turn into a price increase, even from bad admin input

`DiscountEngine`'s own `capDiscount()` floors any raw computed discount
at zero before it is ever applied, and separately caps it at
`Promotion.maximumDiscount` and at the targeted lines' own remaining
total — regardless of what `discountValue` an admin (malicious, or
simply mistaken) supplied at creation time, since the admin-facing DTO
declares no positivity constraint on `discountValue` at the validation
layer. This is ADR-010's "shipping discounts never negative" principle,
generalized structurally to every discount type in `DiscountEngine`
rather than left as a convention only `FREE_SHIPPING` happens to honor.
Proven: `test/promotion.e2e-spec.ts` creates a real promotion with
`discountValue: '-500000'`, applies it via a coupon, and asserts the
resulting `discountTotal` is `'0'` and the cart's `grandTotal` never
drops below its real subtotal.

## Coupon-usage limits cannot be forged or exceeded by racing requests

`CouponRepositoryPort.reserve()` row-locks the coupon (or promotion,
couponless path) with `SELECT ... FOR UPDATE` and re-sums already-active
redemptions inside the same transaction as the new row's insert — a real
database-level guarantee, not an application-layer check a genuine race
could slip past. A Postgres `CHECK` constraint
(`promotion_usage_within_limit`/`coupon_usage_within_limit`) is the
backstop even if that lock discipline ever regresses. Proven twice, at
two different layers: `test/promotion.e2e-spec.ts`'s concurrency section
fires 15 concurrent `ready-for-payment` confirmations through the full
HTTP checkout flow against a `usageLimit: 1` coupon; `test/promotion-repository.e2e-spec.ts`
independently fires 20 concurrent `reserve()` calls directly at the
repository layer. Both converge to exactly one success, and the
repository-level suite additionally proves `perCustomerLimit` is
genuinely per-customer (a second customer against the same coupon is
unaffected) rather than a disguised global cap.

## Replay cannot double-reserve or double-spend a coupon

`CheckoutService.readyForPayment()`'s own `CheckoutStateMachine.isNoOp`
early return means a replayed confirmation on an already-frozen checkout
is a genuine no-op — it never re-attempts `CouponRedemptionService
.reserveAll()`. `@@unique([checkoutSessionId, promotionId])` on
`coupon_redemptions` makes a duplicate reservation for the same
checkout+promotion structurally impossible even outside that guard — a
retried request updates the existing row's `discountAmount` rather than
inserting a second one. Proven:
`test/promotion.e2e-spec.ts` confirms `ready-for-payment` twice for the
same checkout and asserts exactly one `coupon_redemptions` row exists
afterward.

## Idempotency and replay, the full picture

See `docs/api/promotions.md`'s "Idempotency" table for the full
per-operation mechanism. The security-relevant property: every one of
those keys/locks (`Coupon.code`'s unique constraint, the reservation row
lock + `CHECK` constraint, the `(checkoutSessionId, promotionId)`
uniqueness, `finalize()`/`release()`'s status-guarded no-op behavior) is
a real unique database constraint, row lock, or state-guarded write —
never an application-level cache a restart or a race could bypass — and
every concurrency-relevant one is proven race-safe under real concurrent
duplicate submissions, not only sequential retries.

## What's proven, not just declared

- **The two RBAC roles are a real fixture, not a paper matrix.**
  `test/promotion.e2e-spec.ts` logs in as `promotion_manager`
  (`+989120000013`) and `promotion_editor` (`+989120000014`) via the real
  OTP flow and exercises their actual permission boundaries; a plain
  customer token gets `403` on every `/admin/promotions` route.
- **IDOR is rejected** on `/cart/coupon` (cross-guest isolation) and
  `/admin/coupons/:id` (a real, known coupon ID unreachable without
  permission).
- **No enumeration leakage** across nonexistent/expired/future coupon
  codes.
- **A client cannot inject a discount amount or a forged total** —
  neither `POST /cart/coupon` nor `POST /cart/price` reads anything but
  what the server itself computed.
- **A negative-discount promotion cannot inflate a price**, even from
  admin input with no positivity validation at the DTO layer.
- **Coupon-usage limits and per-customer limits hold under real
  concurrency**, proven at both the HTTP layer and the repository layer
  independently.
- **Replaying `ready-for-payment` never double-reserves.**

## Deliberately not built this phase

- **No rate limiting specific to promotion/coupon mutation** — same
  blanket nginx `limit_req_zone` as everything else in this service (see
  `docs/security/README.md`'s "Not yet" list). A coupon-brute-force
  attempt is slowed by the same service-wide limiter, not a
  module-specific one.
- **No audit-logging gap here** — this module writes `system.AuditLog`
  for every privileged admin mutation (promotion/coupon create, update,
  and every lifecycle transition), reusing `AUDIT_LOG_REPOSITORY` the
  same way `catalog`/`inventory`/`order` do.
- **`promotion.delete`/`coupon.delete` permissions exist with no route.**
  Not a security gap — there is nothing to authorize yet; see
  `docs/api/promotions.md`'s "Known limitations."
