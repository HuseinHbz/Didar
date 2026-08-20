import type { ReturnSettlementStatus } from '@iecp/types';

export class InvalidReturnSettlementTransitionError extends Error {
  constructor(from: ReturnSettlementStatus, to: ReturnSettlementStatus) {
    super(`Cannot transition return settlement from ${from} to ${to}`);
    this.name = 'InvalidReturnSettlementTransitionError';
  }
}

/**
 * ADR-013 decision 5 — the durable settlement-execution graph, kept
 * deliberately separate from `ReturnStateMachine`: restock and
 * money-settlement are two independently admin-triggered phases (Phase
 * 012's own two-click `approve-refund`/`refund` behavior, preserved not
 * collapsed), so `RESTOCKED`/`SETTLED` are real states a settlement
 * passes through even when there is nothing to do for them (e.g. every
 * `ReturnItem` is a non-restockable condition — still transitions
 * `PENDING_RESTOCK -> RESTOCKED`) — a step never visited is
 * indistinguishable from one still in progress, which is exactly the
 * ambiguity this state machine exists to remove.
 *
 * `PENDING_RESTOCK -> RESTOCKED -> REFUND_REQUESTED -> SETTLED ->
 * COMPLETED` is the happy path. `FAILED_TERMINAL`/`MANUAL_REVIEW` are
 * reachable from any non-terminal, non-`SETTLED`/`COMPLETED` state — a
 * domain-invariant violation (corrupted snapshot, impossible quantity)
 * is a real, permanent stop, never auto-retried (ADR-013 decision 10);
 * `MANUAL_REVIEW` is reconciliation's own "found something it cannot
 * safely repair" outcome. `MANUAL_REVIEW` itself can only move forward
 * to whichever progressing state an admin's own retry action re-enters,
 * or to `FAILED_TERMINAL` as an explicit acknowledgment that a review
 * finding is not, in fact, recoverable — never back into `SETTLED`/
 * `COMPLETED` directly (those are only ever reached by re-running the
 * normal idempotent settlement methods, not by a manual status jump —
 * see the module README for why there is no "force complete" action).
 *
 * `FAILED_RETRYABLE` exists in the schema enum but is deliberately
 * **unreachable** by this state machine: a transient failure (a DB
 * blip, a momentary Redis outage) does not need its own status — the
 * settlement simply stays in its current progressing state
 * (`PENDING_RESTOCK`/`REFUND_REQUESTED`) with `attempts`/`lastError`/
 * `lastAttemptAt` updated in place, and the next sweep tick or manual
 * retry tries again from exactly that state. Introducing a real
 * transition into and back out of `FAILED_RETRYABLE` would add two
 * extra status writes (and two extra audit entries) per retry cycle
 * for no behavioral benefit. The enum value is kept for schema
 * forward-compatibility — a future phase distinguishing "will retry
 * automatically" from "quiet, no visible retry yet" at the database
 * level can start using it without another migration — same
 * "keep unused readiness seams around" precedent
 * `InventoryMovementType.RETURN_RECEIPT` itself set before this phase
 * ever called `receiveStock()` with it.
 */
export class ReturnSettlementStateMachine {
  private static readonly GRAPH: Record<
    ReturnSettlementStatus,
    readonly ReturnSettlementStatus[]
  > = {
    PENDING_RESTOCK: ['RESTOCKED', 'FAILED_TERMINAL', 'MANUAL_REVIEW'],
    RESTOCKED: ['REFUND_REQUESTED', 'FAILED_TERMINAL', 'MANUAL_REVIEW'],
    REFUND_REQUESTED: ['SETTLED', 'FAILED_TERMINAL', 'MANUAL_REVIEW'],
    SETTLED: ['COMPLETED'],
    COMPLETED: [],
    FAILED_RETRYABLE: [],
    FAILED_TERMINAL: [],
    MANUAL_REVIEW: ['PENDING_RESTOCK', 'RESTOCKED', 'REFUND_REQUESTED', 'FAILED_TERMINAL'],
  };

  static isNoOp(from: ReturnSettlementStatus, to: ReturnSettlementStatus): boolean {
    return from === to;
  }

  static canTransition(from: ReturnSettlementStatus, to: ReturnSettlementStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: ReturnSettlementStatus, to: ReturnSettlementStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidReturnSettlementTransitionError(from, to);
    }
  }

  /** Whether `status` can still make forward progress at all — `false`
   * for every terminal/paused state (`COMPLETED`, `FAILED_TERMINAL`,
   * `MANUAL_REVIEW`). Used by the recovery sweep to decide whether a
   * settlement is worth re-driving, and by reconciliation to decide
   * whether a settlement counts as "still active" for its own
   * inconsistency checks. */
  static isActive(status: ReturnSettlementStatus): boolean {
    return status !== 'COMPLETED' && status !== 'FAILED_TERMINAL' && status !== 'MANUAL_REVIEW';
  }
}
