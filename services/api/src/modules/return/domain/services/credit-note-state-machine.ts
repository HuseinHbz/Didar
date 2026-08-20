import type { CreditNoteStatus } from '@iecp/types';

export class InvalidCreditNoteTransitionError extends Error {
  constructor(from: CreditNoteStatus, to: CreditNoteStatus) {
    super(`Cannot transition credit note from ${from} to ${to}`);
    this.name = 'InvalidCreditNoteTransitionError';
  }
}

/**
 * `DRAFT -> ISSUED -> APPLIED`, with `VOID` reachable from `DRAFT`/
 * `ISSUED` (ADR-012 decision 7) — mirrors `InvoiceStateMachine`'s own
 * shape. Never reachable from `APPLIED` — once a credit note has
 * actually been applied against a customer's balance, voiding it would
 * silently un-credit money already accounted for; that correction, if
 * ever needed, is a manual, separately-audited process outside this
 * state machine's own scope, same "no automatic reversal" discipline
 * `RefundStateMachine` already applies to its own terminal states.
 */
export class CreditNoteStateMachine {
  private static readonly GRAPH: Record<CreditNoteStatus, readonly CreditNoteStatus[]> = {
    DRAFT: ['ISSUED', 'VOID'],
    ISSUED: ['APPLIED', 'VOID'],
    APPLIED: [],
    VOID: [],
  };

  static isNoOp(from: CreditNoteStatus, to: CreditNoteStatus): boolean {
    return from === to;
  }

  static canTransition(from: CreditNoteStatus, to: CreditNoteStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: CreditNoteStatus, to: CreditNoteStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidCreditNoteTransitionError(from, to);
    }
  }
}
