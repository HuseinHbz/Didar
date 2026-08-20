# ADR-012 — Returns, Refunds, Credit Notes & Post-Order Adjustments

**Status**: Accepted
**Phase**: 011 → **012** (new `services/api/src/modules/return`, additive
extensions to `services/api/src/modules/payment` and
`services/api/src/modules/inventory`)

## Context

Every phase through 011 explicitly deferred post-delivery returns:
`docs/product/order-fulfillment.md`'s own "Deliberately not built this
phase" list names "Post-delivery returns/RMA/dispute handling" by name,
and ADR-008 decision 6 says outright that "a full promotion/loyalty-aware
refund-and-restock-and-notify workflow is explicitly out of scope —
that's an `Order`-lifecycle concern, Phase 009+." Phase 012 is that
phase. This ADR records what reconnaissance found already in place, what
it reuses unchanged, and every new decision needed to close the gap.

Every decision below follows the same rule every prior hardening ADR in
this repo follows: reuse the existing domain/application/infrastructure
services; never duplicate payment verification, inventory mutation,
promotion resolution, or RBAC/audit infrastructure.

## Reconnaissance summary (what already exists, verified by reading the code)

- **`RefundService`** (`modules/payment/application/refund.service.ts`) is
  the one and only place a `Refund` row is ever created or submitted to a
  provider — `requestRefund()` (validates via `RefundValidator`, creates
  a `PENDING` row, idempotent on a caller-supplied `idempotencyKey`) then
  `processRefund()` (submits to the real provider adapter). `OrderService
  .cancel()`/`.requestPartialRefund()` already call `requestRefund()`
  only — never `processRefund()` — and rely entirely on the existing
  `refund_status_sync` BullMQ sweep to drive a `PENDING` refund forward.
  This is a real, deliberate, already-proven pattern this phase reuses
  verbatim, not a shortcut Phase 012 invents.
- **`Refund`** has no `orderId` and no line-item breakdown — it links only
  to `paymentTransactionId`, with `amount` as a single total.
  `countsAgainstBalance` is a computed entity getter
  (`status !== 'REJECTED' && status !== 'FAILED'`), not a stored column.
- **`RefundController`** exposes `GET .../refunds/:id`, `POST .../refunds`,
  `POST .../refunds/:id/process` — no `GET .../refunds` list route exists
  yet, despite this phase's brief asking for one.
- **No audit logging exists anywhere in `modules/payment`** — a
  documented Phase 008 gap. `OrderService` covers its own two call sites
  (`ORDER_CANCELLED`, `ORDER_REFUND_REQUESTED`) by writing the audit
  entry itself, at the caller, not inside `RefundService`. This phase
  follows the same "caller writes the audit entry" convention rather
  than reaching into Payment to add logging it was never designed for.
- **`OrderItem.lineTotal` is the pre-discount, pre-tax subtotal**
  (`basePrice * quantity`, see `PricingResolver.resolve()`), not the
  amount actually paid for the line. The real amount owed for a line is
  `lineTotal - discountAmount + taxAmount` — both already snapshotted,
  immutable, on `OrderItem` at order-creation time. This is the
  authoritative historical figure Phase 012's refund math uses; it never
  reads `OrderPromotion` for arithmetic, only for the human-readable
  "which promotion caused this" trail (see Decision 4).
- **`InventoryItemRepositoryPort.receiveStock()`** already exists, fully
  implemented (row-locked via `mutateInventoryItem`, writes one
  `PURCHASE_RECEIPT`/`RETURN_RECEIPT` ledger entry, accepts a generic
  `referenceType`/`referenceId`) — but has **zero callers anywhere in the
  codebase**. Its own doc comment calls it "the readiness seam for a
  future ... goods receipt." `InventoryMovementType.RETURN_RECEIPT`
  exists in the schema enum and has never been used. This is exactly the
  primitive Phase 012's restock step needs, unused and waiting — see
  Decision 6.
- **`OrderModule` exports nothing** (`payment.module.ts` already exports
  `PaymentIntentService`/`RefundService`; `inventory.module.ts` exports
  `ReservationService`/`AllocationService`/`StockQueryService`, not
  `AdjustmentService`). Phase 012 needs read access to `OrderService`/
  `InvoiceService` and a restock capability from Inventory — both close
  with small, additive `exports` array changes (Decisions 2, 6), not a
  new cross-module port reach-around.
