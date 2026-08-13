import {
  NonPositiveRefundAmountError,
  RefundExceedsTransactionAmountError,
  RefundValidator,
} from './refund-validator';

describe('RefundValidator', () => {
  const transactionAmount = 1_000_000n;

  it('allows a full refund with no prior refunds', () => {
    expect(() => {
      RefundValidator.assertRefundable(transactionAmount, transactionAmount, []);
    }).not.toThrow();
  });

  it('allows a partial refund within the remaining balance', () => {
    expect(() => {
      RefundValidator.assertRefundable(400_000n, transactionAmount, [
        { amount: 300_000n, countsAgainstBalance: true },
      ]);
    }).not.toThrow();
  });

  it('rejects a refund that would exceed the transaction amount', () => {
    expect(() => {
      RefundValidator.assertRefundable(700_000n, transactionAmount, [
        { amount: 400_000n, countsAgainstBalance: true },
      ]);
    }).toThrow(RefundExceedsTransactionAmountError);
  });

  it('ignores REJECTED/FAILED prior refunds when computing the consumed balance', () => {
    expect(() => {
      RefundValidator.assertRefundable(transactionAmount, transactionAmount, [
        { amount: 500_000n, countsAgainstBalance: false },
        { amount: 500_000n, countsAgainstBalance: false },
      ]);
    }).not.toThrow();
  });

  it('rejects a zero or negative refund amount', () => {
    expect(() => {
      RefundValidator.assertRefundable(0n, transactionAmount, []);
    }).toThrow(NonPositiveRefundAmountError);
    expect(() => {
      RefundValidator.assertRefundable(-1n, transactionAmount, []);
    }).toThrow(NonPositiveRefundAmountError);
  });

  it('computes the remaining refundable amount, floored at zero', () => {
    expect(
      RefundValidator.remainingRefundableAmount(transactionAmount, [
        { amount: 300_000n, countsAgainstBalance: true },
      ]),
    ).toBe(700_000n);
    expect(
      RefundValidator.remainingRefundableAmount(transactionAmount, [
        { amount: 1_000_000n, countsAgainstBalance: true },
      ]),
    ).toBe(0n);
  });
});
