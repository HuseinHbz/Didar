import { DiscountCalculator } from './discount-calculator';

describe('DiscountCalculator', () => {
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

  // Phase 010 (ADR-010 decision 7) — the old single-coupon
  // `calculateTotalDiscount`/`CouponRule` API this file used to own is now
  // the `promotion` module's own `DiscountEngine` (percentage/fixed/cap/
  // min-cart-value math, tested there — see
  // `modules/promotion/domain/services/discount-engine.spec.ts`). This
  // file only ever allocates an already-decided discount total across
  // cart lines, tested below.
  describe('applyAdjustments', () => {
    const lines = [
      { productSkuId: 'sku-a', lineSubtotal: 300_000n },
      { productSkuId: 'sku-b', lineSubtotal: 700_000n },
    ];

    it('allocates a CART-scoped adjustment proportionally across every line', () => {
      const perLine = DiscountCalculator.applyAdjustments(lines, [
        { scope: 'CART', amount: 100_000n },
      ]);
      expect([...perLine.values()].reduce((sum, value) => sum + value, 0n)).toBe(100_000n);
      expect(perLine.get('sku-a')).toBe(30_000n);
      expect(perLine.get('sku-b')).toBe(70_000n);
    });

    it('allocates a line-targeted adjustment only to the named lines', () => {
      const perLine = DiscountCalculator.applyAdjustments(lines, [
        { scope: { productSkuIds: ['sku-b'] }, amount: 50_000n },
      ]);
      expect(perLine.get('sku-a')).toBe(0n);
      expect(perLine.get('sku-b')).toBe(50_000n);
    });

    it('sums multiple stacked adjustments on the same line', () => {
      const perLine = DiscountCalculator.applyAdjustments(lines, [
        { scope: 'CART', amount: 100_000n },
        { scope: { productSkuIds: ['sku-a'] }, amount: 20_000n },
      ]);
      expect(perLine.get('sku-a')).toBe(30_000n + 20_000n);
      expect(perLine.get('sku-b')).toBe(70_000n);
    });

    it('returns all zeros with no adjustments', () => {
      const perLine = DiscountCalculator.applyAdjustments(lines, []);
      expect(perLine.get('sku-a')).toBe(0n);
      expect(perLine.get('sku-b')).toBe(0n);
    });
  });
});
