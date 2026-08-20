# Order security (Phase 009, hardened Phase 011)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the one module Phase 009 added. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers
what's specific to the order/invoice/fulfillment domain. Phase 011
rationale: [`docs/adr/ADR-011-order-lifecycle-hardening.md`](../adr/ADR-011-order-lifecycle-hardening.md).

Same two-model split `docs/security/payment-security.md` documents —
see `docs/api/order.md`'s "Auth" section for the exact route grouping.

## Two auth models, not one

- **`orders/*`** — customer/guest-facing, same `ActorResolverGuard`
  `cart-checkout` established (reused directly, imported from
  `CartCheckoutModule`, never reimplemented). Ownership is per-resource,
  not role-based: `OrderService.assertOwnership()` checks the order's
  `customerId`/`guestToken` against the caller's resolved actor, the same
  shape `CartService`/`CheckoutService`/`PaymentIntentService`'s own
  `assertOwnership()` use. `GET /orders/by-checkout/:checkoutSessionId`
  checks ownership against the _checkout session_ itself
  (`CheckoutService.get()`) before running conversion, so it can never be
  used to probe an arbitrary checkout's payment status.
- **`admin/orders/*`** — RBAC, behind the service's global
  `JwtAuthGuard` + `AuthorizationGuard`, gated per-route by
  `@RequirePermission`.

## RBAC model

15 `order.*` permissions (14 from Phase 009 plus one Phase 011
addition), matching exactly what every controller checks
(`docs/api/order.md` has the full route-to-permission mapping):

| Permission               | Meaning                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `order.read`             | Read any order (admin/support scope)                                                                               |
| `order.create`           | Manually retry checkout->order conversion for a verified payment                                                   |
| `order.update`           | Update a fulfillment record on an order                                                                            |
| `order.cancel`           | Cancel an order                                                                                                    |
| `order.approve`          | Approve an order for processing                                                                                    |
| `order.fulfill`          | Create a fulfillment for an order                                                                                  |
| `order.ship`             | Create a shipment for a fulfillment                                                                                |
| `order.complete`         | Mark an order `COMPLETED`                                                                                          |
| `order.refund`           | Request a partial refund against a paid order                                                                      |
| `order.invoice.read`     | Read an order's invoice                                                                                            |
| `order.invoice.create`   | Manually (re)issue an invoice for an order                                                                         |
| `order.invoice.void`     | Void an issued invoice                                                                                             |
| `order.shipment.read`    | Read an order's shipments (Phase 011: and look one up by tracking number)                                          |
| `order.shipment.update`  | Update a shipment status/tracking event — never `DELIVERED` (Phase 011; see below)                                 |
| `order.shipment.deliver` | Phase 011: confirm delivery of a shipment — the one permission that can move a shipment/fulfillment to `DELIVERED` |

Two roles, real least-privilege boundaries, not labels:

- **`order_manager`** — every `order.*` permission, `order.shipment.deliver`
  included (a department head — can approve/cancel/refund/complete
  orders, void invoices, and confirm delivery).
- **`fulfillment_clerk`** — `order.read`, `order.update`, `order.fulfill`,
  `order.ship`, `order.shipment.read`, `order.shipment.update` only —
  deliberately **not** `order.shipment.deliver` (Phase 011). The same
  "floor role can't approve its own sensitive action" shape
  `warehouse_operator`/`finance_auditor` already established, now proven
  one level deeper: this role can walk a shipment through every status
  short of `DELIVERED` (`IN_TRANSIT`/`FAILED`/`CANCELLED` are all still
  `order.shipment.update`), but confirming delivery — which can gate
  order completion — needs the more senior permission.
  `approve`/`cancel`/`refund`/`complete`/`invoice.void`/`shipment.deliver`
  all stay out of reach.

`admin` continues to receive every `order.*` permission alongside its
existing `catalog.*`/`inventory.*`/`payment.*` grants — no separate
carve-out.

## IDOR protection on the customer/guest-facing routes

`OrderService.assertOwnership()` runs on every read under `orders/*`:

- An authenticated customer may only read an order whose `customerId`
  matches their own.