- **`Setting` (`system.settings`, key/value)** is the established
  config-value mechanism (`cart.max_quantity_per_line`,
  `pricing.default_tax_rate_basis_points`, read via
  `prisma.setting.findUnique` in the application layer with a documented
  fallback constant). Phase 012's return window reuses this, not a new
  config mechanism.
- **Row-locking precedent**: `PrismaOrderRepository.updateStatus()`
  (order status), `PrismaFulfillmentRepository.updateStatus()`/
  `updateShipmentStatus()` (Phase 011), and
  `PrismaFulfillmentRepository`'s `lockAndSumFulfilled()` (over-
  fulfillment) all use `SELECT ... FOR UPDATE` inside `prisma
  .$transaction()`, re-checking the state machine / re-summing against
  the *locked* row before writing. Phase 012 reuses this exact technique
  twice: once for return-status transitions, once for the
  return-quantity invariant (`lockAndSumReturnedQuantity`, the direct
  analogue of `lockAndSumFulfilled`).

## Decision 1 — `ReturnRequest` state machine

Adopted close to the brief's own suggested lifecycle, with one addition
made explicit rather than left implicit:

```
REQUESTED -> APPROVED -> CUSTOMER_SHIPPING -> RECEIVED -> INSPECTING
  -> APPROVED_FOR_REFUND -> REFUNDED -> COMPLETED
```

Terminal: `REJECTED` (reachable from `REQUESTED`/`APPROVED` — an admin
can decline a return before it ever ships back — **and** from
`INSPECTING` — the physical goods didn't match the claimed reason/
condition once actually examined; both are real business outcomes, not
merely a paperwork rejection. Never reachable once `APPROVED_FOR_REFUND`
— once settlement has begun, a `REJECTED` return is a state-machine
contradiction). `CANCELLED` (reachable from `REQUESTED`/`APPROVED`/
`CUSTOMER_SHIPPING` only — the customer's own withdrawal option, gone
once the warehouse has physically received the goods, same "no
cancelling something already in motion" shape `OrderStateMachine` uses
for `CANCELLED` past `PARTIALLY_FULFILLED`).

`CUSTOMER_SHIPPING` is a plain status, not a new shipment sub-entity —
this phase does not build a return-shipment/tracking-number model (no
requirement asked for one beyond the state name itself; a courier
integration for return logistics stays out of scope the same way
`ManualShippingProvider` is the only forward-shipment implementation).

`REFUNDED` means "settlement was triggered" (a `Refund` was requested via
`RefundService`, or a `CreditNote` was issued) — not "money has actually
moved," since (per the reused pattern above) a triggered refund is still
`PENDING` until the sweep processes it. `COMPLETED` is the return's own
derived-fact terminal state, set only once the linked settlement is
actually confirmed done (`Refund.status === 'COMPLETED'` or
`CreditNote.status === 'ISSUED'`) — the same "don't trust a flag, check
the real downstream state" discipline `OrderCompletionValidator`
established in Phase 011, applied here to money instead of delivery. A
new, small `return_settlement_sync` sweep (Decision 8) drives this
transition, since the actual refund confirmation is itself async.

`ReturnStateMachine` (pure domain, `GRAPH` + `isNoOp`/`canTransition`/
`assertTransition`) is a direct structural copy of `OrderStateMachine`'s
own shape — same file layout, same no-op-is-not-an-error convention.

## Decision 2 — `ReturnService` reaches `Order`/`Invoice`/`Fulfillment` through `OrderModule`'s exports, not a new port

