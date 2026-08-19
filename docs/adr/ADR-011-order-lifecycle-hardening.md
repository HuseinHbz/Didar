# ADR-011 — Order Lifecycle, Fulfillment & Shipping Hardening

**Status**: Accepted
**Phase**: 010 → **011** (`services/api/src/modules/order`)

## Context

Phase 009 built a real, working order/invoice/fulfillment/shipment domain;
Phase 010 extended it additively with an immutable promotion snapshot.
Phase 011 is explicitly **not** a rebuild — its brief is to inspect,
harden, and extend what already exists, closing genuine gaps rather than
introducing a competing implementation. This ADR records what inspection
actually found, what Phase 011 closes, and — just as importantly — what
it deliberately leaves as a documented limitation rather than rushing.

Every decision below follows one rule: reuse the existing domain/
application/infrastructure services; never duplicate payment
verification, inventory reservation, promotion resolution, order
conversion, or RBAC/audit infrastructure.

## Decision 1 — The real bug: fulfillment/shipment status transitions were never row-locked

`PrismaOrderRepository.updateStatus()` (Phase 009) already row-locks
`commerce.orders` (`SELECT ... FOR UPDATE`) before deciding anything —
proven race-safe by Phase 009's own concurrency suite (six concurrent
`cancel()` calls collapsing to one real transition). Inspection of
`PrismaFulfillmentRepository.updateStatus()`/`updateShipmentStatus()`
found the identical class of bug Phase 009 already found and fixed on
`Order`, just never applied one layer down: both methods read the current
status via a separate, unlocked `findById()` call in the _application_
layer (`FulfillmentService`), then write via a separate, unlocked
`prisma.fulfillment.update()`/`prisma.shipment.update()` call — a
textbook check-then-act race. Two truly concurrent `PATCH
.../fulfillments/:id` (or `.../shipments/:id`) requests targeting
different next statuses from the same current one can both pass
`FulfillmentStateMachine`/`ShipmentStateMachine`'s pre-check and both
write, producing two audit-log entries for what should resolve to one
real transition, with the final persisted status decided by write order
rather than the state machine.

**Fixed by applying the exact same technique `PrismaOrderRepository
.updateStatus()` already proved**, not a new one: `SELECT ... FOR UPDATE`
on `commerce.fulfillments`/`commerce.shipments` inside a transaction,
re-checking the state machine against the _locked_ row before writing.
Proven, not assumed — see `test/order-repository.e2e-spec.ts`'s
concurrency section (§26): concurrent fulfillment-status-update and
concurrent shipment-status-update races each collapse to exactly one real
transition.

## Decision 2 — Fulfillment creation gets an idempotency key

