# Order, invoice, and fulfillment architecture (Phase 009, hardened Phase 011)

Full design rationale: [`docs/adr/ADR-009-order-fulfillment.md`](../adr/ADR-009-order-fulfillment.md)
(the original module) and
[`docs/adr/ADR-011-order-lifecycle-hardening.md`](../adr/ADR-011-order-lifecycle-hardening.md)
(lifecycle/concurrency/RBAC hardening — this document's "Phase 011"
section below). Full layering/scope detail: [`services/api/src/modules/order/README.md`](../../services/api/src/modules/order/README.md).
This document is the short "where does order fit in the system" view —
read it alongside [`docs/architecture/README.md`](README.md), which it
extends rather than replaces.

## Where it sits

```
storefront / admin / pwa / mobile
                │
        services/api (NestJS)
                │
        modules/order              ← Phase 009, this document
   (domain → application → infrastructure/presentation)
        │              │              │              │
   cart-checkout    catalog        inventory       payment
   (CheckoutService, (SkusService, (ReservationService)  (PaymentIntentService,
    ActorResolverGuard) ProductsService)                  RefundService)
        │
   BullMQ queues (in-process — order_conversion, invoice_generation)
        │
   packages/database (Prisma)      Redis (queues only — never
        │                           authoritative for order state)
   PostgreSQL
   commerce schema (orders/order_items/order_status_history/
   fulfillments/fulfillment_items/shipments/shipment_events),
   finance schema (invoices/invoice_items)
```

Same shape every other domain module in `services/api` follows — the
sixth full clean-architecture example after `modules/identity` (Phase
004), `modules/catalog` (Phase 005), `modules/inventory` (Phase 006),
`modules/cart-checkout` (Phase 007), and `modules/payment` (Phase 008).
It goes one step further than `payment`'s own "composed from another
module's real service" shape: this module imports four prior modules at
once (`CartCheckoutModule`, `CatalogModule`, `InventoryModule`,
`PaymentModule`) — the deepest composition chain in this codebase so far
(ADR-009 decision 9).

## An Order is created from a verified payment, never a client-supplied body

`OrderConversionService.convertFromCheckout()` is the single place an
`Order` is ever created (ADR-009 decision 4). It trusts exactly one
signal: `PaymentIntent.status === 'SUCCEEDED'` backed by a real
`VERIFIED` `PaymentTransaction` — both written entirely by Phase 008's
own `PaymentIntentService.verifyPayment()`, never by anything in this
module. There is no `POST /orders` route at all; the closest thing is
`GET /orders/by-checkout/:checkoutSessionId`, which runs conversion as a
side effect of reading, and the admin manual-conversion-retry route,
which calls the exact same method.

Called from two places, never two diverging implementations: the
customer-facing `GET /orders/by-checkout/:checkoutSessionId` (the route
a post-payment redirect lands on) and the `order_conversion` sweep, a
reliability backstop for a customer who never returns to trigger
anything synchronously. `convertFromCheckout()` also resumes cleanly if
a prior call crashed between creating the `Order` row and finishing the
PAID transition/invoice issuance/`checkout.markConverted()` — a stuck
order still at its schema-default `PENDING_PAYMENT`/`UNPAID` is treated
as unfinished work to resume, not a done deal to return as-is.

## PostgreSQL is the single source of truth; four real invariants are enforced with row locks, not application trust

- **Order status transitions** (`PrismaOrderRepository.updateStatus()`)
  — `SELECT ... FOR UPDATE` on the order row before deciding anything,
  re-checking `OrderStateMachine` against the _locked_ status. Two
  concurrent callers racing the same transition (e.g. two `cancel()`
  calls) resolve to exactly one real transition and one
  `OrderStatusHistory` row; the other collapses to a no-op instead of
  writing a duplicate.