`OrderModule` currently exports nothing. Rather than have the new
`ReturnModule` re-bind `ORDER_REPOSITORY`/`INVOICE_REPOSITORY`/
`FULFILLMENT_REPOSITORY` locally (the "avoid a cycle" pattern
`OrderQueueModule` uses only because it _would_ create one importing
`OrderModule` back), `OrderModule` gains an additive
`exports: [OrderService, InvoiceService, FulfillmentService]` — nothing
removed, nothing renamed. `FulfillmentService` is needed alongside the
two originally planned exports because `ReturnEligibilityValidator`
(Decision 3) needs each named `OrderItem`'s real per-item delivered
date, which lives on `Fulfillment.deliveredAt` (via
`FulfillmentService.listByOrder()`'s own `FulfillmentItem` rows), not on
`Order` itself. `ReturnModule` imports `OrderModule` directly, the same
shape `OrderModule` already uses to import `PaymentModule`/
`InventoryModule`. No cycle risk: nothing in `OrderModule` needs to know
`ReturnModule` exists.

## Decision 3 — Return eligibility is checked against real order/fulfillment state, never trusted from the client

`ReturnEligibilityValidator` (pure domain) is given, by the application
layer, exactly the facts it needs and no ability to fetch anything
itself:

- `order.status` must be `FULFILLED` or `COMPLETED` — the goods must have
  actually been delivered (at least one real `Fulfillment.status ===
  'DELIVERED'`; the exact per-item delivered check happens per line, see
  below). A `CANCELLED` order, or one that never got this far, is never
  eligible.
- `order.paymentStatus` must be `PAID` or `PARTIALLY_REFUNDED` — real
  money must have actually settled before any of it can be returned.
- The return window: `deliveredAt` (the returned item's own
  `Fulfillment.deliveredAt`, the real per-item signal — not the order's
  own `completedAt`, since a multi-fulfillment order can have lines
  delivered on different days) plus a configurable
  `returns.window_days` `Setting` (fallback `30`, same
  `prisma.setting.findUnique` + documented-fallback-constant pattern
  `CartPricingService.getMaxQuantityPerLine()` already established) must
  not have passed.
- Every `OrderItem` named in the request must actually belong to the
  order, and its own fulfillment must be `DELIVERED` — a line still
  `PENDING`/`SHIPPED` fulfillment can't be "returned" (nothing was
  delivered to return).

## Decision 4 — Refund/credit-note amounts are computed from `OrderItem`'s own immutable snapshot, never from `OrderPromotion` or the live catalog

`RefundAmountCalculator` (pure domain) computes a per-unit refundable
amount for a line as
`(orderItem.lineTotal - orderItem.discountAmount + orderItem.taxAmount) / orderItem.quantity`,
using the exact same "floor-rounded, deterministic remainder allocation"
family `DiscountCalculator`/`TaxCalculator` already established
elsewhere in this codebase — but applied across *time* (successive
partial returns of the same line) rather than across lines in one call:
the remainder from the floor division is assigned to the first
`remainder` units (by ordinal slot), so summing the refund amount of
every return ever made against one `OrderItem`, in order, always equals
that line's real historical payable amount exactly — no rounding leakage
across multiple partial-return cycles, and no dependence on the order
those returns happen in beyond "earlier slots are consumed first."

