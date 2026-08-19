# Order API (Phase 009)

Endpoint reference for `services/api/src/modules/order`. This document
follows [`README.md`](./README.md)'s conventions (`/api/v1` base path,
whitelist validation, no GraphQL) — read that document first for what
applies to every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open `/api/v1/docs`;
the tables below are a hand-maintained companion for reviewing scope
without booting anything.

Module-level design detail (layering, the four aggregates, what's
deliberately not built): [`services/api/src/modules/order/README.md`](../../services/api/src/modules/order/README.md).
Auth model: [`docs/security/order-security.md`](../security/order-security.md).

## Auth: two models, split by who calls each route

- **`orders/*`** reuses `cart-checkout`'s own `ActorResolverGuard`
  directly (imported, not reimplemented) — an order's owner is exactly
  its originating checkout's owner, customer or guest alike. See
  `docs/api/cart-checkout.md`'s "Auth" section for the exact guest/
  authenticated resolution rules; they apply unchanged here.
- **`admin/orders/*`** are permission-gated admin routes behind the
  service's global `JwtAuthGuard` + `AuthorizationGuard`, exactly like
  every other `admin/*` route in this service. No `@Public()`, no guest
  path.

## Orders (customer/guest)

| Method | Path                                     | Auth                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ---------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/orders`                                | Actor (owner only)          | List the caller's own orders (customer or guest)                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/orders/:id`                            | Actor (owner only)          | Read one order, its items, and its status history                                                                                                                                                                                                                                                                                                                                                                |
| GET    | `/orders/:id/invoice`                    | Actor (owner only)          | Read the order's invoice (404 if none was ever issued)                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/orders/:id/shipments`                  | Actor (owner only)          | List the order's fulfillments (each with its own shipment, if any)                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/orders/by-checkout/:checkoutSessionId` | Actor (checkout owner only) | The route a customer's post-payment redirect lands on. Runs `OrderConversionService.convertFromCheckout()` synchronously and idempotently first, then returns the order — so the very first request after a successful payment already sees it, instead of waiting for the `order_conversion` sweep's own interval. Returns `{ converted: false, message }` (200) if the checkout hasn't verified a payment yet. |

`GET /orders/by-checkout/:checkoutSessionId` checks ownership against the
_checkout session_ (`CheckoutService.get()`) before attempting
conversion — a caller can never use this to probe an arbitrary
checkout's payment status.

## Orders (admin)

| Method | Path                                       | Permission       | Notes                                                                                                                                                                                     |
| ------ | ------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/orders`                            | `order.read`     | List any order, optionally filtered by `status`                                                                                                                                           |
| GET    | `/admin/orders/:id`                        | `order.read`     | Read one order, no ownership check                                                                                                                                                        |
| POST   | `/admin/orders/:checkoutSessionId/convert` | `order.create`   | Manually retry checkout->order conversion — the same idempotent `convertFromCheckout()` the customer-facing route and the sweep both call; support's tool for a checkout stuck mid-flight |
| POST   | `/admin/orders/:id/approve`                | `order.approve`  | Advances one legal step: `PAID -> PROCESSING` or `PROCESSING -> READY_TO_FULFILL`                                                                                                         |
| POST   | `/admin/orders/:id/complete`               | `order.complete` | `FULFILLED -> COMPLETED`, the final confirmation once delivery is done                                                                                                                    |
| POST   | `/admin/orders/:id/cancel`                 | `order.cancel`   | Cancels the order (idempotent) and requests a refund for whatever's been paid — see "Known limitations"                                                                                   |
| POST   | `/admin/orders/:id/refund`                 | `order.refund`   | Requests a partial refund against a still-active order, independent of `cancel()`                                                                                                         |

## Invoices (admin)

