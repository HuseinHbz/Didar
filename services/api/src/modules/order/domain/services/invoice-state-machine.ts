import type { InvoiceStatus } from '@iecp/types';

export class InvalidInvoiceTransitionError extends Error {
  constructor(from: InvoiceStatus, to: InvoiceStatus) {
    super(`Cannot transition invoice from ${from} to ${to}`);
    this.name = 'InvalidInvoiceTransitionError';
  }
}

/**
 * `DRAFT -> ISSUED -> PAID`, with `VOID` reachable from `ISSUED`/`PAID`
 * (a correction is a VOID plus manual admin follow-up — ADR-009 decision
 * 7, no re-issue mechanic this phase) and `CANCELLED` reachable from
 * `DRAFT` only (a draft that never got issued). No repository method
 * exposes an update path for `subtotal`/`taxTotal`/`grandTotal`/`items`
 * once `ISSUED` — this state machine only governs `status` itself.
 */
export class InvoiceStateMachine {
  private static readonly GRAPH: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
    DRAFT: ['ISSUED', 'CANCELLED'],
    ISSUED: ['PAID', 'VOID'],
    PAID: ['VOID'],
    VOID: [],
    CANCELLED: [],
  };

  static isNoOp(from: InvoiceStatus, to: InvoiceStatus): boolean {
    return from === to;
  }

  static canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: InvoiceStatus, to: InvoiceStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidInvoiceTransitionError(from, to);
    }
  }
}
