export class CreditNoteLineSumMismatchError extends Error {
  constructor(lineSum: bigint, subtotal: bigint) {
    super(
      `Credit note line total ${lineSum.toString()} does not match declared subtotal ${subtotal.toString()}`,
    );
    this.name = 'CreditNoteLineSumMismatchError';
  }
}

export class CreditNoteGrandTotalMismatchError extends Error {
  constructor(subtotal: bigint, discountTotal: bigint, taxTotal: bigint, grandTotal: bigint) {
    super(
      `Credit note grand total ${grandTotal.toString()} does not equal ` +
        `subtotal ${subtotal.toString()} - discount ${discountTotal.toString()} + tax ${taxTotal.toString()}`,
    );
    this.name = 'CreditNoteGrandTotalMismatchError';
  }
}

export class CreditNoteExceedsRefundableAmountError extends Error {
  constructor(grandTotal: bigint, refundableAmount: bigint) {
    super(
      `Credit note grand total ${grandTotal.toString()} exceeds the return's own ` +
        `refundable amount of ${refundableAmount.toString()}`,
    );
    this.name = 'CreditNoteExceedsRefundableAmountError';
  }
}

export class NonPositiveCreditNoteAmountError extends Error {
  constructor() {
    super('Credit note grand total must be a positive integer');
    this.name = 'NonPositiveCreditNoteAmountError';
  }
}

/**
 * A credit note is never client-totalled: `CreditNoteService.issue()`
 * derives `subtotal`/`discountTotal`/`taxTotal`/`grandTotal` itself from
 * the same `RefundAmountCalculator` figures the linked `Refund` already
 * used (ADR-012 decision 7), and this validator only re-proves the
 * arithmetic actually adds up before the row is written — the same
 * "assert, don't trust" role `RefundValidator` plays for `Refund`.
 * Pure, zero I/O.
 */
export class CreditNoteValidator {
  static assertLinesSumToSubtotal(lines: readonly { lineTotal: bigint }[], subtotal: bigint): void {
    const lineSum = lines.reduce((sum, line) => sum + line.lineTotal, 0n);
    if (lineSum !== subtotal) {
      throw new CreditNoteLineSumMismatchError(lineSum, subtotal);
    }
  }

  static assertGrandTotalConsistent(
    subtotal: bigint,
    discountTotal: bigint,
    taxTotal: bigint,
    grandTotal: bigint,
  ): void {
    if (grandTotal <= 0n) {
      throw new NonPositiveCreditNoteAmountError();
    }
    if (subtotal - discountTotal + taxTotal !== grandTotal) {
      throw new CreditNoteGrandTotalMismatchError(subtotal, discountTotal, taxTotal, grandTotal);
    }
  }

  /** A credit note issued against a return must never exceed that
   * return's own computed refundable amount — the same figure
   * `RefundAmountCalculator.amountForReturnedUnits()` produced for the
   * linked `Refund`. Prevents a credit note from silently manufacturing
   * money the return itself was never eligible for. */
  static assertWithinRefundableAmount(grandTotal: bigint, refundableAmount: bigint): void {
    if (grandTotal > refundableAmount) {
      throw new CreditNoteExceedsRefundableAmountError(grandTotal, refundableAmount);
    }
  }

  static assertValid(input: {
    lines: readonly { lineTotal: bigint }[];
    subtotal: bigint;
    discountTotal: bigint;
    taxTotal: bigint;
    grandTotal: bigint;
    refundableAmount: bigint;
  }): void {
    this.assertLinesSumToSubtotal(input.lines, input.subtotal);
    this.assertGrandTotalConsistent(
      input.subtotal,
      input.discountTotal,
      input.taxTotal,
      input.grandTotal,
    );
    this.assertWithinRefundableAmount(input.grandTotal, input.refundableAmount);
  }
}