| Method | Path                                  | Permission             | Notes                                                                                                                                                                           |
| ------ | ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/orders/:orderId/invoice`      | `order.invoice.read`   | Read the order's invoice                                                                                                                                                        |
| POST   | `/admin/orders/:orderId/invoice`      | `order.invoice.create` | Manually (re)issue an invoice — idempotent on `orderId`; issuance itself is automatic (`OrderConversionService`), this is the support fallback if the automatic path was missed |
| POST   | `/admin/orders/:orderId/invoice/void` | `order.invoice.void`   | Void an `ISSUED`/`PAID` invoice                                                                                                                                                 |

## Fulfillments + shipments (admin)

| Method | Path                                                           | Permission              | Notes                                                                                                   |
| ------ | -------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/orders/:orderId/fulfillments`                          | `order.read`            | List every fulfillment on the order                                                                     |
| POST   | `/admin/orders/:orderId/fulfillments`                          | `order.fulfill`         | Create a fulfillment for one or more order items; rejected (409) if it would over-fulfill any line      |
| PATCH  | `/admin/orders/:orderId/fulfillments/:fulfillmentId`           | `order.update`          | Advance the fulfillment's own 8-state lifecycle (`PENDING -> ... -> DELIVERED`)                         |
| POST   | `/admin/orders/:orderId/fulfillments/:fulfillmentId/shipments` | `order.ship`            | Create a shipment for a fulfillment; idempotent on `fulfillmentId` (one shipment per fulfillment)       |
| GET    | `/admin/orders/:orderId/shipments`                             | `order.shipment.read`   | List the order's fulfillments (same shape as the fulfillments list, kept as its own route per the spec) |
| PATCH  | `/admin/orders/:orderId/shipments/:shipmentId`                 | `order.shipment.update` | Update shipment status/tracking; a `DELIVERED` shipment also drives its own fulfillment to `DELIVERED`  |

Fulfillment quantities are fixed once a `Fulfillment` is created — there's
no partial-item correction route this phase (see "Known limitations").

## Idempotency

| Operation                   | Mechanism                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order creation              | `Order.checkoutSessionId` + `Order.paymentIntentId`, both `@unique` — `OrderConversionService.convertFromCheckout()` is P2002-catch-and-reread safe, and now resumable even if a prior call crashed mid-flight (see the module README)                           |
| Order number generation     | `commerce.order_number_seq`, a real Postgres sequence drawn inside the same transaction as the insert — concurrency-safe by construction, never an application-memory counter                                                                                    |
| Invoice issuance            | `Invoice.orderId`, `@unique` — a retried `issueForOrder()`/`POST .../invoice` returns the existing invoice                                                                                                                                                       |
| Invoice number generation   | `finance.invoice_number_seq`, same technique as order numbers                                                                                                                                                                                                    |
| Shipment creation           | `Shipment.fulfillmentId`, `@unique` — a retried `POST .../shipments` returns the existing shipment                                                                                                                                                               |
| Over-fulfillment prevention | `SELECT ... FOR UPDATE` row lock on `commerce.order_items` inside the same transaction as the fulfillment insert, re-summing already-fulfilled quantity across every non-`CANCELLED` fulfillment — two truly concurrent fulfillment requests can never both pass |
| Order status transitions    | `SELECT ... FOR UPDATE` row lock on `commerce.orders`, re-checking `OrderStateMachine` against the locked status before writing — two concurrent transition requests (e.g. two `cancel()` calls) never both write a history row                                  |
| Cancellation refund         | `Refund.idempotencyKey = order-cancel__${orderId}`, `@unique` — a retried/racing cancel never double-refunds                                                                                                                                                     |
| Partial refund              | `Refund.idempotencyKey = order-partial-refund__${orderId}__${amount}` — a retried/racing identical-amount refund request never double-refunds                                                                                                                    |

## Errors

Six domain error types get a real HTTP mapping via
`OrderDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                          | HTTP status |
| ------------------------------------- | ----------- |
| `InvalidOrderTransitionError`         | 409         |
| `InvalidFulfillmentTransitionError`   | 409         |
| `InvalidInvoiceTransitionError`       | 409         |
| `InvalidShipmentTransitionError`      | 409         |
| `OverFulfillmentError`                | 409         |
| `NonPositiveFulfillmentQuantityError` | 400         |

Ownership violations on `orders/*` and `orders/by-checkout/*` (an actor
reading an order/checkout that isn't theirs) are a plain `403 Forbidden`,
thrown directly by `OrderService`'s/`CheckoutService`'s own ownership
checks — not routed through the domain exception filter above, same
convention `docs/api/payment.md`'s "Errors" section documents for its own
module.

This is intentionally narrower than `docs/api/README.md`'s noted-as-future
general error-shape standardization — it covers exactly this module's
domain-layer error types, not a service-wide `{success, error, requestId}`
envelope.