`OrderPromotion` (Phase 010's immutable snapshot) is read only for
display/audit purposes on a `ReturnItem`/`RefundLine` — "this refund
reflects a line that had promotion X applied" — never as an input to the
arithmetic itself. This automatically and correctly handles every
promotion type the brief lists (`PERCENTAGE`/`FIXED_AMOUNT`/
`FIXED_PRICE`/`FREE_SHIPPING`/`BUY_X_GET_Y`/`BUNDLE_PRICE`): whatever
effective discount/allocation a promotion produced is already baked into
`OrderItem.discountAmount` by the pricing pipeline at order-creation
time (ADR-010 decision 7/11's own point — the snapshot is copied
verbatim, never recomputed), so `RefundAmountCalculator` never needs to
understand promotion mechanics at all. A later change to (or deletion
of) the live promotion definition cannot retroactively change what a
return refunds, because the calculator never reads the live definition.

**Shipping** (`Order.shippingTotal`) is refunded only when a return
results in the order's *entire remaining deliverable quantity* being
returned (a full-order return) — a partial return of some units never
refunds a share of shipping. This is a real, documented business-rule
choice (common return-policy convention), not an oversight; it is
enforced in the application layer (`ReturnService` sums the order's
still-outstanding, non-cancelled quantity before deciding whether to
include `shippingTotal` in the computed refund), not baked into the pure
per-line calculator.

## Decision 5 — Return-quantity invariant is enforced with a row lock, not a CHECK constraint

Postgres `CHECK` constraints are single-row only — they cannot express
"the sum of `ReturnItem.quantity` across every non-`REJECTED`/
non-`CANCELLED` return against this `orderItemId` must never exceed
`OrderItem.quantity`." The same reasoning that already ruled out a
`CHECK` for over-fulfillment (`docs/architecture/order.md`) applies
here. `PrismaReturnRepository.create()` gains a `lockAndSumReturnedQuantity()`
step, structurally identical to `PrismaFulfillmentRepository
.lockAndSumFulfilled()`: `SELECT ... FOR UPDATE` on the target
`commerce.order_items` row(s) inside the same transaction as the new
`ReturnItem` insert, re-summing every existing non-rejected/
non-cancelled `ReturnItem.quantity` for that `orderItemId`, and asserting
(via `ReturnQuantityValidator`, pure domain) that
`ordered - alreadyReturned + thisRequest <= ordered` before the insert
ever happens. Two truly concurrent return requests against the same
line can never both pass past their combined capacity — proven under
real concurrency (§ Concurrency below), not merely asserted.

## Decision 6 — Inventory restock happens only once, atomically with the transition that marks a return physically accepted, using the existing (unused) `receiveStock()` seam

Unlike Phase 011's cancellation-restock deferral (ADR-011 decision 8 —
still unresolved and *not* touched by this phase; see Decision 10), a
return's restock destination is never a guess: the receiving warehouse/
location is real, present-tense operational data the admin/warehouse
operator enters at the moment goods physically arrive (`POST
.../returns/:id/receive` captures `warehouseId`/`locationId`), the same
way `AdjustmentController`/`FulfillmentAdminController.create()` already
require an explicit `warehouseId` rather than inferring one. There is no
lineage-tracing problem to solve.

Restocking is triggered **exactly once**, atomically with the
`INSPECTING -> APPROVED_FOR_REFUND` transition (the moment a return is
accepted after inspection) — never at `REQUESTED`, never at `RECEIVED`
before inspection, and never as a separately-invoked admin action a
click could be forgotten on. A rejected return (inspection fails, or the
whole request is `REJECTED`) never restocks. This closes the brief's own
"do not automatically restock when a return is merely REQUESTED" /
"rejected returns must NOT increase available inventory" requirements
structurally, not by convention.

Mechanically: `AdjustmentService` (inventory module) gains one new
method, `receiveReturnedStock()` — a thin wrapper around the existing,
previously-uncalled `InventoryItemRepositoryPort.receiveStock()`
(`movementType: 'RETURN_RECEIPT'`, `referenceType: 'ReturnRequest'`,
`referenceId: returnRequestId`), writing the same `INVENTORY_ADJUSTED`-
shaped audit entry `AdjustmentService.create()` already writes for
manual corrections. `InventoryModule` gains `AdjustmentService` in its
`exports` array (previously absent).

`ReturnService.approveForRefund()` calls `returnRepository.updateStatus()`
(`INSPECTING -> APPROVED_FOR_REFUND`) *first*, and only proceeds to
restock — once per accepted `ReturnItem` — when that call reports
`transitioned: true`. This is deliberately **not** one cross-module
database transaction: nothing elsewhere in this codebase opens a shared
Postgres transaction across module boundaries either (`OrderService
.cancel()` calling `orderRepository.updateStatus()` then `refundService
.requestRefund()` is the exact same two-separate-calls shape). What the
gate on `transitioned: true` actually buys is the real property this
phase's brief asks for: **concurrency**-safety — two simultaneous
`approveForRefund()` calls on the same return can never both restock,
because only the transaction that actually wins the row lock and flips
the status sees `transitioned: true`; the loser sees `false` and skips
restocking entirely, the same "skip side-effects on a losing racer"
rule `FulfillmentService` already established. A process crash between
the status write committing and the restock call completing is a
different, narrower risk — a genuine known limitation, not silently
swallowed (see Decision 10): the return is left `APPROVED_FOR_REFUND`
with an incompletely-restocked set of items, recoverable only by a
manual admin follow-up today, the same category of gap the existing
`invoice_generation`/`order_conversion` sweeps exist to close for their
own two-step crash windows — a future `return_restock_sync` sweep would
be the equivalent fix here, deliberately left out of this phase's scope.

