# Returns, refunds, and credit-note architecture (Phase 012)

Full design rationale: [`docs/adr/ADR-012-returns-refunds-credit-notes.md`](../adr/ADR-012-returns-refunds-credit-notes.md).
Full layering/scope detail: [`services/api/src/modules/return/README.md`](../../services/api/src/modules/return/README.md).
This document is the short "where does returns fit in the system" view —
read it alongside [`docs/architecture/README.md`](README.md), which it
extends rather than replaces.

## Where it sits

```
storefront / admin / pwa / mobile
                │
        services/api (NestJS)
                │
        modules/return              ← Phase 012, this document
   (domain → application → infrastructure/presentation)
        │              │              │
     order          payment       inventory
  (OrderService,  (RefundService)  (AdjustmentService
   InvoiceService,                  .receiveReturnedStock())
   FulfillmentService)
        │
   BullMQ queue (in-process — return_settlement_sync)
        │
   packages/database (Prisma)      Redis (queue only — never
        │                           authoritative for return state)
   PostgreSQL
   commerce schema (return_requests/return_items/return_status_history,
   refunds extended + refund_lines), finance schema (credit_notes/
   credit_note_lines)
```

Same shape every other domain module in `services/api` follows — the
seventh full clean-architecture example after `modules/identity`,
`modules/catalog`, `modules/inventory`, `modules/cart-checkout`,
`modules/payment`, and `modules/order`. It does not import `OrderModule`
back into itself the way `OrderModule` composes four prior modules —
instead `OrderModule` gains an additive `exports` array
(`OrderService`, `InvoiceService`, `FulfillmentService`), and
`ReturnModule` imports `OrderModule` directly, the same shape
`OrderModule` already uses to import `PaymentModule`/`InventoryModule`.
No new cross-module port reach-around, and no cycle risk — nothing in
`OrderModule` needs to know `ReturnModule` exists.

## A return is checked against real fulfillment/delivery state, never trusted from the client

`ReturnEligibilityValidator` (pure domain) is handed exactly the facts
it needs — order status, order payment status, and each named
`OrderItem`'s real `Fulfillment.deliveredAt` (fetched via
`FulfillmentService.listByOrder()`, not `Order` itself, since a
multi-fulfillment order can have lines delivered on different days) —
and can fetch nothing itself. A line still `PENDING`/`SHIPPED`
fulfillment, an order not yet `FULFILLED`/`COMPLETED`, unsettled
payment, or a return window that has already passed (a configurable
`returns.window_days` `Setting`, fallback 30, same
`prisma.setting.findUnique` + documented-fallback-constant pattern
`CartPricingService` established) are all real, structural rejections —
never a client-supplied flag the caller could forge.

## Refund/credit-note amounts always trace back to the order's own immutable snapshot

`RefundAmountCalculator` (pure domain) computes a per-unit refundable
amount for a line as `(lineTotal - discountAmount + taxAmount) / quantity`
— `OrderItem`'s own snapshot fields, frozen at order-creation time,
never `OrderPromotion` or the live catalog. The same "floor-rounded,
deterministic remainder allocation" family `DiscountCalculator`/
`TaxCalculator` already established elsewhere in this codebase is
applied here across _time_ (successive partial returns of the same
line) rather than across sibling lines in one call — summing the
refund amount of every return ever made against one `OrderItem`, in
order, always equals that line's real historical payable amount
exactly. A later change to (or deletion of) a live promotion definition
cannot retroactively change what a return refunds, because the
calculator never reads it. Shipping is refunded only when a return
covers the order's entire remaining deliverable quantity (a full-order
return) — a documented business-rule choice, enforced in
`ReturnService`, not baked into the pure per-line calculator.

## PostgreSQL is the single source of truth; two real invariants are enforced with row locks, not application trust

- **Return-quantity invariant** (`PrismaReturnRepository`'s
  `lockAndSumReturnedQuantity()`) — `SELECT ... FOR UPDATE` on the
  target `OrderItem` row(s) inside the same transaction as the new
  `ReturnItem` insert, re-summing every existing non-`REJECTED`/
  non-`CANCELLED` `ReturnItem.quantity` for that line before asserting
  (`ReturnQuantityValidator`) the new request still fits. The direct
  structural analogue of Phase 009's `lockAndSumFulfilled()` for
  over-fulfillment — Postgres `CHECK` constraints are single-row only
  and cannot express this cross-row sum. Two truly concurrent return
  requests against the same line can never both pass past their
  combined capacity.
