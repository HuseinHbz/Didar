# Order API (Phase 009, hardened Phase 011, exceptions added CP-031)

Endpoint reference for `services/api/src/modules/order`. This document
follows [`README.md`](./README.md)'s conventions (`/api/v1` base path,
whitelist validation, no GraphQL) — read that document first for what
applies to every endpoint in the service, not just this module's. For the
generated, always-in-sync spec, run the service and open `/api/v1/docs`;
the tables below are a hand-maintained companion for reviewing scope
without booting anything. Phase 011 rationale:
[`docs/adr/ADR-011-order-lifecycle-hardening.md`](../adr/ADR-011-order-lifecycle-hardening.md);
CP-031 (order exceptions, stock allocation at conversion) rationale:
[`docs/adr/ADR-031-payment-order-consistency.md`](../adr/ADR-031-payment-order-consistency.md).

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
| GET    | `/orders/:id`                            | Actor (owner only)          | Read one order, its items, its status history, and its immutable `promotions` snapshot (Phase 011)                                                                                                                                                                                                                                                                                                               |
| GET    | `/orders/:id/invoice`                    | Actor (owner only)          | Read the order's invoice (404 if none was ever issued)                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/orders/:id/shipments`                  | Actor (owner only)          | List the order's fulfillments (each with its own shipment, if any)                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/orders/by-checkout/:checkoutSessionId` | Actor (checkout owner only) | The route a customer's post-payment redirect lands on. Runs `OrderConversionService.convertFromCheckout()` synchronously and idempotently first, then returns the order — so the very first request after a successful payment already sees it, instead of waiting for the `order_conversion` sweep's own interval. Returns `{ converted: false, message }` (200) if the checkout hasn't verified a payment yet. |

`GET /orders/by-checkout/:checkoutSessionId` checks ownership against the
_checkout session_ (`CheckoutService.get()`) before attempting
conversion — a caller can never use this to probe an arbitrary
checkout's payment status.

## Orders (admin)

| Method | Path                                       | Permission       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/orders`                            | `order.read`     | List/search any order — `status`, `paymentStatus`, `fulfillmentStatus`, `customerId`, `placedFrom`/`placedTo` (any combination; Phase 011, real `WHERE` clauses, database-backed)                                                                                                                                                                                                                                     |
| GET    | `/admin/orders/:id`                        | `order.read`     | Read one order, no ownership check — response includes its `promotions` snapshot (Phase 011)                                                                                                                                                                                                                                                                                                                          |
| POST   | `/admin/orders/:checkoutSessionId/convert` | `order.create`   | Manually retry checkout->order conversion — the same idempotent `convertFromCheckout()` the customer-facing route and the sweep both call; support's tool for a checkout stuck mid-flight                                                                                                                                                                                                                             |
| POST   | `/admin/orders/:id/approve`                | `order.approve`  | Advances one legal step: `PAID -> PROCESSING` or `PROCESSING -> READY_TO_FULFILL`. CP-031: `409` while the order has an `OPEN` order exception (see below) — there is no override                                                                                                                                                                                                                                     |
| POST   | `/admin/orders/:id/complete`               | `order.complete` | `FULFILLED -> COMPLETED` — Phase 011: also requires every non-`CANCELLED` fulfillment to be actually `DELIVERED` and payment settled (`OrderCompletionValidator`), 409 otherwise                                                                                                                                                                                                                                      |
| POST   | `/admin/orders/:id/cancel`                 | `order.cancel`   | Cancels the order (idempotent) and requests a refund for whatever's been paid and not yet refunded (`paidTotal − refundedTotal`, CP-031). If that refund request fails the order is still cancelled, but the failure is logged at `ERROR` and audited as `ORDER_CANCEL_REFUND_REQUEST_FAILED` — it is not retried automatically (gap P1-18); settle it with `POST /admin/orders/:id/refund` — see "Known limitations" |
| POST   | `/admin/orders/:id/refund`                 | `order.refund`   | Requests a partial refund against a still-active order, independent of `cancel()`                                                                                                                                                                                                                                                                                                                                     |

## Order exceptions (admin, CP-031)

A paid order whose stock could not be allocated is still `PAID` (the customer has paid —
pretending otherwise would hide money) but carries an `OPEN` exception that **blocks
`approve`**. These routes are the operator work queue; the only ways out of an exception are
real stock (`retry-allocation`) or cancelling the order. There is no "force resolve" route.

