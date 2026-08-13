export class RefundExceedsTransactionAmountError extends Error {
  constructor(requested: bigint, alreadyRefunded: bigint, transactionAmount: bigint) {
    super(
      `Refund of ${requested.toString()} plus ${alreadyRefunded.toString()} already ` +
        `refunded would exceed the transaction's own amount of ${transactionAmount.toString()}`,
    );
    this.name = 'RefundExceedsTransactionAmountError';
  }
}

export class NonPositiveRefundAmountError extends Error {
  constructor() {
    super('Refund amount must be a positive integer');
    this.name = 'NonPositiveRefundAmountError';
  }
}

/**
 * ADR-008 decision 6's guard: a refund's amount, combined with every
 * prior refund against the same transaction that still counts against
 * its balance (i.e. not `REJECTED`/`FAILED` — those never consumed the
 * balance they would have), must never exceed the transaction's own
 * `amount`. Called by the application layer's create-refund use case
 * *before* a `Refund` row is written — a rejection here never reaches
 * the repository at all, so there is no `PENDING -> REJECTED` edge on
 * `RefundStateMachine` for this case (see that file's own comment).
 */
export class RefundValidator {
  static assertRefundable(
    requestedAmount: bigint,
    transactionAmount: bigint,
    priorRefunds: readonly { amount: bigint; countsAgainstBalance: boolean }[],
  ): void {
    if (requestedAmount <= 0n) {
      throw new NonPositiveRefundAmountError();
    }
    const alreadyRefunded = priorRefunds
      .filter((refund) => refund.countsAgainstBalance)
      .reduce((sum, refund) => sum + refund.amount, 0n);
    if (requestedAmount + alreadyRefunded > transactionAmount) {
      throw new RefundExceedsTransactionAmountError(
        requestedAmount,
        alreadyRefunded,
        transactionAmount,
      );
    }
  }

  static remainingRefundableAmount(
    transactionAmount: bigint,
    priorRefunds: readonly { amount: bigint; countsAgainstBalance: boolean }[],
  ): bigint {
    const alreadyRefunded = priorRefunds
      .filter((refund) => refund.countsAgainstBalance)
      .reduce((sum, refund) => sum + refund.amount, 0n);
    const remaining = transactionAmount - alreadyRefunded;
    return remaining > 0n ? remaining : 0n;
  }
}
