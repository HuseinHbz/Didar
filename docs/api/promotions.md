# Promotion & coupon API (Phase 010)

Endpoint reference for `services/api/src/modules/promotion`, plus the two
customer-facing coupon routes that live in `cart-checkout`'s own
`CartController` (ADR-010 decision 7 — the promotion module has no
customer-facing controller of its own). This document follows
[`README.md`](./README.md)'s conventions (`/api/v1` base path, whitelist
validation, no GraphQL) — read that document first for what applies to
every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open `/api/v1/docs`;
the tables below are a hand-maintained companion for reviewing scope
without booting anything.

Module-level design detail (layering, the eligibility/discount split,
what's deliberately not built):
[`services/api/src/modules/promotion/README.md`](../../services/api/src/modules/promotion/README.md).
Auth model: [`docs/security/promotion-security.md`](../security/promotion-security.md).

## Auth: two models, split by who calls each route

- **`/cart/coupon`** (customer/guest-facing, lives in `cart-checkout`) —
  reuses `cart-checkout`'s own `ActorResolverGuard` directly — a cart's
  owner is exactly its coupon's owner. See `docs/api/cart-checkout.md`'s
  "Auth" section for the exact guest/authenticated resolution rules;
  they apply unchanged here.
- **`/admin/promotions/*`, `/admin/coupons/*`** are permission-gated
  admin routes behind the service's global `JwtAuthGuard` +
  `AuthorizationGuard`, exactly like every other `admin/*` route in this
  service. No `@Public()`, no guest path.

## Coupons (customer/guest)

| Method | Path           | Auth               | Notes                                                                                                                                                            |
| ------ | -------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/cart/coupon` | Actor (owner only) | Apply a coupon code to the caller's own cart (`{ code }`). Code is normalized (trim+uppercase) before lookup — case-insensitive from the caller's point of view. |
| DELETE | `/cart/coupon` | Actor (owner only) | Remove the coupon currently applied to the caller's own cart (idempotent — a cart with no coupon returns 200 unchanged).                                         |

Neither route accepts a discount amount, a promotion ID, or any pricing
field from the client — `POST /cart/coupon` validates the code and
recomputes the cart's pricing entirely server-side via
`PromotionResolutionService`; a client cannot influence the resulting
`discountTotal` by anything in the request body beyond which code string
it sends. `POST /cart/price`/`POST /checkout/:id/price` (unchanged,
`cart-checkout`'s own routes) bind no request body at all — every
promotion/coupon adjustment is recomputed from scratch on every call.

## Promotions (admin)

| Method | Path                             | Permission           | Notes                                                                         |
| ------ | -------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| GET    | `/admin/promotions`              | `promotion.read`     | List promotions, optionally filtered by `status`                              |
| GET    | `/admin/promotions/:id`          | `promotion.read`     | Read one promotion with its rules and targets                                 |
| POST   | `/admin/promotions`              | `promotion.create`   | Create a promotion (`DRAFT` by default); accepts `rules[]`/`targets[]` inline |
| PUT    | `/admin/promotions/:id`          | `promotion.update`   | Update a promotion's fields/rules/targets                                     |
| POST   | `/admin/promotions/:id/activate` | `promotion.activate` | `DRAFT/SCHEDULED/PAUSED -> ACTIVE`                                            |
| POST   | `/admin/promotions/:id/pause`    | `promotion.pause`    | `ACTIVE -> PAUSED`                                                            |
| POST   | `/admin/promotions/:id/archive`  | `promotion.archive`  | Terminal — `ARCHIVED` never reactivates (409 on a later `activate` attempt)   |

`promotion.delete`/`promotion.analytics.read` permissions exist in the
RBAC seed for a future hard-delete/reporting endpoint but have no route
wired to them this phase — see "Known limitations."

## Coupons (admin)

| Method | Path                          | Permission       | Notes                                                                                         |
| ------ | ----------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| POST   | `/admin/coupons`              | `coupon.create`  | Create a coupon under a promotion (`{ promotionId, code, ... }`); code is normalized on write |
| GET    | `/admin/coupons/:id`          | `coupon.read`    | Read one coupon                                                                               |
| POST   | `/admin/coupons/:id/activate` | `coupon.update`  | `PAUSED -> ACTIVE`                                                                            |
| POST   | `/admin/coupons/:id/pause`    | `coupon.update`  | `ACTIVE -> PAUSED`                                                                            |
| POST   | `/admin/coupons/:id/disable`  | `coupon.disable` | Terminal — a `DISABLED` coupon never reactivates                                              |

`coupon.delete` exists in the RBAC seed with no route wired to it this
phase, same as `promotion.delete` — see "Known limitations."

## No enumeration leakage

`POST /cart/coupon` returns the exact same `400` shape
(`{ error: 'CouponNotApplicableError', ... }`) whether the code doesn't
exist, is expired, is not yet valid, is disabled, or the cart just
doesn't qualify for its minimum — a caller brute-forcing codes gets no
signal distinguishing any of these cases. Proven, not just declared:
`test/promotion.e2e-spec.ts` loops `DOESNOTEXIST`/`EXPIREDCODE`/
`FUTURECODE` through the identical assertion.

## Idempotency

| Operation                      | Mechanism                                                                                                                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coupon code normalization      | `Coupon.code` is `@unique` on the already-normalized value — a raw insert can never create two rows for `didar20`/`DIDAR20`                                                                                                                           |
| Coupon-usage reservation       | `SELECT ... FOR UPDATE` row lock + re-sum inside a transaction (`CouponRepositoryPort.reserve()`), backstopped by a real Postgres `CHECK` constraint — two truly concurrent reservation attempts against the same `usageLimit` can never both succeed |
| Re-pricing the same checkout   | `@@unique([checkoutSessionId, promotionId])` on `coupon_redemptions` — re-running `readyForPayment()` on an already-frozen checkout is a no-op (`CheckoutStateMachine.isNoOp`), never a second reservation                                            |
| Order-conversion finalize      | `CouponRedemptionService.finalize()` only transitions rows still `RESERVED` — replaying it against an already-`REDEEMED` checkout changes nothing                                                                                                     |
| Checkout cancel/expire release | `CouponRedemptionService.release()` only transitions rows still `RESERVED` — replaying it against an already-`RELEASED` checkout changes nothing, and never decrements `usageCount` past zero                                                         |

## Errors

Four domain error types get a real HTTP mapping via
`PromotionDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                      | HTTP status |
| --------------------------------- | ----------- |
| `InvalidPromotionTransitionError` | 409         |
| `InvalidCouponTransitionError`    | 409         |
| `CouponUsageLimitExceededError`   | 409         |
| `CouponNotApplicableError`        | 400         |

`CouponUsageLimitExceededError` surfaces as `409 Conflict` on the
concurrency-critical path — a caller racing against an exhausted coupon
gets a real conflict status, not a validation error, matching the
convention every other "the resource exists and the request is
well-formed, it's just not currently possible" case in this service uses.

This is intentionally narrower than `docs/api/README.md`'s noted-as-future
general error-shape standardization — it covers exactly this module's
domain-layer error types, not a service-wide `{success, error, requestId}`
envelope.

## Known limitations

- **`promotion.delete`/`coupon.delete`/`promotion.analytics.read`
  permissions exist in the RBAC seed with no route wired to them.**
  Promotions/coupons are soft-lifecycle resources this phase
  (`ARCHIVED`/`DISABLED` are both terminal, not deleted) — a hard-delete
  endpoint and a usage/redemption analytics endpoint are both real,
  scoped future work, not silently dropped requirements; the permissions
  exist so a future route can be gated without another RBAC migration.
- **`OrderResponseDto` does not expose an order's applied promotions.**
  The data is real and correctly written
  (`commerce.order_promotions`, verified directly via Prisma in
  `test/promotion.e2e-spec.ts`), it is just not surfaced in that one
  customer-facing response shape yet — see
  `docs/architecture/promotion-engine.md`'s "Known, deliberate gaps."