| Method | Path                                           | Permission                | Notes                                                                                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/order-exceptions`                      | `order.exception.read`    | List exceptions, oldest first (the queue is worked from the front), cursor-paginated: `orderId` (uuid), `status` (`OPEN`/`RESOLVED`), `limit` (1–100, default 20), `cursor` (the previous page's `nextCursor`). Every filter is validated at the boundary — a malformed value is a `400`, never a `500` |
| GET    | `/admin/order-exceptions/:id`                  | `order.exception.read`    | Read one exception (`type`, `status`, `productSkuId`, `requestedQuantity`, `detail`, `openedAt`, `resolvedAt`, `resolution`, `resolvedBy`). The internal `dedupeKey` is deliberately not exposed                                                                                                        |
| POST   | `/admin/order-exceptions/:id/retry-allocation` | `order.exception.resolve` | Tries again to take the line's stock out of the warehouse. `201` with the resolved exception (`resolution: ALLOCATED`) on success — also, harmlessly, for one that is already resolved; `409` while the stock is still short (the exception stays `OPEN`)                                               |

`order.exception.read` and `order.exception.resolve` are granted to `admin` and, through its
`order.*` rule, `order_manager` — **not** to `fulfillment_clerk`. Cancelling the order
(`POST /admin/orders/:id/cancel`) also closes its exceptions (`resolution: ORDER_CANCELLED`).

## Invoices (admin)

| Method | Path                                  | Permission             | Notes                                                                                                                                                                           |
| ------ | ------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/orders/:orderId/invoice`      | `order.invoice.read`   | Read the order's invoice                                                                                                                                                        |
| POST   | `/admin/orders/:orderId/invoice`      | `order.invoice.create` | Manually (re)issue an invoice — idempotent on `orderId`; issuance itself is automatic (`OrderConversionService`), this is the support fallback if the automatic path was missed |
| POST   | `/admin/orders/:orderId/invoice/void` | `order.invoice.void`   | Void an `ISSUED`/`PAID` invoice                                                                                                                                                 |

## Fulfillments + shipments (admin)

