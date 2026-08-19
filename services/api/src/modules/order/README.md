# modules/order

Phase 009's clean-architecture module for order, invoice, and
fulfillment management: turning a verified payment into a durable order
record, issuing invoices, fulfilling and shipping order lines, and the
customer/admin-facing lifecycle around all three. Same layering
convention every prior module established:

```
order/
├── domain/
│   ├── entities/    — plain TS classes: Order, OrderItem,
│   │                  OrderStatusHistory, Invoice, InvoiceItem,
│   │                  Fulfillment, FulfillmentItem, Shipment,
│   │                  ShipmentEvent. No Prisma/NestJS dependency.
│   ├── ports/       — OrderRepositoryPort (aggregate root over items/
│   │                  history — same "child entities, no independent
│   │                  lifecycle" reasoning CheckoutSessionRepositoryPort/
│   │                  PaymentIntentRepositoryPort use),
│   │                  InvoiceRepositoryPort, FulfillmentRepositoryPort
│   │                  (aggregate root over fulfillment items/shipment/
│   │                  shipment events), and ShippingProviderPort — the
│   │                  courier-independence boundary this phase's
│   │                  own analogue to PaymentProviderAdapter.
│   └── services/    — pure business logic, zero I/O, unit-tested without
│                      a database (28 tests across 5 spec files):
│                        OrderStateMachine         — PENDING_PAYMENT -> PAID
│                                                     -> PROCESSING -> ...
│                                                     -> {CANCELLED|COMPLETED}
│                        FulfillmentStateMachine   — PENDING -> ... -> DELIVERED
│                        ShipmentStateMachine      — PENDING -> IN_TRANSIT ->
│                                                     {DELIVERED|FAILED}
│                        InvoiceStateMachine       — DRAFT -> ISSUED -> PAID,
│                                                     VOID from ISSUED/PAID
│                        FulfillmentQuantityValidator — never fulfills past
│                                                        an order item's
│                                                        ordered quantity
├── application/     — OrderConversionService, OrderService, InvoiceService,
│                      FulfillmentService.
├── infrastructure/
│   ├── repositories/   — one Prisma-backed implementation per port.
│   ├── providers/       — ManualShippingProvider (the one real
│   │                      implementation this phase — no live courier
│   │                      integration exists yet).
│   ├── order.mapper.ts  — Prisma-row -> domain-entity mappers, all 9 entities.
│   └── queues/          — BullMQ producers/consumers (see "Queues").
└── presentation/
    ├── controllers/  — OrderController (/orders/*),
    │                   OrderAdminController (/admin/orders/*),
    │                   FulfillmentAdminController (/admin/orders/:orderId/
    │                   fulfillments|shipments), InvoiceAdminController
    │                   (/admin/orders/:orderId/invoice).
    ├── dto/           — request/response DTOs, class-validator + @nestjs/swagger.
    └── filters/       — OrderDomainExceptionFilter.
```

Dependency direction is one-way:
`presentation → application → domain ← infrastructure`, verified the same
way every prior module's is — `domain/services/*.spec.ts` unit-tests the
pure logic with zero DB, zero NestJS test module, zero mocks.

Full design rationale for every non-obvious decision below:
[`docs/adr/ADR-009-order-fulfillment.md`](../../../../../docs/adr/ADR-009-order-fulfillment.md).

## `Order` keys off `CheckoutSession` + `PaymentIntent`, both real and both `@unique`

Unlike Phase 008's `PaymentIntent` (which had to anchor on
`CheckoutSession` because no `Order` existed yet), `Order` now exists and
its FKs are the real thing: `checkoutSessionId`/`paymentIntentId` are
both same-schema, enforced, `@unique` foreign keys, not unenforced
cross-schema pointers. This is the idempotency anchor
`OrderConversionService.convertFromCheckout()`'s P2002-catch-and-reread
safety relies on — a retried or racing conversion attempt for the same
checkout can never create two orders.

## `OrderConversionService.convertFromCheckout()` is the single place an `Order` is ever created

Composed from four prior modules at once — `CartCheckoutModule`
(`CheckoutService`), `CatalogModule` (`SkusService`/`ProductsService`),
`InventoryModule` (`ReservationService`), `PaymentModule`
(`PaymentIntentService`) — the deepest composition chain in this
codebase so far. Trusts exactly one signal:
`PaymentIntent.status === 'SUCCEEDED'` backed by a real `VERIFIED`
`PaymentTransaction`, both written entirely by Phase 008's own
`verifyPayment()`. Never allows an `Order` to become `PAID` merely
because a client says so.

Called two ways, never two diverging implementations: synchronously from
`OrderController.getByCheckout()` (the route a customer's post-payment
redirect lands on) and from the `order_conversion` sweep, a reliability
backstop for a customer who never returns. It also **resumes cleanly**
if a prior call crashed between `orders.create()` and finishing the PAID
transition/invoice issuance/`checkout.markConverted()` — a stuck order
still at its schema-default `PENDING_PAYMENT`/`UNPAID` is treated as
unfinished work, not a done deal, and the sweep's own second pass
(`listStuckPendingConversion`) exists specifically to find and resume
these even when the customer never comes back and the checkout itself
never reached `CONVERTED` — see `OrderConversionService`'s and
`OrderConversionProcessor`'s own doc comments for the exact mechanics.
This was a real bug this phase found and fixed on itself, not a
theoretical concern: see the git history for the two commits that
introduced and then completed the fix.