- A guest may only read an order whose `guestToken` matches the one
  `ActorResolverGuard` resolved from `X-Cart-Token`.
- A mismatch is a plain `403`, thrown directly — not routed through
  `OrderDomainExceptionFilter` (see `docs/api/order.md`'s "Errors"
  section).

`GET /orders/by-checkout/:checkoutSessionId` adds a second layer: before
it ever runs conversion or looks at an `Order` row, it checks the
_checkout's_ ownership via `CheckoutService.get()` — the same 404/403 a
caller would get reading that checkout directly. A caller can never use
this route to fish for whether someone else's checkout has been paid.

Proven, not just declared: `test/order.e2e-spec.ts` asserts a mismatched
guest gets `403` on both `GET /orders/by-checkout/:id` and
`GET /orders/:id`, and a real second authenticated customer gets `403`
reading another customer's order.

## An Order can only ever be created from a verified payment

The single most important invariant in this module (ADR-009 decision 4),
structurally enforced: `OrderConversionService.convertFromCheckout()` —
the only place an `Order` row is ever created — trusts exactly one
signal, `PaymentIntent.status === 'SUCCEEDED'` backed by a real
`VERIFIED` `PaymentTransaction`, both written entirely by Phase 008's own
`verifyPayment()`. There is no `POST /orders` route, no DTO field
anywhere in this module that accepts a payment status, a paid amount, or
an order total from a client. `Order.subtotal`/`taxTotal`/`grandTotal`/
`paidTotal` are all read from the checkout session's own frozen totals
and the verified transaction's own settled amount — never client-supplied.

## Over-fulfillment cannot be forged by racing requests

`FulfillmentRepositoryPort.create()` row-locks the target `OrderItem`
(`SELECT ... FOR UPDATE`) and re-sums already-fulfilled quantity across
every non-`CANCELLED` fulfillment inside the same transaction as the new
`FulfillmentItem` insert — a real database-level guarantee, not an
application-layer check that a genuine race could slip past. Proven, not
assumed: `test/order.e2e-spec.ts`'s concurrency section fires four
concurrent fulfillment requests against an order item that only has
capacity for two, and asserts exactly two succeed and the total
`FulfillmentItem` quantity never exceeds the ordered amount.

## Order status transitions cannot be corrupted by racing requests

`PrismaOrderRepository.updateStatus()` row-locks the order
(`SELECT ... FOR UPDATE`) and re-checks `OrderStateMachine` against the
_locked_ status before writing — discovered as a real gap by this
module's own concurrency suite (six concurrent cancel requests on one
order originally produced six `OrderStatusHistory` rows, not one) and
fixed at the repository layer so every caller of `updateStatus()`
benefits, not just `cancel()`. See
`docs/architecture/order.md`'s "Concurrency, proven not assumed" section.

## Fulfillment/shipment status transitions cannot be corrupted by racing requests (Phase 011)

The exact same gap the section above fixed for `Order` existed, unfixed,
on `Fulfillment`/`Shipment` — a real, previously-undetected check-then-
act race, found by auditing Phase 009 for this exact bug class rather
than by a failing test. `PrismaFulfillmentRepository.updateStatus()`/
`updateShipmentStatus()` now row-lock (`SELECT ... FOR UPDATE`) and
re-check `FulfillmentStateMachine`/`ShipmentStateMachine` against the
_locked_ row before writing — identical technique, applied to the two
aggregates that didn't have it. Proven, not assumed:
`test/order-repository.e2e-spec.ts` fires 20 concurrent identical status
updates against a fresh fulfillment (and, separately, a fresh shipment)
and asserts exactly one real transition each; a third test asserts a
transition that's no longer legal once the lock is held throws a real
`409`, not a silent no-op.

## Order completion is a server-derived fact, not an admin-trusted flag (Phase 011)