Idempotency: retrying `approveForRefund()` on an already-`APPROVED_FOR_
REFUND` return is a no-op via `ReturnStateMachine.isNoOp` — the restock
call is never reachable a second time for the same return, so no
separate idempotency key is needed for the restock step itself (proven
under concurrency, § Concurrency below).

## Decision 7 — Credit notes: a real, minimal lifecycle, never a historical-invoice rewrite

```
DRAFT -> ISSUED -> APPLIED
DRAFT -> VOID
ISSUED -> VOID
```

`CreditNoteStateMachine` mirrors `InvoiceStateMachine`'s own shape.
`CreditNote.creditNoteNumber` is server-generated from a new
`finance.credit_note_number_seq` Postgres sequence, drawn inside the
same transaction as the insert — identical technique to
`commerce.order_number_seq`/`finance.invoice_number_seq`, never an
application-memory counter, never client-supplied. `CreditNote`
references `orderId` (unenforced cross-schema pointer, same convention
`Invoice.orderId` already uses), `returnRequestId` (unenforced —
`commerce`, same schema as `Invoice`'s own unenforced `orderId` pointer
for consistency, even though a *real* FK would be possible here; kept
unenforced to match every other `finance -> commerce` pointer in this
schema rather than making this one row special) and `invoiceId` (a
**real, enforced FK** — both rows live in `finance`). A `DRAFT`
`CreditNote` — its `creditNoteNumber` already drawn, per above — is
created automatically inside `ReturnService.approveForRefund()` when the
return's `resolution` is `CREDIT_NOTE` (never a separate manual "create
an ad-hoc credit note" endpoint this phase doesn't otherwise need);
`issue()` afterwards is a pure `DRAFT -> ISSUED` state transition, no
further number generation involved. `Invoice` itself is never mutated —
no column on `Invoice` changes when a `CreditNote` is issued against it;
the two rows together represent the adjustment, exactly as the brief
requires.

## Decision 8 — `Refund`/`RefundLine`: an additive extension to the existing aggregate, not a parallel table

`Refund` gains two new, fully optional/nullable fields: `returnRequestId`
(a real FK — both in `commerce`) and a new child table `RefundLine`
(`refundId` FK, `returnItemId` FK, `amount`) — the per-`ReturnItem`
breakdown of one `Refund`'s total `amount`, the same "child entity, no
independent lifecycle" shape `OrderItem`/`FulfillmentItem` already use.
`RefundRepositoryPort.create()` gains two new optional parameters
(`returnRequestId?`, `lines?: { returnItemId; amount }[]`), written in
the same transaction as the `Refund` insert. Every existing caller
(`OrderService.cancel()`/`.requestPartialRefund()`) simply omits them —
this is additive, not a breaking signature change, and `RefundService`
itself gains no new business logic: it still only ever validates via
`RefundValidator` and creates one row via the same P2002-catch-and-
reread idempotency path. **There remains exactly one refund pathway.**
`ReturnService` never calls a payment provider adapter directly and
never bypasses `RefundValidator`.