`PrismaFulfillmentRepository.create()` already prevents _over_-fulfillment
(row-locked re-sum against `OrderItem.quantity`, Phase 009) but never
prevented a **duplicate** logical fulfillment: a retried "create a
fulfillment for these order items" request that still fits within
remaining capacity would previously create a second, real `Fulfillment`
row — a genuine double-pick risk in a warehouse, not merely a cosmetic
duplicate. `Fulfillment.idempotencyKey` (nullable, `@unique` — Postgres
allows any number of `NULL`s under a plain unique constraint, so this is
additive and never breaks a caller that doesn't supply one) closes this
the same way every other creation path in this codebase already
guarantees idempotency: P2002-catch-and-reread. The admin API accepts an
optional `Idempotency-Key`-style field; when supplied and reused, the
original fulfillment is returned unchanged rather than a second one
being created.

## Decision 3 — Order completion is a derived fact, not an admin button

Inspection found `OrderService.complete()` only asserted
`OrderStateMachine.assertTransition(FULFILLED, COMPLETED)` — and
`Order.status` reaches `FULFILLED` the moment `FulfillmentService
.syncOrderFulfillmentState()` sees enough `FulfillmentItem` **quantity**
to cover every `OrderItem`, which can happen the instant a `Fulfillment`
is _created_, well before it has actually shipped or been delivered.
Nothing previously stopped an admin from completing an order whose goods
had never left the warehouse.

`OrderCompletionValidator` (pure domain service, zero I/O) is the new,
single source of truth for "is this order actually ready to complete":
every non-`CANCELLED` `Fulfillment` for the order must be `DELIVERED`
(not merely quantity-covered), `Order.fulfillmentStatus` must be
`FULFILLED`, and `Order.paymentStatus` must not be `UNPAID`/
`PARTIALLY_PAID` (an order still owed money is never "done"). `complete()`
now calls this validator against the order's real, already-fetched
fulfillment detail before ever asserting the state-machine edge, and
raises a real `OrderNotReadyToCompleteError` (409) — a genuine
server-side rejection, not a soft warning — when any condition fails.

## Decision 4 — Delivery confirmation is its own route, its own permission, its own audit action

`FulfillmentService.updateShipmentStatus()` previously accepted any
legal `ShipmentStatus` transition — including `DELIVERED` — through one
generic `PATCH .../shipments/:id` route gated by `order.shipment.update`.
Delivery is the one shipment event that can gate order completion
(Decision 3) and is explicitly called out by the brief as sensitive
enough to warrant its own boundary. `updateShipmentStatus()` (the generic
route) now structurally rejects `DELIVERED` as a target — it is only
reachable through a new, dedicated `FulfillmentService.confirmDelivery()`
method / `POST .../shipments/:id/deliver` route, gated by a new
`order.shipment.deliver` permission distinct from `order.shipment.update`,
writing a distinct `SHIPMENT_DELIVERED` audit action. This is the same
"floor role can't reach its own more-sensitive action" shape
`fulfillment_clerk`/`warehouse_operator` already established elsewhere in
this codebase, applied to delivery confirmation specifically rather than
left folded into a generic status-update permission.

Internally both routes still funnel through the same row-locked
repository method (Decision 1) — this is a presentation/RBAC-layer
boundary, not a second implementation of shipment-status persistence.

## Decision 5 — Tracking numbers are unique when present, searchable, never client-forged

`Shipment.trackingNumber` already existed (Phase 009, admin-entered via
`ManualShippingProvider`) but carried no uniqueness constraint. Two
admins could accidentally (or an attacker deliberately) enter the same
tracking number against two different shipments, corrupting any future
"look up an order by tracking number" flow. `trackingNumber` is now
`@unique` — Postgres's standard "any number of `NULL`s allowed" behavior
means this is non-breaking for shipments with no tracking number yet. A
new `GET /admin/shipments/by-tracking/:trackingNumber` route (reusing
`order.shipment.read`) makes this a real, searchable capability rather
than a constraint with no consumer. `trackingNumber` remains
admin-entered only — no customer-facing route accepts one, so it can
never be forged by a client the way the brief warns against.

## Decision 6 — Admin order search/filtering is real, database-backed, and newly justified

`OrderListFilter` previously supported only `status` + cursor pagination
— genuinely insufficient for a support/ops admin trying to find "every
`PARTIALLY_PAID` order placed last week for customer X." Extended with
`paymentStatus`, `fulfillmentStatus`, `placedFrom`/`placedTo`, and
`customerId` (admin-only — the customer-facing `list()` path keeps its
own ownership-scoped filter, unchanged), all applied as real Postgres
`WHERE` clauses (`PrismaOrderRepository.list()`), never fetched-then-
filtered in application code. `Order.paymentStatus`/`fulfillmentStatus`/
`placedAt` gain real indexes — justified directly by these new query
patterns, not spec-decoration. Cursor pagination (`id ASC`, the same
stable-ordering shape every other paginated list in this codebase
already uses) is unchanged; `limit` stays capped at 100.

## Decision 7 — `OrderResponseDto` now exposes its promotion snapshot

Phase 010's own final report flagged this explicitly as a known gap:
`commerce.order_promotions` was real and correctly written, but never
surfaced on the customer-facing order read. Since Phase 011 already
touches this exact read surface (Decision 6's filters, Decision 3's
completion detail), closing this one-field gap here is the natural,
low-risk place to do it — `OrderResponseDto.promotions` now maps
`OrderWithDetail`'s (additive) `promotions` array verbatim, the same
immutable snapshot rows Phase 010 already guarantees are never rewritten
by a later refund/cancellation.

## Decision 8 — Inventory restock-on-cancellation: deliberately deferred, not silently dropped

Phase 009's own docs already named this a known, deliberate gap
(`OrderService.cancel()` never restocks). The brief explicitly asks
Phase 011 to decide whether this is the phase to close it. Inspection
found the honest answer is **not yet, not safely**: by the time an
`Order` exists, the inventory that was reserved for its checkout has
already been _converted_ (`ReservationService.convert()`, Phase 007) —
a permanent decrement, not a hold — and nothing in the current schema
retains, at the granularity a correct restock needs, _which specific
warehouse and location_ absorbed that decrement per `OrderItem`. The only
traceable path back is `Order.checkoutSessionId → commerce
.checkout_reservations → InventoryReservation.{warehouseId,locationId}`,
a chain never designed with "reverse this precisely" as a use case, and
a `Fulfillment.warehouseId` (when one exists at all — an order can be
cancelled before any `Fulfillment` is even created) does not reliably
match the _original_ reservation's location once transfers/re-allocation
have happened in between.

Implementing this correctly would mean either guessing a
restock location (silently wrong some of the time — worse than no
restock) or building real new reservation-lineage tracking this phase
never asked for and Phase 006/007 never designed — precisely the "don't
implement a second inventory engine" and "don't fabricate new
abstractions" lines the brief itself draws. This remains an explicit,
documented limitation (§13 of this ADR's own "Consequences" section, and
`docs/architecture/order.md`), not a silent omission — the same
`docs/product/payment.md` "no automatic restock" precedent it already
extends.

## Decision 9 — What is explicitly _not_ touched

Consistent with "do not remove existing functionality merely to
simplify" and "do not recreate Phase 009 from scratch": `OrderStateMachine`/
`FulfillmentStateMachine`/`ShipmentStateMachine`'s own graphs are
unchanged (inspection confirmed they already match the brief's expected
lifecycle exactly); `InvoiceService`'s immutable-after-issue,
void-not-edit model is unchanged; `OrderConversionService`'s
resumable-crash-recovery behavior is unchanged; `ShippingProviderPort`/
`ManualShippingProvider`'s adapter boundary is unchanged (no fake courier
call added); the promotion redemption ledger (Phase 010) is read, never
rewritten. Manual/COD order creation and fulfillment-item quantity
correction remain the same two Phase-009-documented deferred gaps this
phase does not attempt — neither is in this phase's actual brief.

## Consequences

- Two real, previously-undetected concurrency bugs (fulfillment-status
  and shipment-status check-then-act races) are closed using a technique
  already proven in this exact codebase, not a new one.
- Order completion is now a server-derived fact, closing the exact
  "PATCH .../status → COMPLETED" trust gap the brief calls out by name.
- Delivery confirmation gets a real, separately-auditable, separately-
  permissioned boundary.
- Tracking numbers and admin search become genuinely useful (unique,
  searchable, indexed) rather than decorative fields.
- Inventory restock-on-cancellation is deliberately, explicitly deferred
  with a concrete technical reason — not silently dropped, not rushed
  into a second, riskier inventory-mutation pathway.
