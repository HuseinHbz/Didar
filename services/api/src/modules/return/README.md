# modules/return

Phase 012's clean-architecture module for returns, refunds, and credit
notes: the post-delivery lifecycle every phase from 008 onward
explicitly deferred. Phase 013 extends it with a durable settlement
state machine, crash recovery, and reconciliation — see the "Phase 013"
section below. Same layering convention every prior module established:

```
return/
├── domain/
│   ├── entities/    — plain TS classes: ReturnRequest, ReturnItem,
│   │                  ReturnStatusHistory, CreditNote, CreditNoteLine,
│   │                  ReturnSettlement (Phase 013). No Prisma/NestJS
│   │                  dependency.
│   ├── ports/       — ReturnRepositoryPort (aggregate root over items/
│   │                  history), CreditNoteRepositoryPort,
│   │                  ReturnSettlementRepositoryPort (Phase 013) — same
│   │                  "child entities, no independent lifecycle"
│   │                  reasoning OrderRepositoryPort uses.
│   └── services/    — pure business logic, zero I/O, unit-tested without
│                      a database (76 tests across 8 spec files):
│                        ReturnStateMachine          — REQUESTED -> ... ->
│                                                       {REJECTED|CANCELLED|
│                                                        COMPLETED}
│                        ReturnQuantityValidator      — ordered - alreadyReturned
│                                                        >= requested
│                        RefundAmountCalculator       — per-unit refund amount
│                                                        from OrderItem's own
│                                                        immutable snapshot
│                        ReturnEligibilityValidator   — order/payment status,
│                                                        per-item delivery,
│                                                        return window
│                        CreditNoteStateMachine        — DRAFT -> ISSUED ->
│                                                         APPLIED, VOID
│                        CreditNoteValidator           — line-sum/grand-total/
│                                                         refundable-ceiling
│                                                         consistency
│                        ReturnSettlementStateMachine  — Phase 013, see below
│                        ReturnSettlementInvariants    — Phase 013, see below
├── application/     — ReturnService, CreditNoteService,
│                      ReturnSettlementService, ReturnReconciliationService
│                      (Phase 013).
├── infrastructure/
│   ├── repositories/   — PrismaReturnRepository, PrismaCreditNoteRepository,
│   │                      PrismaReturnSettlementRepository (Phase 013).
│   ├── return.mapper.ts — Prisma-row -> domain-entity mappers.
│   └── queues/          — BullMQ producers/consumers (see "Queues").
└── presentation/
    ├── controllers/  — ReturnController (/returns/*),
    │                   ReturnAdminController (/admin/returns/*),
    │                   CreditNoteAdminController (/admin/credit-notes/*),
    │                   ReturnSettlementAdminController (Phase 013).
    ├── dto/           — request/response DTOs, class-validator + @nestjs/swagger.
    └── filters/       — ReturnDomainExceptionFilter.
```

Dependency direction is one-way:
`presentation → application → domain ← infrastructure`, verified the same
way every prior module's is — `domain/services/*.spec.ts` unit-tests the
pure logic with zero DB, zero NestJS test module, zero mocks.

Full design rationale for every non-obvious decision below:
[`docs/adr/ADR-012-returns-refunds-credit-notes.md`](../../../../../docs/adr/ADR-012-returns-refunds-credit-notes.md).

## `ReturnService` reaches `Order`/`Invoice`/`Fulfillment` through `OrderModule`'s exports, not a new port

`OrderModule` gained an additive `exports: [OrderService, InvoiceService,
FulfillmentService]` (previously exported nothing) rather than have this
module re-bind `ORDER_REPOSITORY`/`INVOICE_REPOSITORY`/
`FULFILLMENT_REPOSITORY` locally. `FulfillmentService` is needed
alongside the other two because `ReturnEligibilityValidator` needs each
named `OrderItem`'s real per-item delivered date, which lives on
`Fulfillment.deliveredAt`, not on `Order` itself. `ReturnModule` imports
`OrderModule` directly — the same shape `OrderModule` already uses to
import `PaymentModule`/`InventoryModule`. No cycle risk: nothing in
`OrderModule` needs to know `ReturnModule` exists.

## Eligibility is checked against real fulfillment/delivery state, never trusted from the client

`ReturnEligibilityValidator.assertEligible()` is handed exactly the
facts it needs (order status/payment status, each named item's real
`deliveredAt`, the configurable return window) and can fetch nothing
itself. `ReturnService.create()` gathers those facts via
`OrderService.get()`/`FulfillmentService.listByOrder()` before ever
calling `returnRepository.create()`.

## Refund/credit-note amounts always trace back to `OrderItem`'s own immutable snapshot

`RefundAmountCalculator.amountForReturnedUnits()` computes a per-unit
refundable amount as `(lineTotal - discountAmount + taxAmount) /
quantity`, applying a deterministic floor-rounded remainder allocation
across _time_ (successive partial returns of the same line) so that
summing every return ever made against one `OrderItem` always equals
that line's real historical payable amount exactly — never
`OrderPromotion` or the live catalog. Computed and stored on
`ReturnItem.refundAmount` at `inspect()`, independent of the later
accept/reject decision.

