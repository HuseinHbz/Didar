import type { PaymentTransactionStatus } from '@iecp/types';

export class InvalidPaymentTransactionTransitionError extends Error {
  constructor(from: PaymentTransactionStatus, to: PaymentTransactionStatus) {
    super(`Cannot transition payment transaction from ${from} to ${to}`);
    this.name = 'InvalidPaymentTransactionTransitionError';
  }
}

/**
 * `PENDING -> {VERIFIED|FAILED}`, both terminal (ADR-008 decision 2) —
 * "successful transactions immutable" is the brief's own explicit rule,
 * enforced structurally here: once `VERIFIED`, this graph has no outgoing
 * edges at all, so even a caller that forgot the rule gets a thrown
 * error instead of a silent overwrite.
 */
export class PaymentTransactionStateMachine {
  private static readonly GRAPH: Record<
    PaymentTransactionStatus,
    readonly PaymentTransactionStatus[]
  > = {
    PENDING: ['VERIFIED', 'FAILED'],
    VERIFIED: [],
    FAILED: [],
  };

  static isNoOp(from: PaymentTransactionStatus, to: PaymentTransactionStatus): boolean {
    return from === to;
  }

  static canTransition(from: PaymentTransactionStatus, to: PaymentTransactionStatus): boolean {
    return this.isNoOp(from, to) || this.GRAPH[from].includes(to);
  }

  static assertTransition(from: PaymentTransactionStatus, to: PaymentTransactionStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidPaymentTransactionTransitionError(from, to);
    }
  }
}