A new `return_settlement_sync` sweep, added because the existing pattern
already needs a caller now (Decision 1's `REFUNDED -> COMPLETED` step):
every `ReturnRequest` still `REFUNDED` whose linked `Refund.status` has
reached `COMPLETED` (or `CreditNote.status === 'ISSUED'` for a credit-
note resolution) is driven to `COMPLETED`. A `Refund` that resolves to
`FAILED`/`REJECTED` leaves its `ReturnRequest` at `REFUNDED` with a
logged warning for admin follow-up — no automatic retry-forever loop;
documented as a known limitation, not silently swallowed.

## Decision 9 — Idempotency, scoped to where a retry can actually cause financial or inventory duplication

Following the brief's own instruction not to sprinkle idempotency keys
everywhere:

- **Create return request** — client-suppliable `idempotencyKey`
  (optional, `@unique`, same P2002-catch-and-reread pattern
  `Fulfillment.idempotencyKey` established in Phase 011) — a genuine
  retry risk (a flaky customer-facing submit button).
- **Return status transitions** (approve/reject/receive/inspect/
  approve-for-refund) — no separate key needed: `ReturnStateMachine
  .isNoOp` plus the row lock already makes a retried identical call a
  safe no-op, the same reasoning `FulfillmentService`'s Phase 011
  transitions already rely on.
- **Refund creation** — reuses `Refund.idempotencyKey` (already
  `@unique` since Phase 008), keyed deterministically as
  `return-refund__${returnRequestId}`, the same deterministic-key
  convention `OrderService` already uses
  (`order-cancel__${orderId}`, `order-partial-refund__${orderId}__${amount}`).
- **Credit note issuance** — no separate key: the `DRAFT` row (and its
  real, sequence-drawn `creditNoteNumber` — drawn at insert time, same
  as `Invoice.invoiceNumber`, not deferred to a later transition) is
  only ever created once, structurally guarded by the same
  `APPROVED_FOR_REFUND -> REFUNDED` row lock Decision 6 already relies
  on for the restock step; `CreditNoteStateMachine.isNoOp` then makes
  any retried `DRAFT -> ISSUED` call a safe no-op on top.
- **Inventory restock** — no separate key: covered structurally by
  Decision 6 (unreachable a second time once `APPROVED_FOR_REFUND`).

## Decision 10 — What is explicitly _not_ touched

`OrderStateMachine`/`FulfillmentStateMachine`/`ShipmentStateMachine`/
`InvoiceStateMachine` are unchanged. `RefundValidator`/
`RefundStateMachine` are unchanged (only additively extended per
Decision 8). `OrderService.cancel()`/`.requestPartialRefund()` are
unchanged — a cancelled/partially-refunded order still goes through
exactly the code Phase 009/011 already proved. **Inventory
restock-on-cancellation remains deferred**, unchanged from ADR-011
decision 8 — this phase's return-restock capability (Decision 6) solves
a structurally different, better-defined problem (a real physical
receiving event with an explicit destination) and does not, and cannot,
retroactively solve the cancellation-restock lineage-tracing gap. The
promotion redemption ledger (Phase 010) is read only for display, never
rewritten or re-resolved (Decision 4).

## RBAC

New permission module `return`: `return.read`, `return.approve`,
`return.reject`, `return.receive`, `return.inspect`, `return.refund`
(gates both `.../approve-refund` and `.../refund` — two routes, one
permission, same shape `order.shipment.deliver` being its own dedicated
permission does *not* preclude two routes sharing one grant elsewhere in
this schema). New permission module `credit_note`: `credit_note.read`,
`credit_note.issue`, `credit_note.void`. `return.cancel`/
`credit_note.create`/`inventory.restock.return` are **not** created —
no route consumes them (customer cancellation is ownership-gated, not
RBAC; a credit note is only ever created as a side effect of
`return.refund`; restock has no standalone route per Decision 6) — the
brief's own rule 9 ("do not create permissions without actual
consumers").

Two new roles: `returns_manager` (every `return.*`/`credit_note.*`
permission — the department-head shape `order_manager` established) and
`returns_clerk` (`return.read`, `return.receive`, `return.inspect` only —
the warehouse-floor shape `fulfillment_clerk` established: can handle
the physical intake and inspection, cannot approve, reject, trigger a
refund, or touch a credit note). `finance_auditor` gains
`credit_note.read` alongside its existing `refund.read`/
`reconciliation.read` — the same read-only financial-visibility role,
naturally extended.

## Consequences

- A real, transactionally-safe return/refund/credit-note subsystem
  closes the gap every phase from 008 onward explicitly deferred.
- Exactly one refund pathway still exists in this codebase — extended,
  never duplicated.
- Inventory restock-on-return is real and safe; restock-on-cancellation
  remains a documented, deliberate gap, now more clearly distinguished
  from (not conflated with) the returns case.
- Historical invoices remain immutable; a credit note is always an
  addition, never a rewrite.
- A `Refund` that fails/is rejected after a return already triggered it
  requires manual admin follow-up — no automatic retry loop. Documented,
  not hidden.
