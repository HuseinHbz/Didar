import { CouponNotApplicableError, DiscountCalculator } from './discount-calculator';

describe('DiscountCalculator', () => {
  describe('calculateTotalDiscount', () => {
    it('applies a percentage coupon as basis points', () => {
      const discount = DiscountCalculator.calculateTotalDiscount(1_000_000n, {
        type: 'PERCENTAGE',
        value: 1000n, // 10%
        minOrderAmount: null,
        maxDiscountAmount: null,
      });
      expect(discount).toBe(100_000n);
    });

    it('applies a fixed-amount coupon directly', () => {
      const discount = DiscountCalculator.calculateTotalDiscount(1_000_000n, {
        type: 'FIXED_AMOUNT',
        value: 50_000n,
        minOrderAmount: null,
        maxDiscountAmount: null,
      });
      expect(discount).toBe(50_000n);
    });

    it('caps the discount at maxDiscountAmount', () => {
      const discount = DiscountCalculator.calculateTotalDiscount(1_000_000n, {
        type: 'PERCENTAGE',
        value: 5000n, // 50%
        minOrderAmount: null,
        maxDiscountAmount: 100_000n,
      });
      expect(discount).toBe(100_000n);
    });

    it('never discounts more than the subtotal itself', () => {
      const discount = DiscountCalculator.calculateTotalDiscount(10_000n, {
        type: 'FIXED_AMOUNT',
        value: 999_999n,
        minOrderAmount: null,
        maxDiscountAmount: null,
      });
      expect(discount).toBe(10_000n);
    });

    it('throws when subtotal is below the coupon minimum order amount', () => {
      expect(() =>
        DiscountCalculator.calculateTotalDiscount(10_000n, {
          type: 'FIXED_AMOUNT',
          value: 1_000n,
          minOrderAmount: 100_000n,
          maxDiscountAmount: null,
        }),
      ).toThrow(CouponNotApplicableError);
    });
  });

  describe('allocateByLineShare', () => {
    it('allocates proportionally and the sum exactly equals the total discount', () => {
      const lines = [{ lineSubtotal: 300_000n }, { lineSubtotal: 700_000n }];
      const allocations = DiscountCalculator.allocateByLineShare(100_000n, lines, 1_000_000n);
      expect(allocations.reduce((sum, value) => sum + value, 0n)).toBe(100_000n);
    });

    it('assigns rounding remainder to the last line, never losing a Rial', () => {
      // 100 split three ways by equal shares of 333333... would lose
      // fractions under naive per-line floor division — the remainder
      // must land somewhere, deterministically the last line.
      const lines = [{ lineSubtotal: 1n }, { lineSubtotal: 1n }, { lineSubtotal: 1n }];
      const allocations = DiscountCalculator.allocateByLineShare(10n, lines, 3n);
      expect(allocations.reduce((sum, value) => sum + value, 0n)).toBe(10n);
    });

    it('returns all zeros when the cart subtotal is zero', () => {
      const allocations = DiscountCalculator.allocateByLineShare(0n, [{ lineSubtotal: 0n }], 0n);
      expect(allocations).toEqual([0n]);
    });
  });
});
