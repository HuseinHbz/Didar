# ADR-013 — Return Settlement Recovery & Reconciliation

**Status**: Accepted
**Phase**: 012 → **013** (additive extensions to `services/api/src/modules/return`,
`services/api/src/modules/inventory`, `services/api/src/modules/order`)

> **Path note**: the Phase 013 brief asked for this file at
> `docs/architecture/ADR-013-...`. Every ADR in this repository from
> ADR-005 onward lives in `docs/adr/` — there is no `docs/architecture/ADR-*`
> precedent anywhere, and `docs/architecture/` holds per-domain
> architecture summaries (`order.md`, `returns.md`, ...) that themselves
> link _into_ `docs/adr/`, not the other way around. Per this phase's own
> rule ("if a requirement conflicts with the existing architecture,
> document the decision instead of guessing"): kept at
> `docs/adr/ADR-013-return-settlement-reconciliation.md`, consistent with
> ADR-005 through ADR-012, and linked from `docs/architecture/returns.md`.

## 1. Problem

Phase 012 built a real return/refund/credit-note subsystem and was honest
about one known limitation (ADR-012 decision 6): a crash between the
`INSPECTING -> APPROVED_FOR_REFUND` transition committing and the restock
loop finishing leaves a return stuck, partially restocked, with nothing
that ever resumes it. Re-reading Phase 012's actual code for this phase
(not trusting the prior completion report) found the blast radius is
larger than that one documented gap:

- **`ReturnService.approveForRefund()`** runs an unbounded `for` loop
  over every returned item, calling `AdjustmentService
.receiveReturnedStock()` — a real, side-effecting Postgres write —
  synchronously inside one HTTP request, with **zero persisted intent**
  before the loop starts and **zero idempotency** on the restock call
  itself (`InventoryItemRepositoryPort.receiveStock()` unconditionally
  increments `onHand` and writes a new ledger row on every call — no
  unique key, no "already restocked" check). A crash mid-loop, or a
  future retry of this same code path, both had exactly the same
  failure mode: partial or duplicate stock movement, with no mechanism
  to tell which.
- **`ReturnService.refund()`** creates the money-settlement (a `Refund`
  via the one true `RefundService.requestRefund()` pathway, or a
  `CreditNote.issue()`) _before_ transitioning `ReturnRequest.status` to
  `REFUNDED` — the right order for crash-safety in principle (ADR-012
  decision 9's own reasoning) — but nothing ever resumes the status
  transition if the process dies between the two steps. The existing
  `return_settlement_sync` sweep (Phase 012) only scans
  `status = 'REFUNDED'`; a return stuck at `APPROVED_FOR_REFUND` with a
  real, already-completed `Refund`/`CreditNote` sitting unlinked-back is
  invisible to it.
- **A genuine, previously-undetected double-counting bug**, found by
  tracing what a retry of `refund()` actually does:
  `OrderService.recordReturnRefund()` reads `Order.refundedTotal`,
  unconditionally adds `additionalRefundedAmount`, and writes it back —
  no row lock, no idempotency key, no "was this return's refund already
  recorded" guard. `RefundService.requestRefund()`'s own idempotency key
  (`return-refund__${id}`) correctly prevents a second `Refund` row on
  retry, but `refund()` calls `recordReturnRefund()` _unconditionally_
  every time it reaches that line — so two concurrent `refund()` calls
  racing past the (unlocked, application-layer) `ReturnStateMachine
.assertTransition` check before either writes `REFUNDED`, or one
  synchronous call retried after a partial crash, both double-add to
  `Order.refundedTotal`. This is a real financial-consistency bug in
  Phase 012's own code, not a hypothetical — reproduced under real
  concurrency in this phase's own test suite (§ Concurrency below).
- **`CreditNoteService.createDraftForReturn()`**'s own doc comment
  claims it is "structurally guarded... never reachable a second time
  for the same return" — true only because it is called from exactly
  one place today (`approveForRefund()`'s single synchronous
  invocation). There is no database constraint backing that claim: zero
  unique index on `CreditNote.returnRequestId`. Any future retry path
  that re-enters `approveForRefund()`'s restock/draft logic (which this
  phase must add, to fix the restock crash window above) would silently
  create a second `DRAFT` credit note for the same return.

Phase 013 closes all four gaps together, because they share one root
cause: **side effects with real-world consequences (money movement,
stock movement) were executed synchronously inside an HTTP request with
no durable record of intent and no idempotency key of their own**,
relying entirely on the _surrounding_ state machine's row lock — which
only protects the state machine's own column, not the side effects a
caller triggers around it.

## 2. Existing Phase 012 architecture (confirmed by re-reading the code, not the prior report)

- `ReturnStateMachine`/`CreditNoteStateMachine` (pure domain) — unchanged, still correct.
- `PrismaReturnRepository.updateStatus()`/`PrismaCreditNoteRepository.updateStatus()` — real `SELECT ... FOR UPDATE` + re-check-the-locked-row, returning `StatusUpdateResult<T> = { entity: T; transitioned: boolean }`. This pattern is sound and is reused, not replaced, by every new transition this phase adds.
- `PrismaReturnRepository.create()`'s `lockAndSumReturned()` — the return-quantity invariant, unaffected by this phase.
- **The established "sweep, not per-event queue" recovery precedent**: `RefundStatusSyncProcessor` (Phase 008) is a periodic `@Processor` that finds stale `PENDING` refunds and re-drives them through the _exact same_ `RefundService.processRefund()` the synchronous path calls — protected only by `RefundStateMachine.assertTransition`'s own guard against double-processing. `ReturnSettlementSyncProcessor` (Phase 012) does the identical thing for `REFUNDED -> COMPLETED`. **This phase extends that exact precedent** rather than inventing a new per-event durable-job framework — see Decision 8.
- `InventoryItemRepositoryPort.receiveStock()` / `mutateInventoryItem()` — the row-lock (`SELECT ... FOR UPDATE` on `InventoryItem`) correctly serializes concurrent _quantity_ mutation, but the _ledger write_ itself carries no idempotency key anywhere in this codebase before this phase — every other side-effecting write with a real duplication risk (`Fulfillment.idempotencyKey`, `Refund.idempotencyKey`, `ReturnRequest.idempotencyKey`, `InventoryReservation.idempotencyKey`) already has one; `InventoryLedger` never got one because nothing before this phase ever called `receiveStock()` more than once by design.
- RBAC: 9 `return.*`/`credit_note.*` permissions, two roles (`returns_manager`, `returns_clerk`). Unchanged this phase except for the minimal additive surface in Decision 15.

## 3. Crash window after `APPROVED_FOR_REFUND`

Two distinct windows exist, not one — conflating them was the mistake ADR-012 decision 6 almost made:

- **Window A (restock)**: between the `INSPECTING -> APPROVED_FOR_REFUND` transition committing and every eligible `ReturnItem` finishing its own restock. Multiple items, each an independent unit of work — a crash after item 2 of 5 leaves items 3-5 un-restocked _forever_ today, with no signal anything is wrong short of an admin noticing stock looks low.
- **Window B (settlement completion)**: between the `Refund`/`CreditNote` being created (or reaching a terminal state) and `ReturnRequest.status` actually reaching `REFUNDED`. Today this is a single admin HTTP call (`refund()`); a crash mid-call leaves the return at `APPROVED_FOR_REFUND` forever with a real settlement artifact orphaned from it.

Both windows get the same fix shape: a durable, per-return settlement
record that survives a crash written _before_ any side effect, plus a
recovery sweep that re-drives an unfinished settlement through the
_same idempotent code path_ the synchronous trigger uses — never a
separate "repair" code path with its own logic to keep correct.

## 4. Why database state must be the source of truth

Unchanged from every prior phase's own stated principle (`docs/database/README.md`
convention #8, ADR-008/ADR-012's own repeated point): Redis/BullMQ job
state is ephemeral by design — `removeOnComplete: true` on every queue
in this codebase already means a completed job's own record is gone
within moments. If "has this return been restocked" or "has this
return's refund been recorded" lived only in a job's completion status,
that fact would vanish before a human ever needed to ask it, and a
Redis flush/restart would silently forget "in-flight" work entirely.
`ReturnSettlement` (Decision 5) is the durable record; BullMQ jobs are
disposable triggers that call into idempotent Postgres-backed methods,
never bearers of state a decision depends on.

## 5. Settlement state model

Reused, not copied verbatim, from the brief's own suggested list — the
actual shape follows the two real, independently-triggered phases found
in Decision 3, which the brief's own instruction ("derive the actual
state machine from existing architecture") requires respecting rather
than serializing into one pipeline: an admin approves-for-refund
(triggers restock) as a **separate, deliberate action**, potentially
minutes or days before that same admin (or a different one) clicks
refund (triggers settlement) — Phase 012's own e2e suite already
exercises these as two distinct clicks with two distinct audit actions
(`RETURN_APPROVED_FOR_REFUND`, `RETURN_REFUNDED`), and nothing in this
phase's brief is a mandate to collapse that into one atomic pipeline.

New `commerce.return_settlements` table, one row per `ReturnRequest`
(`returnRequestId` real FK, `@unique`):

```
PENDING_RESTOCK   -- row created at APPROVED_FOR_REFUND; restock not yet
                     confirmed complete for every eligible item
RESTOCKED         -- every eligible ReturnItem's restock step is done
                     (including the zero-eligible-items case)
REFUND_REQUESTED  -- admin triggered refund(); settlement artifact
                     (Refund or CreditNote) creation attempted/done
SETTLED           -- ReturnRequest reached REFUNDED (mirrors, does not
                     replace, the existing ReturnStatus column)
COMPLETED         -- mirrors ReturnRequest COMPLETED (return_settlement_sync)
FAILED_RETRYABLE  -- a step failed on a transient condition (DB error,
                     network blip) — the recovery sweep will retry it
FAILED_TERMINAL   -- a step failed on a domain-invariant violation
                     (corrupted snapshot, impossible quantity) — never
                     auto-retried, requires manual review
MANUAL_REVIEW     -- reconciliation found a state it cannot safely
                     auto-repair
```

`PENDING_RESTOCK -> RESTOCKED -> REFUND_REQUESTED -> SETTLED -> COMPLETED`
is the happy path. `FAILED_RETRYABLE`/`FAILED_TERMINAL`/`MANUAL_REVIEW`
are reachable from any non-terminal state — `ReturnSettlementStateMachine`
(pure domain, mirrors `ReturnStateMachine`'s own shape) is the single
place this graph is defined; `PrismaReturnSettlementRepository
.updateStatus()` row-locks and re-checks it, identical technique to
every other state machine in this codebase.

`RESTOCKED`/`SETTLED` are **not** skippable even when there is nothing
to do (e.g. a `CREDIT_NOTE`-resolution return with zero restockable
items still passes through `RESTOCKED`) — a state that was never
visited is indistinguishable from one still in progress, which is
exactly the ambiguity this table exists to remove.

## 6. Restock recovery strategy

`ReturnItem` gains `restockedAt DateTime?`. `AdjustmentService
.receiveReturnedStock()`'s underlying `receiveStock()` call gains a
required `idempotencyKey` for this call site, deterministic:
`return-restock__${returnItemId}` — one key per line, matching "one
return item -> one restock event" exactly. `InventoryLedger` gains a
nullable, `@unique` `idempotencyKey` column; `PrismaInventoryItemRepository
.receiveStock()` writes the ledger row _and_ the key inside the same
transaction as the quantity mutation, and on a `P2002` collision
re-reads and returns the existing ledger entry/item instead of
mutating again — the exact same P2002-catch-and-reread convention
`ReturnRequest.create()`/`Fulfillment.create()`/`InventoryReservation
.create()` already established, extended to a fourth entity rather
than inventing a fifth mechanism.

`ReturnSettlementService.beginRestock(returnRequestId)` — idempotent,
callable any number of times, from the synchronous `approveForRefund()`
path _and_ the recovery sweep identically:

1. Row-locks the `ReturnSettlement` row (`SELECT ... FOR UPDATE`); if
   already `RESTOCKED` or later, no-op.
2. For every `ReturnItem` whose `condition` is restockable and whose
   `restockedAt IS NULL`: calls `receiveReturnedStock()` with the
   deterministic key above. A crash between items is safe by
   construction — the next call (synchronous retry or a sweep tick)
   only touches items still `restockedAt IS NULL`.
3. Once every eligible item has `restockedAt` set, transitions the
   settlement to `RESTOCKED`.

This closes ADR-012 decision 6's own documented limitation with a real
mechanism, not a promise deferred again.

**Historical-data backfill (found empirically, not theoretically).**
`ReturnItem.restockedAt` defaults to `NULL` for every row that existed
before this migration — including returns the old, synchronous
pre-Phase-013 `approveForRefund()` had *already* physically restocked
(that method called `receiveReturnedStock()` directly, with no
idempotency key at all, before this phase's mechanism existed). Without
a backfill, `NULL` reads as "never restocked," and the recovery
sweep/reconciliation engine — both of which re-drive every settlement
missing a `ReturnSettlement` row through `beginRestock()` — would issue
a real *second* physical restock for each one. This was caught by
running the compiled app against the real accumulated dev database
(1196 orders, 180 returns) as part of this task's own boot-test
verification: 18 duplicate `InventoryLedger` rows appeared across 18
`ReturnItem`s (8 `REFUNDED` + 10 `COMPLETED` returns) on first boot.
The duplicates were manually reversed (ledger rows deleted, item
quantities restored — verified safe first: no other write had touched
those rows since), and `migration.sql` gained a backfill `UPDATE`
(section 5) that sets `restockedAt` for exactly the items the old
code's own eligibility condition already restocked — mirrored
condition-for-condition, not guessed — before the settlement/ledger
columns are ever used by application code. Re-verified end to end: a
second boot produces zero new ledger rows, and the full
UP→DOWN→UP+shadow-diff migration round trip (§ Testing) was redone
after this fix.

## 7. Idempotency strategy (summary — mechanism-by-mechanism detail in Decisions 6-9)

Every retryable side effect in this phase gets a **deterministic,
database-enforced** idempotency key, never a job ID, timestamp, or
process-memory flag alone:

| Side effect                              | Key                                 | Enforced by                                                                                                 |
| ---------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Restock (per item)                       | `return-restock__${returnItemId}`   | `InventoryLedger.idempotencyKey` unique index                                                               |
| Credit-note draft (per return)           | (structural — see Decision 8)       | partial unique index on `CreditNote.returnRequestId`                                                        |
| Refund creation (per return)             | `return-refund__${returnRequestId}` | `Refund.idempotencyKey` unique index (unchanged since ADR-012)                                              |
| Order refunded-total update (per return) | `ReturnSettlement.refundRecordedAt` | row-locked settlement transition, not a bare column write                                                   |
| Settlement status transitions            | —                                   | `SELECT ... FOR UPDATE` + state-machine re-check (same as every other aggregate)                            |
| Reconciliation repairs                   | —                                   | reconciliation only ever calls the same idempotent methods above; it has no side-effecting logic of its own |

## 8. Queue delivery semantics

**Decision: extend the existing sweep precedent (Decision 2), do not
build a per-event job-with-deterministic-jobId system.** Considered and
rejected: enqueuing one BullMQ job per settlement transition with a
deterministic `jobId` (BullMQ's own dedup). Rejected because (a) it is
a second recovery mechanism alongside the sweep pattern this codebase
already uses everywhere else for exactly this class of problem —
`docs/database/README.md`'s own "prefer extending existing
infrastructure" principle and this phase's absolute rule 18 both argue
against it; (b) real correctness here comes entirely from the DB-level
idempotency keys in Decision 7 — a BullMQ `jobId` is _never_ the
authority in this design, so adding one buys deduplication the database
already guarantees, at the cost of a second abstraction to keep
consistent with the first. A "duplicate worker delivery" is modeled and
proven in this phase's own tests (§ Concurrency) as N concurrent direct
calls to the same idempotent service method — exactly the shape
`test/return-repository.e2e-spec.ts` already used in Phase 012 for
every other invariant in this codebase, and a strictly _stronger_ proof
than BullMQ's own at-least-once redelivery would give (true wall-clock
concurrency, not sequential retries).

New queue `return_settlement_recovery` (added to the existing
`ReturnQueueModule`, same `BullModule.registerQueue` shape
`return_settlement_sync` already uses): a periodic sweep (`upsertJobScheduler`,
same mechanism), interval 2 minutes — tighter than `return_settlement_sync`'s
5 minutes, since an unrestocked-and-therefore-unsellable item is a
sharper business cost than a slightly-delayed `COMPLETED` flag. Finds
every `ReturnSettlement` in `PENDING_RESTOCK` or `REFUND_REQUESTED`
older than a short grace period (60s — long enough that the
synchronous happy path always wins the race under normal load) and
re-drives it through `beginRestock()`/`requestSettlement()` — the
identical methods the synchronous HTTP path calls. `DEFAULT_JOB_OPTIONS`
(3 attempts, exponential backoff, `removeOnComplete: true`) is reused
unchanged — Redis never becomes the record of what happened, only the
trigger for "check again."

`FAILED_TERMINAL` settlements are explicitly excluded from the sweep's
scan (Decision 10) — a terminal failure is a domain-invariant
violation, not a transient one; retrying it forever would be the exact
"fake retry" absolute rule 20 rules out ("the final system must
converge to one correct state after arbitrary _safe_ retries" — a
terminal failure is not safe to blindly retry).

## 9. Reconciliation strategy

`ReturnReconciliationService` (new, application layer) — read-heavy,
deterministic, side-effect-free except for the specific, provably-safe
repairs enumerated below. `POST /admin/returns/reconcile` (and the
periodic sweep, Decision 8) both call the _same_ `reconcileAll()`
method — there is exactly one reconciliation code path, never a
manual-trigger variant with different logic than the automatic one.

For each of the brief's 9 named inconsistency patterns:

1. **Return approved but no settlement** — `ReturnRequest.status IN
('APPROVED_FOR_REFUND', ...)` with no `ReturnSettlement` row (only
   possible if the process crashed between the status transition and
   the settlement-row insert, both of which this phase now writes in
   the same transaction — see Decision 11 — so this becomes
   structurally unreachable going forward, but reconciliation still
   checks for it as a defense-in-depth backstop). **Repair**: create
   the missing `PENDING_RESTOCK` row and let the sweep pick it up.
2. **Settlement exists but no job** — not applicable under Decision 8's
   design (there is no per-settlement job to lose track of; the
   periodic sweep always re-scans every non-terminal settlement). Kept
   as a documented non-issue, not silently dropped from the list.
3. **Refund requested but not finalized** — `ReturnSettlement.status =
'REFUND_REQUESTED'` with a linked `Refund.status = 'PENDING'` older
   than the existing `refund_status_sync` sweep's own retry window.
   **Repair**: none needed directly — `refund_status_sync` (Phase 008,
   unowned by this module) already drives it; reconciliation only flags
   `MANUAL_REVIEW` if the `Refund` has sat `PENDING` past a much longer
   threshold (24h) than that sweep's own cadence would ever explain.
4. **Refund settled but restock missing** — `Refund.status = 'COMPLETED'`
   (or `CreditNote.status = 'ISSUED'`) while the linked
   `ReturnSettlement.status` is still `PENDING_RESTOCK`. **Repair**:
   call `beginRestock()` — always safe, restock and settlement are
   independent phases by design (Decision 5).
5. **Restock completed but settlement not marked** — every eligible
   `ReturnItem.restockedAt` is set but `ReturnSettlement.status` is
   still `PENDING_RESTOCK`. **Repair**: transition to `RESTOCKED` —
   pure bookkeeping catch-up, no financial/inventory risk.
6. **Credit note expected but missing** — `resolution = 'CREDIT_NOTE'`,
   settlement past `RESTOCKED`, no `CreditNote` row exists for the
   return. **Repair**: none automatic — creating a credit note is a
   financial-record-generating action; reconciliation calls
   `beginRestock()` again (idempotent, harmless) which is where
   drafting happens, and only escalates to `MANUAL_REVIEW` if that
   still doesn't produce one (a genuine data problem, e.g. the return's
   own items were somehow never inspected).
7. **Settlement stuck in `PROCESSING`-equivalent state** — no state in
   this model is a bare "processing" flag (Decision 5 deliberately has
   no such state — every state is either "done through step N" or
   terminal), so this pattern maps to: a non-terminal settlement whose
   `updatedAt` is older than a configurable staleness threshold (30
   minutes) with `attempts >= 3` (the same attempt cap
   `DEFAULT_JOB_OPTIONS` already uses). **Repair**: `MANUAL_REVIEW` —
   three real attempts already failed; a fourth automatic one is not
   "safe," it's hope.
8. **Duplicate logical operations** — by construction (Decision 7's
   database-enforced keys), a duplicate `Refund`/`CreditNote`/ledger
   entry cannot exist. Reconciliation asserts this as a **detection**
   check anyway (count `Refund`s per `returnRequestId`,
   `CreditNote`s per `returnRequestId`, ledger entries per
   `returnItemId` restock key) — if it ever finds more than one, that
   is a genuine corruption signal (a bug, or a manual database
   intervention), never auto-repaired, always `MANUAL_REVIEW` with the
   full duplicate set logged.
9. **Terminal failure requiring manual review** — settlements already
   at `FAILED_TERMINAL`/`MANUAL_REVIEW` are the reconciliation run's own
   _output_ for the patterns above, and are listed (not re-processed)
   on every run — `GET /admin/returns/settlements?status=MANUAL_REVIEW`
   is how an operator finds them.

**Idempotent by construction**: every repair action above is one of the
same handful of already-idempotent method calls (`beginRestock()`,
a settlement status transition through the row-locked state machine).
Running `reconcileAll()` 100 times produces the same end state as
running it once — proven in this phase's own tests (§ Testing), not
merely asserted.

## 10. Retry policy

- **Retryable**: any exception that is not one of the domain errors
  below — transient DB connection failure, transient Redis
  unavailability (the sweep simply doesn't run until Redis recovers;
  nothing is lost because nothing authoritative lived there), a
  provider timeout inside the _existing_ `RefundService.processRefund()`
  path (unchanged, already handled by `refund_status_sync`). `attempts:
3` + exponential backoff (`DEFAULT_JOB_OPTIONS`, unchanged) bounds the
  automatic retry count; beyond that, reconciliation's pattern 7 above
  escalates to `MANUAL_REVIEW` rather than retrying forever.
- **Terminal, never auto-retried**: `InvalidReturnSettlementTransitionError`
  (the settlement itself is in a state the attempted operation cannot
  apply to — a real logic/data bug, not a transient condition),
  `MissingImmutableSnapshotError` (an `OrderItem`'s own snapshot fields
  are somehow absent — corrupted historical data, retrying changes
  nothing), `NonPositiveRestockQuantityError` (mirrors
  `NonPositiveReturnQuantityError`'s own reasoning — a malformed
  request, not a race). Each maps to `ReturnSettlementStatus =
'FAILED_TERMINAL'` the moment it's thrown from within a settlement
  operation, via the same `ReturnDomainExceptionFilter` this module
  already uses (additive `@Catch()` entries, not a new filter).

## 11. Audit semantics

Unchanged principle from ADR-012/ADR-011: **audit only a real
transition, never an attempt.** Every new settlement-status write
audit-logs exactly once, gated on `transitioned: true` from the
row-locked repository call — the same discipline `FulfillmentService`
(Phase 011) and `ReturnService` (Phase 012) already established. New
actions: `RETURN_SETTLEMENT_RESTOCK_STARTED` (first transition into
`PENDING_RESTOCK`, i.e. settlement creation), `RETURN_SETTLEMENT_RESTOCKED`,
`RETURN_SETTLEMENT_REFUND_REQUESTED`, `RETURN_SETTLEMENT_SETTLED`,
`RETURN_SETTLEMENT_FAILED` (`newValue` includes the terminal/retryable
distinction and the triggering error's message — never a stack trace,
never provider credentials), `RETURN_SETTLEMENT_MANUAL_REVIEW`,
`RETURN_SETTLEMENT_RETRIED` (an admin's own explicit retry action, per
Decision 15), `RETURN_SETTLEMENT_RECONCILED` (one entry per
`reconcileAll()` run that performed at least one repair, `newValue`
listing exactly which settlements it touched and how — a _pure_
detection-only run with zero repairs writes no audit entry, matching
"audit a real transition" applied to reconciliation itself).

## 12. Financial consistency guarantees

- Refund/credit-note amounts are computed exactly once, at
  `inspect()` time, from `OrderItem`'s immutable snapshot
  (`RefundAmountCalculator`, unchanged from ADR-012 decision 4) — this
  phase adds zero new amount-computation logic; every settlement
  operation reads the already-computed `ReturnItem.refundAmount`,
  never recomputes it from current catalog/promotion/tax data.
- `Order.refundedTotal`/`paymentStatus` are updated **exactly once per
  settlement**, closing the double-counting bug in § 1: `ReturnSettlement`
  gains `refundRecordedAt DateTime?`; `recordReturnRefund()` is now
  called from inside the same row-locked settlement transaction that
  writes `REFUND_REQUESTED -> SETTLED`, guarded by `refundRecordedAt
IS NULL` — a second concurrent or retried call sees the lock, sees
  `refundRecordedAt` already set, and skips the order-total update
  entirely while still safely re-confirming the `ReturnRequest.status`
  transition (itself already idempotent). Proven under real concurrency
  (§ Concurrency).
- `Invoice` rows are never mutated by any code this phase adds — a
  `CreditNote` remains the only adjustment mechanism, unchanged from
  ADR-012 decision 7.
- Reconciliation never guesses a financial amount — every repair listed
  in Decision 9 is either pure bookkeeping (a status catch-up) or a
  call into an already-amount-computed, already-validated code path
  (`beginRestock()`/credit-note drafting, which itself re-runs
  `CreditNoteValidator` before writing, unchanged from ADR-012).

## 13. Inventory consistency guarantees

- One `ReturnItem` restocks at most once, ever, database-enforced
  (`InventoryLedger.idempotencyKey` unique index, Decision 6) —
  independent of how many times `beginRestock()` is called, how many
  sweep ticks fire concurrently, or how many admins click retry.
- A rejected return, or an item whose inspected `condition` is not in
  `RESTOCKABLE_CONDITIONS`, is never restocked — unchanged from ADR-012
  decision 6, structurally reinforced (not weakened) by this phase: the
  restock loop still only ever iterates `RESTOCKABLE_CONDITIONS` items.
- Inventory quantity mutation itself remains protected by
  `mutateInventoryItem()`'s own `SELECT ... FOR UPDATE` on `InventoryItem`
  (Phase 006, unchanged) — this phase's idempotency key prevents a
  _duplicate_ mutation; the pre-existing row lock prevents a _torn_
  one. Both are needed; neither alone is sufficient.

## 14. Failure scenarios (explicit, per the brief's own list)

| Scenario                                                                      | Outcome                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash after settlement DB state commits, before restock begins                | Settlement sits `PENDING_RESTOCK`; recovery sweep (2 min) or the next synchronous trigger calls `beginRestock()`, which only touches un-restocked items                                                                                                                                                                                |
| Crash after restock transaction commits, before settlement marked `RESTOCKED` | Reconciliation pattern 5 catches it; `beginRestock()` re-run is a pure no-op read (every item already `restockedAt IS NOT NULL`) that immediately advances the status                                                                                                                                                                  |
| Crash after refund creation, before settlement state update                   | `Refund` already exists (idempotency key), `ReturnSettlement.refundRecordedAt` still null; recovery/reconciliation re-enters the settlement transaction, sees the existing `Refund`, skips re-creating it (idempotency key), records `refundRecordedAt` once, completes the `REFUNDED` transition                                      |
| Crash after credit-note creation, before settlement state update              | Same shape — `CreditNote` already exists (unique index on `returnRequestId`), recovery finds it via query-first-then-create-on-miss, never attempts a second `create()`                                                                                                                                                                |
| Duplicate queue/sweep delivery (two overlapping sweep ticks)                  | Both call the same idempotent methods; the settlement row lock serializes them — one does real work, the other's every step is a no-op                                                                                                                                                                                                 |
| Worker retry (BullMQ `attempts`)                                              | Identical to duplicate delivery — retries call the same idempotent method, not a separate "retry variant"                                                                                                                                                                                                                              |
| Refund rejected after return approval                                         | `Refund.status = 'REJECTED'`/`'FAILED'` is a real, terminal _payment_ outcome — `ReturnSettlement` stays `REFUND_REQUESTED` (money never moved), surfaced to `MANUAL_REVIEW` by reconciliation pattern 3's extended threshold; no automatic re-request (unchanged posture from ADR-012 decision 8 — "no automatic retry-forever loop") |
| Refund partially processed                                                    | Not a state this codebase's `RefundStateMachine` can represent (`PENDING -> PROCESSING -> {COMPLETED\|FAILED\|REJECTED}`, all-or-nothing) — a provider-side partial settlement is out of scope, same as ADR-008's own original boundary                                                                                                |
| Application restart                                                           | Nothing in-flight is lost: every mid-flight fact (which items restocked, whether the refund total was recorded) is a Postgres row, not process memory; the sweep resumes exactly where the crash left off on the next tick                                                                                                             |
| Redis unavailable                                                             | Sweeps simply don't fire; Postgres state is untouched and correct as of the last successful step; synchronous admin actions (`approve-refund`, `refund`) still work — they only _enqueue nothing_ extra, they do not depend on Redis for their own correctness (Decision 8's design has no in-request Redis dependency)                |
| PostgreSQL unavailable                                                        | Nothing in this module can make progress — by design, since Postgres is the sole source of truth (Decision 4); no code path falls back to Redis or memory to keep going                                                                                                                                                                |
| Duplicate admin action (double-click)                                         | `POST .../approve-refund` twice: second call's `updateStatus` sees `transitioned: false` (Phase 012, unchanged), skips restock entirely (already-idempotent besides). `POST .../refund` twice: second call sees the settlement already past `REFUND_REQUESTED` and returns the current state without re-attempting settlement creation |
| Concurrent settlement attempts (two admins, same return, same moment)         | The settlement row lock (`SELECT ... FOR UPDATE` inside `ReturnSettlementService`'s transactional methods) — the same technique proven in `test/return-repository.e2e-spec.ts` for 20-way concurrency — serializes them; exactly one performs the real work                                                                            |

## 15. Deliberately deferred functionality

- **No live provider partial-refund support** — out of scope, unchanged
  boundary from ADR-008.
- **No automatic infinite retry of a rejected refund** — a business
  decision (ADR-012 decision 8), reaffirmed, not revisited this phase.
- **No "force complete" endpoint** — absolute rule 9. Manual review
  (Decision "RBAC" below) only ever re-invokes the same idempotent,
  validated, row-locked, audited methods the automatic path uses —
  never a raw status overwrite.
- **No cross-return reconciliation of aggregate financial totals**
  against `Order`/`Invoice` grand totals (e.g. "does the sum of every
  return's refund plus every credit note equal `Order.refundedTotal`
  plus outstanding credit balance, across the whole order") — a real,
  useful, larger reporting feature explicitly out of this phase's
  return-level scope; a future phase's concern.
- **No dedicated settlement dashboard/metrics export** — this
  repository has no metrics architecture yet (`docs/security/README.md`'s
  own "Not yet" list already says as much for observability broadly);
  structured logging (§ Observability, not part of this ADR — see the
  module README) is the extent of this phase's observability work.

## RBAC

Three new permissions, minimum surface, each with a real route:
`return.settlement.read` (view a settlement/list settlements),
`return.settlement.retry` (manually re-drive a stuck settlement through
the same idempotent recovery methods the sweep uses), `return.settlement
.reconcile` (manually trigger `reconcileAll()`). No
`return.settlement.manual_review` permission — acknowledging/clearing a
`MANUAL_REVIEW` settlement is just another `retry` (re-attempt) or a
new, narrow `return.settlement.acknowledge` action (added only if the
implementation actually needs a distinct "I've looked at this, stop
flagging it" action beyond retry — see the module README for the final
call once built). `returns_manager` gets all settlement permissions
(the same department-head shape it already has for `return.*`); no
other role gains them — `returns_clerk` stays intake/inspection-only,
unchanged.

## Consequences

- The restock crash window ADR-012 honestly left open is now closed
  with a real, tested mechanism.
- A genuine financial double-counting bug, found by this phase's own
  reconnaissance rather than by a production incident, is fixed before
  it could ever be triggered by a real retry or a real race.
- Reconciliation gives an operator one place to answer "what happened
  to return X" without reading five tables by hand, and never guesses
  at a financial repair.
- No second refund pathway was introduced — every settlement operation
  in this phase still funnels through `RefundService.requestRefund()`/
  `processRefund()` and `CreditNoteService`, unchanged.
- Redis remains disposable; every fact this phase's recovery/reconciliation
  logic depends on lives in Postgres.