- **Over-fulfillment** (`PrismaFulfillmentRepository`'s
  `lockAndSumFulfilled`) — the same `SELECT ... FOR UPDATE` technique
  applied to `commerce.order_items`, re-summing already-fulfilled
  quantity across every non-`CANCELLED` fulfillment inside the same
  transaction as the new `FulfillmentItem` insert. Two truly concurrent
  fulfillment requests targeting the same order item can never both pass.
- **Order/invoice numbering** — real Postgres sequences
  (`commerce.order_number_seq`, `finance.invoice_number_seq`), drawn
  inside the same transaction as the insert. Never an application-memory
  counter; a sequence gap from a lost race is expected and harmless,
  uniqueness is all that's guaranteed.
- **Fulfillment/shipment status transitions** (Phase 011,
  `PrismaFulfillmentRepository.updateStatus()`/`updateShipmentStatus()`)
  — the exact same `SELECT ... FOR UPDATE` + re-check-the-state-machine-
  against-the-locked-row technique the order-status fix above already
  proved, applied to the two aggregates that didn't have it yet. A real,
  previously-undetected check-then-act race (the read-status-then-write-
  status split lived in the application layer, not the repository) —
  found by inspection while auditing Phase 009 for this exact bug class,
  not by a failing test first. See
  [`docs/adr/ADR-011-order-lifecycle-hardening.md`](../adr/ADR-011-order-lifecycle-hardening.md)
  decision 1.

Redis is used **only** for the two BullMQ sweep queues
(`order_conversion`, `invoice_generation`), never to answer "does this
order exist" — every such read goes to Postgres.

## What changed outside `modules/order` itself

- **`packages/database/prisma/schema.prisma`** — the Phase 003
  placeholder `Order`/`OrderItem`/`OrderStatusHistory`/`Invoice`/
  `InvoiceLine` dropped and replaced with the real subtree: 6 new enums,
  9 tables (`Order`, `OrderItem`, `OrderStatusHistory`, `Fulfillment`,
  `FulfillmentItem`, `Shipment`, `ShipmentEvent` in `commerce`; `Invoice`,
  `InvoiceItem` — renamed from `InvoiceLine` — in `finance`) — see
  `docs/database/order-erd.md`.
- **`packages/types`** — 8 new branded IDs, 6 new enum unions, and the
  `ShippingProvider` port's shared return-shape contracts.
- **`services/api/app.module.ts`** — registers `OrderModule`.
- **`services/api/src/modules/payment/application/payment-intent.service.ts`**
  — additive `findByCheckoutSessionId()`/`findById()`, reserved hooks for
  `OrderConversionService`/`OrderService` to consume, same "next phase
  adds a hook to the previous phase's service" convention every prior
  phase used.
- **`services/api/src/modules/payment/payment.module.ts`** — additive
  `exports: [PaymentIntentService, RefundService]` (this module had no
  `exports` array before).
- **`services/api/src/modules/cart-checkout/application/checkout.service.ts`**
  — additive `findByIdSystem()`/`listConvertedSince()`, the system-level
  (no ownership check) lookups `OrderConversionService` and the
  `order_conversion` sweep need.
- **`services/api/src/modules/cart-checkout/domain/ports/checkout-session.repository.port.ts`**
  - its Prisma implementation — additive `listConvertedSince(since)`.
- **RBAC data** — 14 new `order.*` permissions, two new roles
  (`order_manager`, `fulfillment_clerk`) — see
  `docs/security/order-security.md`.

Nothing in `modules/payment`'s or `modules/cart-checkout`'s own existing
behavior changed beyond these additive hooks — both behavior-preserving,
verified by re-running every prior phase's own e2e suite unchanged (99
across identity/catalog/inventory/cart-checkout + 19 across payment, all
still passing after this phase's changes).

## Frontend: deliberately not built this phase

Same precedent every prior backend phase set. `GET /orders/by-checkout/
:checkoutSessionId` returns JSON describing the order (or
`{ converted: false }`) rather than redirecting to an order-confirmation
page — there is no storefront page to redirect to yet.

## Known, deliberate gaps