- **Return/credit-note status transitions** (`PrismaReturnRepository
.updateStatus()`, `PrismaCreditNoteRepository.updateStatus()`) — the
  same `SELECT ... FOR UPDATE` + re-check-the-state-machine-against-the-
  locked-row technique `PrismaOrderRepository`/`PrismaFulfillmentRepository`
  already proved in Phases 009/011, returning `StatusUpdateResult<T> =
{ entity: T; transitioned: boolean }` so callers can skip audit
  logging and side effects on a race that resolved to a no-op.

Redis is used **only** for the `return_settlement_sync` sweep queue,
never to answer "does this return exist" — every such read goes to
Postgres.

## Inventory restock happens exactly once, gated on a real state transition, never on a mere request

Unlike Phase 011's still-unresolved cancellation-restock deferral,
restock-on-return has a real, present-tense destination: the admin/
warehouse operator enters `warehouseId`/`locationId` at the moment goods
physically arrive (`POST .../returns/:id/receive`), the same way
`AdjustmentController`/`FulfillmentAdminController.create()` already
require an explicit warehouse rather than inferring one.

`ReturnService.approveForRefund()` calls `returnRepository
.updateStatus()` (`INSPECTING -> APPROVED_FOR_REFUND`) _first_, and only
restocks — via the new `AdjustmentService.receiveReturnedStock()`, a
thin wrapper around the previously-uncalled
`InventoryItemRepositoryPort.receiveStock()` primitive — when that call
reports `transitioned: true`, and only for conditions judged resalable
(`UNOPENED`/`OPENED_UNUSED`). A rejected return, or a return still only
`REQUESTED`/`RECEIVED`, never restocks. This is deliberately **not** one
cross-module database transaction — nothing else in this codebase opens
a shared Postgres transaction across module boundaries either
(`OrderService.cancel()` calling `orderRepository.updateStatus()` then
`refundService.requestRefund()` is the exact same two-separate-calls
shape). What the `transitioned: true` gate actually buys is
concurrency-safety: two simultaneous `approveForRefund()` calls on the
same return can never both restock, because only the transaction that
wins the row lock sees `transitioned: true` — proven at the repository
layer, not merely asserted (see "Concurrency" below). A process crash
between the status write committing and the restock call completing is
a documented, known, narrower limitation — the same category of gap the
existing `invoice_generation`/`order_conversion` sweeps exist to close
for their own two-step crash windows; a future `return_restock_sync`
sweep would be the equivalent fix here, deliberately out of this
phase's scope.

## Credit notes: a real, minimal lifecycle, never a historical-invoice rewrite

`CreditNoteStateMachine` mirrors `InvoiceStateMachine`'s own shape
(`DRAFT -> ISSUED -> APPLIED`, `VOID` from `DRAFT`/`ISSUED`).
`CreditNote.creditNoteNumber` is server-generated from a real Postgres
sequence (`finance.credit_note_number_seq`), drawn inside the same
transaction as the insert — identical technique to `order_number_seq`/
`invoice_number_seq`, never an application-memory counter, never
client-supplied. A `DRAFT` `CreditNote` is created automatically inside
`ReturnService.approveForRefund()` when the return's `resolution` is
`CREDIT_NOTE` — there is no separate manual "create an ad-hoc credit
note" endpoint. `Invoice` itself is never mutated — no column on
`Invoice` changes when a `CreditNote` is issued against it; the two rows
together represent the adjustment.

## `Refund`/`RefundLine`: an additive extension, exactly one refund pathway still exists

