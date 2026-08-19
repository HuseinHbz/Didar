# Order security (Phase 009)

This document is `docs/security/README.md`'s "In place today" table,
expanded for the one module Phase 009 added. Read
[`README.md`](./README.md) first for what applies service-wide (rate
limiting, secrets, dependency scanning, ...); this document only covers
what's specific to the order/invoice/fulfillment domain.

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
  checks ownership against the *checkout session* itself
  (`CheckoutService.get()`) before running conversion, so it can never be
  used to probe an arbitrary checkout's payment status.
- **`admin/orders/*`** — RBAC, behind the service's global
  `JwtAuthGuard` + `AuthorizationGuard`, gated per-route by
  `@RequirePermission`.

## RBAC model

14 new `order.*` permissions, matching exactly what every controller
checks (`docs/api/order.md` has the full route-to-permission mapping):

| Permission              | Meaning                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| `order.read`               | Read any order (admin/support scope)                             |
| `order.create`              | Manually retry checkout->order conversion for a verified payment |
| `order.update`              | Update a fulfillment record on an order                          |
| `order.cancel`              | Cancel an order                                                  |
| `order.approve`             | Approve an order for processing                                  |
| `order.fulfill`             | Create a fulfillment for an order                                 |
| `order.ship`                | Create a shipment for a fulfillment                               |
| `order.complete`            | Mark an order `COMPLETED`                                        |
| `order.refund`              | Request a partial refund against a paid order                     |
| `order.invoice.read`        | Read an order's invoice                                           |
| `order.invoice.create`      | Manually (re)issue an invoice for an order                        |
| `order.invoice.void`        | Void an issued invoice                                            |
| `order.shipment.read`       | Read an order's shipments                                        |
| `order.shipment.update`     | Update a shipment status/tracking event                           |

Two new roles, real least-privilege boundaries, not labels:

- **`order_manager`** — every `order.*` permission (a department head —
  can approve/cancel/refund/complete orders and void invoices).
- **`fulfillment_clerk`** — `order.read`, `order.update`, `order.fulfill`,
  `order.ship`, `order.shipment.read`, `order.shipment.update` only. The
  same "floor role can't approve its own sensitive action" shape
  `warehouse_operator`/`finance_auditor` already established: creating
  and updating fulfillments/shipments is safe to grant broadly, but
  `approve`/`cancel`/`refund`/`complete`/`invoice.void` are not.

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
*checkout's* ownership via `CheckoutService.get()` — the same 404/403 a
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
*locked* status before writing — discovered as a real gap by this
module's own concurrency suite (six concurrent cancel requests on one
order originally produced six `OrderStatusHistory` rows, not one) and
fixed at the repository layer so every caller of `updateStatus()`
benefits, not just `cancel()`. See
`docs/architecture/order.md`'s "Concurrency, proven not assumed" section.

## Refunds requested from this module never exceed what's refundable

`OrderService.cancel()`/`requestPartialRefund()` never move money
themselves — both call `RefundService.requestRefund()` (Phase 008), which
runs `RefundValidator.assertRefundable()` before any row is written. This
module adds no new money-movement code path; it only decides *when* to
ask Phase 008 to refund, never *how much is safe to refund*.

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
- **IDOR is rejected** on `orders/*` for a mismatched guest and a real
  second authenticated customer.
- **An Order cannot be created, and its totals cannot be forged, from
  anything but a verified payment** — traced above; no e2e test path
  creates an order any way other than the real
  checkout->payment->conversion chain.
- **Over-fulfillment and duplicate-transition races are proven closed**,
  not assumed — see the two sections above for the exact test and, for
  the status-transition case, the real bug it caught and the fix.
- **Duplicate invoice-issue and shipment-create requests, concurrent or
  sequential, always converge to exactly one row** — proven for both
  paths.

## Deliberately not built this phase

- **No inventory restock on cancellation.** `OrderService.cancel()`
  requests a refund but never restocks reserved/converted inventory —
  the same gap `docs/product/payment.md`'s own Phase 008 scope already
  declares for refunds, not a new omission. See
  `docs/architecture/order.md`'s "Known, deliberate gaps" section.
- **No audit logging gap here** — unlike Phase 008's own documented
  gap, this module *does* write `system.AuditLog` for every privileged
  admin mutation (`ORDER_STATUS_CHANGED`, `ORDER_CANCELLED`,
  `ORDER_REFUND_REQUESTED`, `FULFILLMENT_CREATED`,
  `FULFILLMENT_STATUS_CHANGED`, `SHIPMENT_CREATED`,
  `SHIPMENT_STATUS_CHANGED`) — reusing `AUDIT_LOG_REPOSITORY` the same
  way `catalog`/`inventory` do, closing the gap Phase 008 itself left
  open rather than repeating it.
- **No rate limiting specific to order mutation** — same blanket nginx
  `limit_req_zone` as everything else in this service (see
  `docs/security/README.md`'s "Not yet" list).
- **No manual/COD order-creation path** — every order traces back to a
  real checkout and a real verified payment; a cash-on-delivery or
  phone-order flow that creates an order before payment is a separate,
  deferred feature (see `docs/architecture/order.md`'s "Known,
  deliberate gaps").