- **No inventory restock on cancellation.** By the time an `Order` row
  exists at all, `OrderConversionService.convertFromCheckout()` has
  already converted every reservation the checkout held — stock is
  genuinely sold, not merely held. `OrderService.cancel()` never
  restocks it. This is the same gap `RefundService`'s own Phase 008 doc
  comment and `docs/product/payment.md` already declare for refunds, not
  a new omission this phase introduces.
- **No manual/COD order creation path.** `Order.checkoutSessionId`/
  `paymentIntentId` are both real, required, `@unique` FKs — every order
  in this schema traces back to a real checkout and a real verified
  payment, `source: ADMIN`/`POS` included. A cash-on-delivery or manual
  phone-order flow that creates an order before payment is a deferred,
  separate feature.
- **No fulfillment-item quantity correction.** Once a `Fulfillment` is
  created, its item quantities are fixed — only its `status` can move.
  Correcting a mis-picked quantity requires cancelling that fulfillment
  and creating a new one.

## Concurrency, proven not assumed

The mandatory concurrency suite (`services/api/test/order.e2e-spec.ts`'s
"concurrency" section, 7 tests) proved these races, not just declared
them safe on paper: racing checkout conversions collapse to exactly one
`Order`; concurrent order-number generation across 5 distinct checkouts
produces 5 unique numbers; concurrent fulfillment requests against the
same order item never sum past its ordered quantity (verified via
`FulfillmentItem` row counts, not just HTTP status codes); concurrent
invoice-issue and shipment-create requests each converge to exactly one
row; concurrent cancellation requests converge to exactly one
`CANCELLED` transition — this is the specific race that caught a real
bug (`OrderService.cancel()`'s check-then-act pattern wasn't atomic; see
`PrismaOrderRepository.updateStatus()`'s own doc comment for the fix);
concurrent identical partial-refund requests don't double-refund.

Phase 011 added `test/order-repository.e2e-spec.ts` — a hybrid pattern
(full app booted for HTTP-driven setup: guest checkout -> payment ->
order -> approve x2 -> `READY_TO_FULFILL`; the actual racy calls bypass
HTTP and hit `PrismaFulfillmentRepository` directly, since the aggregate
under test needs a real `CheckoutSession`/`PaymentIntent` FK chain first,
unlike Phase 010's shallower `Promotion`/`Coupon` repository tests) —
proving: 20 concurrent identical fulfillment-status updates collapse to
exactly one real transition; 20 concurrent identical shipment-status
updates collapse to exactly one; a transition no longer legal once the
lock is held throws a real 409, not a silent no-op; 15 concurrent
`create()` calls sharing one `idempotencyKey` produce exactly one
`Fulfillment` row. Ran twice consecutively to rule out flakiness.

## Phase 011 — order lifecycle hardening

Full rationale: [`docs/adr/ADR-011-order-lifecycle-hardening.md`](../adr/ADR-011-order-lifecycle-hardening.md).
This phase did not rebuild anything above — it audited Phase 009's own
implementation against the brief's exact concurrency/security scenario
list, found what was actually still open, and closed it:

- **Fulfillment/shipment status-transition races** — the fourth row-lock
  invariant above; a real bug, not a theoretical one.
- **Fulfillment-creation idempotency** — `Fulfillment.idempotencyKey`
  (`@unique`, nullable), same P2002-catch-and-reread pattern every prior
  idempotency guarantee in this codebase uses. Optional: a caller that
  doesn't supply one gets the pre-existing behavior (a new fulfillment
  every call, still safely quantity-checked by `lockAndSumFulfilled`).
- **Order completion is now a server-derived fact.** `OrderService
.complete()` no longer just asserts the `OrderStateMachine` edge — it
  first calls the new `OrderCompletionValidator.assertReady()` (pure
  domain service, zero I/O) against the order's real fulfillments: every
  non-`CANCELLED` fulfillment must actually be `DELIVERED` (not merely
  quantity-covered), and payment must be settled. A `PATCH .../status`
  with `COMPLETED` was never a route in this module (Phase 009 already
  didn't build that trust gap) — this closes the more subtle version:
  `POST .../complete` itself used to trust "fulfillmentStatus cache
  column says FULFILLED" as good enough, without checking the shipment
  side ever actually delivered.
- **Delivery confirmation is its own route, permission, and audit
  action** — `POST admin/orders/:orderId/shipments/:shipmentId/deliver`
  (`order.shipment.deliver`), structurally distinct from the generic
  `PATCH .../shipments/:shipmentId` (`order.shipment.update`), whose own
  DTO now excludes `DELIVERED` from its accepted enum entirely — a
  generic status PATCH to `DELIVERED` is a `400` at the validation layer,
  never reaches the service. Confirming delivery also re-derives the
  fulfillment's own status via the same code path, so "shipment
  delivered, fulfillment still `SHIPPED`" remains impossible, same
  guarantee Phase 009 already had, now reachable from exactly one place.
- **Tracking numbers are unique when present and searchable** —
  `Shipment.trackingNumber` gained a `UNIQUE` index and a new
  `GET admin/shipments/by-tracking/:trackingNumber` lookup route
  (`order.shipment.read`) — a real constraint with a real consumer, not a
  decorative field.
- **Admin order search/filtering is real and database-backed.**
  `GET admin/orders` gained `paymentStatus`/`fulfillmentStatus`/
  `customerId`/`placedFrom`/`placedTo`, all combinable, all genuine
  Postgres `WHERE` clauses in `PrismaOrderRepository.list()` — never
  fetched-then-filtered in application code — backed by three new
  indexes (`paymentStatus`, `fulfillmentStatus`, `placedAt`).
- **The Phase 010 promotion snapshot is finally surfaced on order
  reads.** `OrderWithDetail.promotions` is read back and exposed on both
  `GET /orders/:id` and `GET /admin/orders/:id` — the immutable
  `OrderPromotion` snapshot rows existed since Phase 010 but nothing
  outside the admin DB read them back until this phase.
- **Inventory restock-on-cancellation stays deliberately deferred** —
  re-evaluated this phase (not merely carried forward unexamined) and
  reaffirmed: a correct implementation needs new reservation-lineage
  tracking this phase's brief didn't ask for; see ADR-011 decision 8 for
  the full reasoning. Still the same gap the "Known, deliberate gaps"
  section above already documents.
- **What deliberately did not change**: `OrderStateMachine`/
  `FulfillmentStateMachine`/`ShipmentStateMachine`'s graphs (already
  correct on inspection), `InvoiceService`'s immutable-after-issue model,
  `OrderConversionService`'s crash-recovery behavior, and
  `ShippingProviderPort`/`ManualShippingProvider` (still no live courier
  integration — that stays a documented gap, not something this phase
  faked).

A related, lower-severity finding from the same audit was **found but
deliberately not fixed this phase**: `OrderService.approve()`/
`complete()`/`cancel()` call `OrderRepositoryPort.updateStatus()`
unconditionally followed by an unconditional `auditLog.record()` — if two
callers race and the repository's own row-locked check resolves the
loser to a no-op, `OrderStatusHistory` correctly stays at one row (the
row lock already guarantees that), but the loser still writes one
`AuditLog` row for a transition that didn't actually happen a second
time. The three new Phase 011 methods
(`FulfillmentRepositoryPort.updateStatus()`/`updateShipmentStatus()`)
were designed correctly from the start via a new `StatusUpdateResult<T>
= { entity: T; transitioned: boolean }` return shape, so their own
callers only audit-log on a real transition. Retrofitting the same shape
onto `OrderRepositoryPort.updateStatus()`'s six existing call sites was
judged out of this phase's actual scope (a return-type-shape change
across every consumer, for a duplicate-but-harmless audit row, not a
correctness or security gap) — documented here as a known, deferred
finding rather than silently left unexamined.