`OrderService.complete()` no longer trusts the `fulfillmentStatus` cache
column alone. `OrderCompletionValidator.assertReady()` (pure domain
logic, zero I/O, unit-tested in isolation) re-checks the order's real
`Fulfillment` rows: every non-`CANCELLED` one must actually be
`DELIVERED`, and payment must be settled — a `PATCH .../status` body
naming `COMPLETED` was never a route this module exposes (Phase 009
already avoided that specific trust gap), but `POST .../complete` itself
used to be reachable the moment the cache column read `FULFILLED`,
without checking the shipment side ever genuinely delivered. Proven:
`test/order.e2e-spec.ts` asserts `/complete` returns `409` both for a
`SHIPPED`-but-not-`DELIVERED` fulfillment and for an order with no
fulfillment at all, and `201` only once delivery is real.

## Delivery confirmation has its own permission and cannot be forged through a generic status update (Phase 011)

`POST admin/orders/:orderId/shipments/:shipmentId/deliver` is the _only_
route that can move a shipment to `DELIVERED`, gated by its own
`order.shipment.deliver` permission — structurally distinct from the
generic `PATCH .../shipments/:shipmentId` (`order.shipment.update`)
`fulfillment_clerk` already holds. That generic route's own DTO
(`UpdateShipmentStatusDto`) excludes `DELIVERED` from its accepted enum
entirely, so an attempt is a `400` at the validation layer — it never
reaches the service, let alone the database. Proven:
`test/order.e2e-spec.ts` asserts `fulfillment_clerk` gets `403` on the
dedicated deliver route (while still succeeding on a generic, non-
`DELIVERED` `PATCH` to the same shipment — a boundary on `DELIVERED`
specifically, not a blanket lockout), and that a `PATCH` naming
`DELIVERED` on either the fulfillment or shipment route is a `400` with
no state change (verified by a direct DB read after the rejected call).

## Tracking numbers cannot collide, and cannot be used to enumerate shipments by guessing (Phase 011)

`Shipment.trackingNumber` gained a `UNIQUE` index — a second shipment can
no longer be created with a tracking number already in use. The new
`GET admin/shipments/by-tracking/:trackingNumber` lookup is admin-only
(`order.shipment.read`); a plain customer token gets `403`, and an
unknown tracking number is a `404`, not a `200` with an empty/null body
that would let an unauthenticated or under-privileged caller distinguish
"exists" from "doesn't exist."

## Admin search/filtering never widens what an admin can see (Phase 011)

`GET admin/orders`'s new `paymentStatus`/`fulfillmentStatus`/
`customerId`/`placedFrom`/`placedTo` filters are pure `WHERE`-clause
narrowing on top of the same `order.read`-gated, no-ownership-check admin
route that already existed — they cannot be used to retrieve an order an
`order.read` holder couldn't already list without them. No new
information-disclosure surface, just a real query instead of client-side
filtering over an unfiltered fetch.

## Refunds requested from this module never exceed what's refundable

`OrderService.cancel()`/`requestPartialRefund()` never move money
themselves — both call `RefundService.requestRefund()` (Phase 008), which
runs `RefundValidator.assertRefundable()` before any row is written. This
module adds no new money-movement code path; it only decides _when_ to
ask Phase 008 to refund, never _how much is safe to refund_.

## Idempotency and replay

See `docs/api/order.md`'s "Idempotency" table for the full
per-operation mechanism. The security-relevant property: every one of
those keys/locks (`Order.checkoutSessionId`/`paymentIntentId`,
`Invoice.orderId`, `Shipment.fulfillmentId`, the order-status row lock,
the fulfillment-quantity row lock, `Refund.idempotencyKey`) is a real
unique database constraint or row lock, not an application-level cache a
restart or a race could bypass — and every one of them is proven
race-safe under real concurrent duplicate submissions by this module's
own mandatory concurrency suite, not only sequential retries.

## What's proven, not just declared

- **The two RBAC roles are a real fixture, not a paper matrix.**
  `test/order.e2e-spec.ts` logs in as `fulfillment_clerk`
  (`+989120000012`) via the real OTP flow and asserts it can create a
  fulfillment but gets `403` on `POST .../cancel` and `POST .../refund`;
  a plain customer token gets `403` on every `/admin/orders` route.
  Phase 011: the same clerk gets `403` on `POST .../deliver` while still
  succeeding on a generic, non-`DELIVERED` shipment `PATCH` — the finer-
  grained boundary is real, not just declared in the permission table.
