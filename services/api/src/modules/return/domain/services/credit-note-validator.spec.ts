import {
  CreditNoteExceedsRefundableAmountError,
  CreditNoteGrandTotalMismatchError,
  CreditNoteLineSumMismatchError,
  CreditNoteValidator,
  NonPositiveCreditNoteAmountError,
} from './credit-note-validator';

describe('CreditNoteValidator', () => {
  describe('assertLinesSumToSubtotal', () => {
    it('passes when the lines sum exactly to the subtotal', () => {
      expect(() => {
        CreditNoteValidator.assertLinesSumToSubtotal(
          [{ lineTotal: 40_000n }, { lineTotal: 60_000n }],
          100_000n,
        );
      }).not.toThrow();
    });

    it('rejects when the lines do not sum to the declared subtotal', () => {
      expect(() => {
        CreditNoteValidator.assertLinesSumToSubtotal([{ lineTotal: 40_000n }], 100_000n);
      }).toThrow(CreditNoteLineSumMismatchError);
    });
  });

  describe('assertGrandTotalConsistent', () => {
    it('passes when grandTotal = subtotal - discount + tax', () => {
      expect(() => {
        CreditNoteValidator.assertGrandTotalConsistent(100_000n, 10_000n, 9_000n, 99_000n);
      }).not.toThrow();
    });

    it('rejects a grand total that does not match the arithmetic', () => {
      expect(() => {
        CreditNoteValidator.assertGrandTotalConsistent(100_000n, 10_000n, 9_000n, 100_000n);
      }).toThrow(CreditNoteGrandTotalMismatchError);
    });

    it('rejects a zero or negative grand total', () => {
      expect(() => {
        CreditNoteValidator.assertGrandTotalConsistent(0n, 0n, 0n, 0n);
      }).toThrow(NonPositiveCreditNoteAmountError);
    });
  });

  describe('assertWithinRefundableAmount', () => {
    it('passes when the grand total is within the refundable ceiling', () => {
      expect(() => {
        CreditNoteValidator.assertWithinRefundableAmount(50_000n, 50_000n);
      }).not.toThrow();
    });

    it('rejects a grand total exceeding the refundable ceiling', () => {
      expect(() => {
        CreditNoteValidator.assertWithinRefundableAmount(50_001n, 50_000n);
      }).toThrow(CreditNoteExceedsRefundableAmountError);
    });
  });

  describe('assertValid', () => {
    it('passes a fully self-consistent credit note', () => {
      expect(() => {
        CreditNoteValidator.assertValid({
          lines: [{ lineTotal: 13_625_000n }],
          subtotal: 13_625_000n,
          discountTotal: 0n,
          taxTotal: 0n,
          grandTotal: 13_625_000n,
          refundableAmount: 13_625_000n,
        });
      }).not.toThrow();
    });

    it('rejects on the first inconsistency found', () => {
      expect(() => {
        CreditNoteValidator.assertValid({
          lines: [{ lineTotal: 1_000n }],
          subtotal: 2_000n,
          discountTotal: 0n,
          taxTotal: 0n,
          grandTotal: 2_000n,
          refundableAmount: 2_000n,
        });
      }).toThrow(CreditNoteLineSumMismatchError);
    });
  });
});