`Refund` gains two new, fully optional fields — `returnRequestId` and a
new child table `RefundLine` (the per-`ReturnItem` breakdown of one
refund's total amount). `RefundService` itself gains no new business
logic: it still only ever validates via `RefundValidator` and creates
one row via the same P2002-catch-and-reread idempotency path, keyed
deterministically as `return-refund__${returnRequestId}` — the same
deterministic-key convention `OrderService` already established
(`order-cancel__${orderId}`). `ReturnService` never calls a payment
provider adapter directly and never bypasses `RefundValidator`. A new
`return_settlement_sync` BullMQ sweep drives a `REFUNDED` return to
`COMPLETED` once its linked `Refund` actually reaches `COMPLETED` (or
its `CreditNote` reaches `ISSUED`) — the same "don't trust a flag, check
the real downstream state" discipline `OrderCompletionValidator`
established in Phase 011, applied here to money instead of delivery.

## What changed outside `modules/return` itself

- **`packages/database/prisma/schema.prisma`** — purely additive: 4 new
  enums, 3 new tables in `commerce` (`return_requests`/`return_items`/
  `return_status_history`), a nullable, real-FK `return_request_id`
  column on `commerce.refunds` plus a new `commerce.refund_lines` child
  table, and 2 new tables in `finance` (`credit_notes`/
  `credit_note_lines`) — see `docs/database/return-erd.md`.
- **`packages/types`** — new branded IDs and enum unions for
  `ReturnRequest`/`ReturnItem`/`CreditNote`/`RefundLine`.
- **`services/api/app.module.ts`** — registers `ReturnModule`.
- **`services/api/src/modules/order/order.module.ts`** — additive
  `exports: [OrderService, InvoiceService, FulfillmentService]` (this
  module had no `exports` array before).
- **`services/api/src/modules/payment/application/refund.service.ts`**
  — `requestRefund()` gains optional `returnRequestId`/`lines`
  parameters (additive, not a breaking signature change — every
  existing caller simply omits them); a new `list()` method closing a
  reconnaissance-flagged gap (`GET .../refunds` never existed despite
  this phase's brief asking for one).
- **`services/api/src/modules/inventory/application/adjustment.service.ts`**
  — new `receiveReturnedStock()`, wrapping the existing, previously-
  uncalled `receiveStock()` primitive.
- **`services/api/src/modules/inventory/inventory.module.ts`** —
  additive `exports: [..., AdjustmentService]`.
- **RBAC data** — 9 new `return.*`/`credit_note.*` permissions, two new
  roles (`returns_manager`, `returns_clerk`) — see
  `docs/security/returns-security.md`.

Nothing in `modules/order`'s, `modules/payment`'s, or `modules/inventory`'s
own existing behavior changed beyond these additive hooks — verified by
re-running every prior phase's own e2e suite unchanged (169 tests across
the other 11 spec files, all still passing after this phase's changes).

## Frontend: deliberately not built this phase

Same precedent every prior backend phase set — no storefront/admin UI
for initiating or managing a return exists yet; this phase is the API
surface only.

## Known, deliberate gaps

- **No inventory restock on cancellation.** Unchanged from ADR-011
  decision 8 — this phase's restock-on-return capability solves a
  structurally different, better-defined problem (a real physical
  receiving event with an explicit destination) and does not, and
  cannot, retroactively solve the cancellation-restock lineage-tracing
  gap.
- **No return-shipment/tracking-number sub-model.** `CUSTOMER_SHIPPING`
  is a plain status, not a new shipment entity — no courier integration
  for return logistics this phase, the same way `ManualShippingProvider`
  is the only forward-shipment implementation.
- **A `Refund` that fails/is rejected after a return already triggered
  it requires manual admin follow-up.** No automatic retry-forever loop
  — the `return_settlement_sync` sweep logs a warning and leaves the
  return at `REFUNDED` for admin visibility, the same "documented, not
  hidden" posture every prior phase's own sweep gaps use.
- **A crash between the `APPROVED_FOR_REFUND` transition committing and
  the restock call completing** leaves the return correctly transitioned
  but an item's stock not yet received — recoverable only by manual
  admin follow-up today. See "Inventory restock" above.

## Concurrency, proven not assumed

The mandatory concurrency suite
(`services/api/test/return-repository.e2e-spec.ts`, hybrid pattern —
full app booted for HTTP-driven setup: guest checkout -> payment ->
order -> fulfillment -> delivery; the actual racy calls bypass HTTP and
`ReturnService` entirely, hitting `PrismaReturnRepository`/
`PrismaCreditNoteRepository`/`PrismaRefundRepository` directly, same
precedent `test/order-repository.e2e-spec.ts` established) proved all
six required races, not merely declared them safe on paper:

1. **Return-quantity invariant** — 4 concurrent 3-unit return requests
   against a 10-unit line: capacity admits exactly 3 (sum 9), the 4th
   is always rejected, deterministically, regardless of which specific
   call wins the race.
2. **Return-creation idempotency** — 15 concurrent `create()` calls
   sharing one `idempotencyKey` collapse to exactly one real
   `ReturnRequest` row.
3. **Return-approval races** — 20 concurrent `approve()` calls collapse
   to exactly one real transition.
4. **The restock gate** — 20 concurrent approve-for-refund calls
   collapse to exactly one real transition, the exact gate
   `ReturnService.approveForRefund()` relies on to call
   `receiveReturnedStock()` at most once.
5. **Refund double-creation** — 10 concurrent `Refund.create()` calls
   with the same deterministic `return-refund__${id}` key collapse to
   exactly one real `Refund` row.
6. **Credit-note issuance** — 20 concurrent `DRAFT -> ISSUED` calls on
   the same note collapse to exactly one real transition.

Plus: a transition no longer legal once the lock is held throws a real
409-shaped conflict, not a silent no-op; a single over-limit return
request is rejected outright (non-concurrent control case). Ran twice
consecutively against real PostgreSQL to rule out flakiness: 8/8 both
times. The pre-existing `order-repository.e2e-spec.ts` suite (5 tests)
still passes unmodified — no pollution.