- **IDOR is rejected** on `orders/*` for a mismatched guest and a real
  second authenticated customer, and (Phase 011) on
  `GET admin/shipments/by-tracking/:trackingNumber` for a plain customer
  token.
- **An Order cannot be created, and its totals cannot be forged, from
  anything but a verified payment** — traced above; no e2e test path
  creates an order any way other than the real
  checkout->payment->conversion chain.
- **Over-fulfillment and duplicate-transition races are proven closed**,
  not assumed — see the two sections above for the exact test and, for
  the status-transition case, the real bug it caught and the fix. Phase
  011 extends this to `Fulfillment`/`Shipment` status transitions
  themselves (previously unlocked) and to fulfillment-creation
  idempotency (`idempotencyKey`) — both proven under real concurrent HTTP
  requests, not only at the repository layer.
- **Duplicate invoice-issue and shipment-create requests, concurrent or
  sequential, always converge to exactly one row** — proven for both
  paths.
- **Order completion cannot be forced by a cache-column lie** (Phase 011) — proven via `409` on both a `SHIPPED`-but-undelivered order and
  a zero-fulfillment order, `201` only once delivery is real.

## Deliberately not built this phase

- **No inventory restock on cancellation.** `OrderService.cancel()`
  requests a refund but never restocks reserved/converted inventory —
  the same gap `docs/product/payment.md`'s own Phase 008 scope already
  declares for refunds, not a new omission. Re-evaluated in Phase 011 and
  deliberately reaffirmed, not merely carried forward unexamined — see
  ADR-011 decision 8 and `docs/architecture/order.md`'s "Known,
  deliberate gaps" section.
- **No audit logging gap here** — unlike Phase 008's own documented
  gap, this module _does_ write `system.AuditLog` for every privileged
  admin mutation (`ORDER_STATUS_CHANGED`, `ORDER_CANCELLED`,
  `ORDER_REFUND_REQUESTED`, `FULFILLMENT_CREATED`,
  `FULFILLMENT_STATUS_CHANGED`, `SHIPMENT_CREATED`,
  `SHIPMENT_STATUS_CHANGED`, and, Phase 011, `SHIPMENT_DELIVERED`) —
  reusing `AUDIT_LOG_REPOSITORY` the same way `catalog`/`inventory` do,
  closing the gap Phase 008 itself left open rather than repeating it.
  Phase 011's new `Fulfillment`/`Shipment` status-update methods only
  audit-log on a genuine transition (`StatusUpdateResult.transitioned`),
  closing a small duplicate-audit-row edge case for those two aggregates
  specifically — a related instance of the same edge case on the
  pre-existing `Order.updateStatus()` call sites (`approve`/`complete`/
  `cancel()`) was found by the same audit but deliberately **not**
  retrofitted this phase: it produces at most one harmless extra
  `AuditLog` row when two callers race a no-op transition (never a
  duplicate `OrderStatusHistory` row — the row lock already prevents
  that), and fixing it means changing `OrderRepositoryPort.updateStatus()`'s
  return shape across six existing call sites for a cosmetic, not a
  correctness or security, gap. See `docs/architecture/order.md`'s
  "Phase 011" section for the full writeup.
- **No rate limiting specific to order mutation** — same blanket nginx
  `limit_req_zone` as everything else in this service (see
  `docs/security/README.md`'s "Not yet" list).
- **No manual/COD order-creation path** — every order traces back to a
  real checkout and a real verified payment; a cash-on-delivery or
  phone-order flow that creates an order before payment is a separate,
  deferred feature (see `docs/architecture/order.md`'s "Known,
  deliberate gaps").
- **No live courier tracking-event ingestion** — `Shipment`/
  `ShipmentEvent` are admin-entered only (`ManualShippingProvider`);
  Phase 011 did not add a courier webhook, so there is still no client-
  or-carrier-submitted event this module trusts without an admin in the
  loop.