| Method | Path                                                           | Permission               | Notes                                                                                                                                                                                                                                                               |
| ------ | -------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/orders/:orderId/fulfillments`                          | `order.read`             | List every fulfillment on the order                                                                                                                                                                                                                                 |
| POST   | `/admin/orders/:orderId/fulfillments`                          | `order.fulfill`          | Create a fulfillment for one or more order items; rejected (409) if it would over-fulfill any line. Accepts an optional `idempotencyKey` (Phase 011) — a retried request with the same key returns the original fulfillment instead of creating a second one        |
| PATCH  | `/admin/orders/:orderId/fulfillments/:fulfillmentId`           | `order.update`           | Advance the fulfillment's lifecycle — `ALLOCATED`/`PROCESSING`/`PACKED`/`READY`/`SHIPPED`/`CANCELLED` only; `DELIVERED` is a `400` here since Phase 011 (see `.../deliver` below)                                                                                   |
| POST   | `/admin/orders/:orderId/fulfillments/:fulfillmentId/shipments` | `order.ship`             | Create a shipment for a fulfillment; idempotent on `fulfillmentId` (one shipment per fulfillment)                                                                                                                                                                   |
| GET    | `/admin/orders/:orderId/shipments`                             | `order.shipment.read`    | List the order's fulfillments (same shape as the fulfillments list, kept as its own route per the spec)                                                                                                                                                             |
| GET    | `/admin/shipments/by-tracking/:trackingNumber`                 | `order.shipment.read`    | Phase 011: look up a shipment by its exact tracking number without already knowing its order; 404 if none matches                                                                                                                                                   |
| PATCH  | `/admin/orders/:orderId/shipments/:shipmentId`                 | `order.shipment.update`  | Update shipment status/tracking — `IN_TRANSIT`/`FAILED`/`CANCELLED` only; `DELIVERED` is a `400` here since Phase 011 (see `.../deliver` below)                                                                                                                     |
| POST   | `/admin/orders/:orderId/shipments/:shipmentId/deliver`         | `order.shipment.deliver` | Phase 011: the one route that can confirm delivery — its own permission, distinct from `order.shipment.update` (`fulfillment_clerk` has the latter, not this). Also drives the fulfillment to `DELIVERED`; idempotent, generates a `SHIPMENT_DELIVERED` audit entry |

Fulfillment quantities are fixed once a `Fulfillment` is created — there's
no partial-item correction route this phase (see "Known limitations").
`DELIVERED` was reachable via the generic `PATCH` routes through Phase
009; Phase 011 moved it to its own dedicated, more tightly permissioned
route (ADR-011 decision 4) — the generic routes' own DTOs now reject the
value outright (`400`, never reaching the service layer).

## Idempotency

| Operation                               | Mechanism                                                                                                                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order creation                          | `Order.checkoutSessionId` + `Order.paymentIntentId`, both `@unique` — `OrderConversionService.convertFromCheckout()` is P2002-catch-and-reread safe, and now resumable even if a prior call crashed mid-flight (see the module README)                                          |
| Order number generation                 | `commerce.order_number_seq`, a real Postgres sequence drawn inside the same transaction as the insert — concurrency-safe by construction, never an application-memory counter                                                                                                   |
| Invoice issuance                        | `Invoice.orderId`, `@unique` — a retried `issueForOrder()`/`POST .../invoice` returns the existing invoice                                                                                                                                                                      |
| Invoice number generation               | `finance.invoice_number_seq`, same technique as order numbers                                                                                                                                                                                                                   |
| Shipment creation                       | `Shipment.fulfillmentId`, `@unique` — a retried `POST .../shipments` returns the existing shipment                                                                                                                                                                              |
| Over-fulfillment prevention             | `SELECT ... FOR UPDATE` row lock on `commerce.order_items` inside the same transaction as the fulfillment insert, re-summing already-fulfilled quantity across every non-`CANCELLED` fulfillment — two truly concurrent fulfillment requests can never both pass                |
| Order status transitions                | `SELECT ... FOR UPDATE` row lock on `commerce.orders`, re-checking `OrderStateMachine` against the locked status before writing — two concurrent transition requests (e.g. two `cancel()` calls) never both write a history row                                                 |
| Cancellation refund                     | `Refund.idempotencyKey = order-cancel__${orderId}`, `@unique` — a retried/racing cancel never double-refunds                                                                                                                                                                    |
| Partial refund                          | `Refund.idempotencyKey = order-partial-refund__${orderId}__${amount}` — a retried/racing identical-amount refund request never double-refunds                                                                                                                                   |
| Order exception creation                | CP-031: `UNIQUE dedupe_key = STOCK_SHORTFALL:<orderId>:<sku>` — concurrent conversions, sweeps and retries of one shortfall collapse onto a single row (P2002-catch-and-reread) and one audit entry                                                                             |
| Stock allocation at conversion          | CP-031: the checkout's own reservation is sold if it still holds the units; otherwise stock is re-acquired under the deterministic reservation key `order__<orderId>__<sku>` and sold — every racing sweep/retry converges on one reservation and one sale (`StockSaleService`) |
| Fulfillment creation                    | Phase 011: optional client-supplied `Fulfillment.idempotencyKey`, `@unique` — P2002-catch-and-reread, same pattern as every row above; only enforced when a caller actually supplies a key                                                                                      |
| Fulfillment/shipment status transitions | Phase 011: `SELECT ... FOR UPDATE` row lock on `commerce.fulfillments`/`commerce.shipments`, same technique as the order-status row above — closes a real check-then-act race Phase 009 left open on these two aggregates specifically                                          |
| Delivery confirmation                   | Phase 011: idempotent by construction — `ShipmentStateMachine.isNoOp()`/`FulfillmentStateMachine.isNoOp()` resolve a repeat `POST .../deliver` on an already-`DELIVERED` shipment/fulfillment to a no-op, not a duplicate transition or audit entry                             |

## Errors

Nine domain error types get a real HTTP mapping via
`OrderDomainExceptionFilter` (`APP_FILTER`, scoped `@Catch()`):

| Domain error                               | HTTP status |
| ------------------------------------------ | ----------- |
| `InvalidOrderTransitionError`              | 409         |
| `InvalidFulfillmentTransitionError`        | 409         |
| `InvalidInvoiceTransitionError`            | 409         |
| `InvalidShipmentTransitionError`           | 409         |
| `OverFulfillmentError`                     | 409         |
| `NonPositiveFulfillmentQuantityError`      | 400         |
| `OrderNotReadyToCompleteError` (Phase 011) | 409         |
| `OrderHasOpenExceptionError` (CP-031)      | 409         |
| `StockStillShortError` (CP-031)            | 409         |

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