## Three cached fields alongside one authoritative state machine

`Order.status`/`paymentStatus`/`fulfillmentStatus` — the same
"cache columns + append-only/authoritative source" split
`CheckoutSession` and `InventoryItem` already established.
`paymentStatus`/`fulfillmentStatus` are never independently written by a
client; both are always re-derived (`FulfillmentService
.syncOrderFulfillmentState()` re-sums real `FulfillmentItem` rows every
time a fulfillment changes).

## Two real invariants enforced with row locks, not application trust

- **Order status transitions** (`PrismaOrderRepository.updateStatus()`)
  row-lock the order (`SELECT ... FOR UPDATE`) and re-check
  `OrderStateMachine` against the *locked* status before writing. Found
  and fixed via this module's own e2e concurrency suite: six concurrent
  `cancel()` calls on one order originally produced six
  `OrderStatusHistory` rows (a genuine check-then-act race, not merely a
  theoretical one), now collapse to exactly one real transition.
- **Over-fulfillment** (`PrismaFulfillmentRepository`'s
  `lockAndSumFulfilled`) reuses `mutateInventoryItem`'s own
  `SELECT ... FOR UPDATE` technique on `commerce.order_items`, re-summing
  already-fulfilled quantity across every non-`CANCELLED` fulfillment
  inside the same transaction as the new `FulfillmentItem` insert.

## Invoice issuance: automatic, idempotent, no re-issue mechanic

`InvoiceService.issueForOrder()` runs synchronously inside
`convertFromCheckout()` right after the PAID transition — a customer's
invoice exists by the time they can see their own order. Idempotent on
`orderId` (`@unique`); `POST /admin/orders/:orderId/invoice` is a
manual-trigger fallback for support, not the primary path. A correction
is a `VOID` (reachable from `ISSUED`/`PAID`) plus manual admin
follow-up — there is no automatic credit-note/re-issue this phase.

## Fulfillment + shipment: real state machines, one shipment per fulfillment

A partially-fulfilled order can have multiple `Fulfillment` rows, each
shipping independently (`Shipment.fulfillmentId` is `@unique` — one
shipment per fulfillment, not per order). `FulfillmentService
.updateShipmentStatus()` marking a shipment `DELIVERED` also drives its
own fulfillment to `DELIVERED` — there is no meaningful "shipment
delivered but fulfillment still `SHIPPED`" state. `ManualShippingProvider`
is the one real `ShippingProviderPort` implementation this phase; no
live courier integration exists yet, same "adapter is the boundary"
shape `PaymentProviderAdapter` established for a future real one.

## Queues

Two BullMQ queues, registered in-process inside `services/api` via
`infrastructure/queues/order-queue.module.ts`:

- **`order_conversion`** — every minute, two passes: every checkout
  Payment already marked `CONVERTED`, re-run through
  `convertFromCheckout()` (idempotent, cheap no-op if already converted);
  and every order stuck `PENDING_PAYMENT` for more than 2 minutes,
  resumed the same way (see "resumes cleanly" above).
- **`invoice_generation`** — every 5 minutes: every order paid in the
  last 24h whose invoice never got issued (a crash between the PAID
  transition and `invoices.issueForOrder()` inside the same
  `convertFromCheckout()` call), issued via the same
  `InvoiceService.issueForOrder()` the synchronous path uses.

Cannot import `OrderModule` (would create a cycle — `OrderModule` imports
this module), so it re-declares its own repository-port bindings and
application services as fresh instances, same precedent
`PaymentQueueModule`/`CartCheckoutQueueModule` already established. It
does import `CartCheckoutModule`/`CatalogModule`/`InventoryModule`/
`PaymentModule` directly (no cycle risk there) for their exported
services.

## Concurrency safety, proven

Found via this module's own e2e concurrency suite
(`test/order.e2e-spec.ts`'s "concurrency" section, 7 tests), not
assumed: racing checkout conversions collapse to exactly one `Order`;
concurrent order-number generation across distinct checkouts is unique
(`commerce.order_number_seq`, a real Postgres sequence — never an
application-memory counter); concurrent fulfillment requests never
over-fulfill (proven via real `FulfillmentItem` row counts); concurrent
invoice-issue and shipment-create requests each converge to exactly one
row (`P2002` caught and re-read, same pattern every prior phase's
idempotency guarantee uses); concurrent cancellation requests converge
to exactly one transition (the row-lock fix above); concurrent identical
partial-refund requests don't double-refund
(`Refund.idempotencyKey` — Phase 008's own guarantee, reused unchanged).

## Deliberately out of scope this phase

Same list as [`docs/product/order-fulfillment.md`](../../../../../docs/product/order-fulfillment.md)
and ADR-009's own "Deferred" section:

- Inventory restock on cancellation — the same gap `docs/product/payment.md`
  already declares for refunds, not a new omission.
- A manual/cash-on-delivery order-creation path — `Order.checkoutSessionId`/
  `paymentIntentId` are both required, real FKs; every order traces back
  to a real checkout and a real verified payment.
- Fulfillment-item quantity correction once a `Fulfillment` is created —
  only its `status` can move afterward.
- A live courier integration — `ManualShippingProvider` only, admin-entered
  carrier/tracking, no webhook ingestion.
- Invoice PDF generation — `Invoice.pdfUrl` exists in the schema, unused
  this phase.
- Credit notes / invoice re-issue — a correction is `VOID` plus manual
  admin follow-up.
