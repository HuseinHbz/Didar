import { NegativeTotalError, PricingResolver } from './pricing-resolver';

describe('PricingResolver', () => {
  it('resolves a single line with no coupon, no tax, no shipping', () => {
    const result = PricingResolver.resolve({
      lines: [
        { productSkuId: 'sku-1', quantity: 2, basePrice: 100_000n, taxRateBasisPoints: null },
      ],
      coupon: null,
      defaultTaxRateBasisPoints: 0,
      shippingCost: 0n,
    });
    expect(result.subtotal).toBe(200_000n);
    expect(result.discountTotal).toBe(0n);
    expect(result.taxTotal).toBe(0n);
    expect(result.grandTotal).toBe(200_000n);
    expect(result.lines[0]?.resolvedUnitPrice).toBe(100_000n);
  });

  it('applies a percentage coupon and computes tax on the post-discount amount', () => {
    const result = PricingResolver.resolve({
      lines: [
        { productSkuId: 'sku-1', quantity: 1, basePrice: 1_000_000n, taxRateBasisPoints: 900 },
      ],
      coupon: { type: 'PERCENTAGE', value: 1000n, minOrderAmount: null, maxDiscountAmount: null }, // 10%
      defaultTaxRateBasisPoints: 0,
      shippingCost: 0n,
    });
    expect(result.discountTotal).toBe(100_000n);
    // taxable = 1,000,000 - 100,000 = 900,000; 9% of that = 81,000
    expect(result.taxTotal).toBe(81_000n);
    expect(result.grandTotal).toBe(1_000_000n - 100_000n + 81_000n);
  });

  it('falls back to the configured default tax rate when a SKU has none', () => {
    const result = PricingResolver.resolve({
      lines: [
        { productSkuId: 'sku-1', quantity: 1, basePrice: 1_000_000n, taxRateBasisPoints: null },
      ],
      coupon: null,
      defaultTaxRateBasisPoints: 500, // 5%
      shippingCost: 0n,
    });
    expect(result.taxTotal).toBe(50_000n);
    expect(result.lines[0]?.taxRateBasisPoints).toBe(500);
  });

  it('adds shipping to the grand total without taxing it', () => {
    const result = PricingResolver.resolve({
      lines: [
        { productSkuId: 'sku-1', quantity: 1, basePrice: 100_000n, taxRateBasisPoints: null },
      ],
      coupon: null,
      defaultTaxRateBasisPoints: 0,
      shippingCost: 30_000n,
    });
    expect(result.shippingTotal).toBe(30_000n);
    expect(result.grandTotal).toBe(130_000n);
  });

  it('splits discount proportionally across multiple lines and sums exactly', () => {
    const result = PricingResolver.resolve({
      lines: [
        { productSkuId: 'sku-1', quantity: 1, basePrice: 300_000n, taxRateBasisPoints: null },
        { productSkuId: 'sku-2', quantity: 1, basePrice: 700_000n, taxRateBasisPoints: null },
      ],
      coupon: {
        type: 'FIXED_AMOUNT',
        value: 100_000n,
        minOrderAmount: null,
        maxDiscountAmount: null,
      },
      defaultTaxRateBasisPoints: 0,
      shippingCost: 0n,
    });
    const totalLineDiscount = result.lines.reduce((sum, line) => sum + line.lineDiscount, 0n);
    expect(totalLineDiscount).toBe(100_000n);
    expect(result.grandTotal).toBe(900_000n);
  });

  it('never produces a negative grand total for a well-formed input', () => {
    const result = PricingResolver.resolve({
      lines: [{ productSkuId: 'sku-1', quantity: 1, basePrice: 10_000n, taxRateBasisPoints: null }],
      coupon: {
        type: 'FIXED_AMOUNT',
        value: 999_999n,
        minOrderAmount: null,
        maxDiscountAmount: null,
      },
      defaultTaxRateBasisPoints: 0,
      shippingCost: 0n,
    });
    expect(result.grandTotal >= 0n).toBe(true);
  });

  it('throws NegativeTotalError only in a truly pathological case (never in normal operation)', () => {
    // The resolver's own discount capping means a normal call can never
    // actually trigger this — this test documents the guard exists, not
    // a reachable-in-practice code path.
    expect(() =>
      PricingResolver.resolve({
        lines: [],
        coupon: null,
        defaultTaxRateBasisPoints: 0,
        shippingCost: -1n,
      }),
    ).toThrow(NegativeTotalError);
  });
});