## Two real invariants enforced with row locks, not application trust

- **Return-quantity invariant** (`PrismaReturnRepository`'s
  `lockAndSumReturnedQuantity()`) — row-locks the target `OrderItem`
  (`SELECT ... FOR UPDATE`) and re-sums already-returned quantity across
  every non-`REJECTED`/non-`CANCELLED` return inside the same
  transaction as the new `ReturnItem` insert. Direct structural
  analogue of `PrismaFulfillmentRepository.lockAndSumFulfilled()`.
- **Return/credit-note status transitions** (`PrismaReturnRepository`/
  `PrismaCreditNoteRepository`'s `updateStatus()`) — row-lock the target
  row and re-check the state machine against the _locked_ row before
  writing, returning `StatusUpdateResult<T> = { entity: T; transitioned:
boolean }` so callers can skip audit-logging and side effects on a
  race that resolved to a no-op.

## Inventory restock: exactly once, gated on a real transition

`ReturnService.approveForRefund()` calls `returnRepository
.updateStatus()` (`INSPECTING -> APPROVED_FOR_REFUND`) _first_, and
only calls the new `AdjustmentService.receiveReturnedStock()` — a thin
wrapper around the previously-uncalled `InventoryItemRepositoryPort
.receiveStock()` primitive — when that call reports `transitioned:
true`, and only for `RESTOCKABLE_CONDITIONS = ['UNOPENED',
'OPENED_UNUSED']`. Deliberately **not** one cross-module database
transaction — see the ADR's Decision 6 for the full reasoning and the
documented crash-window limitation.

## Credit notes: real, minimal, never a historical-invoice rewrite

A `DRAFT` `CreditNote` (its `creditNoteNumber` already drawn from
`finance.credit_note_number_seq`) is created automatically inside
`approveForRefund()` when the return's `resolution` is `CREDIT_NOTE`.
`refund()` then issues it (`DRAFT -> ISSUED`) as part of the same call
that would otherwise request a real `Refund` — `Invoice` itself is
never mutated.

## Settlement creation happens before the status transition, for crash-safety

`ReturnService.refund()` creates the settlement first (`RefundService
.requestRefund()` with a deterministic `return-refund__${id}`
idempotency key, or `CreditNoteService.issue()`) and only then
transitions the return to `REFUNDED`. Both settlement-creation paths are
safely retryable regardless of which step a crash interrupted:
`Refund.idempotencyKey` makes re-creation harmless,
`CreditNoteStateMachine.isNoOp` makes re-issuance harmless.

## Queues

Three BullMQ queues, registered in-process inside `services/api` via
`infrastructure/queues/return-queue.module.ts`:

- **`return_settlement_sync`** (Phase 012) — periodically: every
  `ReturnRequest` still `REFUNDED` whose linked `Refund.status` has
  reached `COMPLETED` (or `CreditNote.status === 'ISSUED'` for a
  credit-note resolution) is driven to `COMPLETED`. A `Refund` that
  resolves to `FAILED`/`REJECTED` leaves its `ReturnRequest` at
  `REFUNDED` with a logged warning for admin follow-up — no automatic
  retry-forever loop. **Phase 013 addition**: also completes the linked
  `ReturnSettlement` row (`SETTLED -> COMPLETED`) at the same moment —
  nothing else in the codebase ever did before this fix, since
  `ReturnSettlementService.requestSettlement()` only ever reaches
  `SETTLED` by design.
- **`return_settlement_recovery`** (Phase 013, 2 minute cadence) —
  every active (`PENDING_RESTOCK`/`REFUND_REQUESTED`) settlement is
  re-driven through `ReturnSettlementService.beginRestock()`/
  `.requestSettlement()`, the exact same idempotent methods the
  synchronous admin HTTP path calls.
- **`return_reconciliation`** (Phase 013, 10 minute cadence) —
  `ReturnReconciliationService.reconcileAll()`, see below.

Cannot import `ReturnModule` (would create a cycle), so it re-declares
its own repository-port bindings and application services as fresh
instances, same precedent `OrderQueueModule`/`PaymentQueueModule`
already established. Imports `OrderModule`/`PaymentModule`/
`InventoryModule` directly (the same three `ReturnModule` itself
imports) since `ReturnSettlementService` needs the identical dependency
graph here as in the synchronous path.

## Phase 013 — settlement recovery & reconciliation

Full design rationale: [`docs/adr/ADR-013-return-settlement-reconciliation.md`](../../../../../docs/adr/ADR-013-return-settlement-reconciliation.md).
Architecture overview: [`docs/architecture/returns.md`](../../../../../docs/architecture/returns.md)'s
own Phase 013 section. Security: [`docs/security/returns-security.md`](../../../../../docs/security/returns-security.md)'s
own Phase 013 section.

**`ReturnSettlementService`** — the one durable orchestration layer:
`ensureSettlement()`/`beginRestock()`/`requestSettlement()`/`retry()`,
every method idempotent, callable any number of times from the
synchronous admin path or any sweep. `beginRestock()` restocks every
eligible `ReturnItem` (guarded by `restocked_at` plus the underlying
`InventoryLedger.idempotencyKey` unique constraint) and drafts a
`CreditNote` for a `CREDIT_NOTE`-resolution return before transitioning
`PENDING_RESTOCK -> RESTOCKED`. `requestSettlement()` requests the real
`Refund`/issues the `CreditNote`, claims `Order.refundedTotal` update
via a single atomic `UPDATE ... WHERE refund_recorded_at IS NULL`
(closing a genuine double-counting bug found by this phase's own
reconnaissance), and transitions `REFUND_REQUESTED -> SETTLED`. A
premature call is rejected as a real `409` _before_ the method's own
try/catch, so a legitimate "not ready yet" business state is never
misclassified as a settlement failure.

**`ReturnReconciliationService`** — four ordered, read-heavy passes
(missing-settlement backfill, active-settlement re-drive,
stuck-settlement escalation to `MANUAL_REVIEW`, duplicate-refund/
credit-note detection), calling only the same idempotent methods above
— never a distinct repair code path. One audit-log entry per non-empty
run.

## Deliberately out of scope

Same list as [`docs/product/returns-refunds.md`](../../../../../docs/product/returns-refunds.md)
and the ADRs' own "deliberately deferred" sections:

- Inventory restock on cancellation — unchanged from ADR-011 decision 8,
  a structurally different, better-defined problem than this module's
  own restock-on-return.
- A return-shipment/tracking-number sub-model — `CUSTOMER_SHIPPING` is a
  plain status, no courier integration for return logistics.
- Automatic retry of a `FAILED`/`REJECTED` refund linked to a return —
  manual admin follow-up only, unchanged posture reaffirmed by ADR-013.
- **Closed this phase**: the crash window between the
  `APPROVED_FOR_REFUND` transition and the restock call completing —
  ADR-012's own documented limitation, closed by `ReturnSettlement` +
  the recovery sweep + reconciliation (see "Phase 013" above).
- **Phase 013's own new deferrals**: cross-return reconciliation of
  aggregate financial totals against `Order`/`Invoice` grand totals (a
  larger reporting feature, out of this phase's per-return scope); a
  dedicated settlement dashboard/metrics export (structured logging is
  the extent of this phase's observability work).

## Concurrency safety, proven

Found via this module's own e2e concurrency suites, not assumed:

**Phase 012** (`test/return-repository.e2e-spec.ts`, hybrid pattern —
full app booted for HTTP-driven setup, actual racy calls bypass HTTP
and hit `PrismaReturnRepository`/`PrismaCreditNoteRepository`/
`PrismaRefundRepository` directly): the return-quantity invariant holds
under 4 concurrent 3-unit requests against a 10-unit line (exactly 3
admitted); return-creation idempotency holds under 15 concurrent
identical-key `create()` calls (exactly one row); return approval holds
under 20 concurrent `approve()` calls (exactly one transition); the
restock gate holds under 20 concurrent approve-for-refund calls
(exactly one transition); refund double-creation is prevented under 10
concurrent identical-key `Refund.create()` calls (exactly one row);
credit-note issuance holds under 20 concurrent `DRAFT -> ISSUED` calls
(exactly one transition). Ran twice consecutively: 8/8 both times.

**Phase 013** (`test/return-settlement-repository.e2e-spec.ts`, 10
named proofs, and `test/return-settlement-failure-injection.e2e-spec.ts`,
the 5 named crash windows from ADR-013's own failure-scenario table):
20 concurrent `beginRestock()`/`receiveReturnedStock()` calls restock
exactly once; 20 concurrent `requestSettlement()` calls (both
`REFUND`/`CREDIT_NOTE` resolutions) settle exactly once; a settlement
left `PENDING_RESTOCK`/with a physical restock that already happened
converges safely on the next call without duplicating anything;
`reconcileAll()` run 20 times in a row creates zero duplicate side
effects; an illegal transition throws a real `409`, never a recorded
failure; a `FAILED_TERMINAL` settlement rejects every retry, forever; a
settlement with prior recorded transient failures still converges to
exactly one restock. Every crash window (after settlement commit/
before the sweep notices, after enqueue/before the worker starts, after
refund/restock/credit-note creation each before the settlement state
update) converges to one correct final state with zero duplicate
financial or inventory side effects. Both suites ran twice
consecutively, stable both times; the pre-existing
`return-repository.e2e-spec.ts`/`return.e2e-spec.ts`/`order-repository
.e2e-spec.ts`/payment e2e suites (74 tests) pass unmodified.
