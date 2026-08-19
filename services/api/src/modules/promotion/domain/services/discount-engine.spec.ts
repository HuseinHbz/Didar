import { Promotion } from '../entities/promotion.entity';

import { DiscountEngine } from './discount-engine';

const PROMOTION_ID = '11111111-1111-4111-8111-111111111111';

function makePromotion(
  overrides: Partial<Parameters<typeof Promotion.fromPersistence>[0]>,
): Promotion {
  return Promotion.fromPersistence({
    id: PROMOTION_ID,
    name: 'Test promotion',
    description: null,
    status: 'ACTIVE',
    priority: 100,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perCustomerLimit: null,
    usageCount: 0,
    stackable: false,
    exclusive: false,
    minimumCartValue: null,
    maximumDiscount: null,
    currency: 'IRR',
    requiresCoupon: false,
    discountType: 'PERCENTAGE',
    discountValue: 1000n,
    buyQuantity: null,
    getQuantity: null,
    getDiscountBasisPoints: null,
    bundlePrice: null,
    rules: [],
    targets: [],
    ...overrides,
  });
}

describe('DiscountEngine', () => {
  const oneLine = [{ productSkuId: 'sku-1', quantity: 1, remaining: 1_000_000n }];
  const twoLines = [
    { productSkuId: 'sku-1', quantity: 1, remaining: 300_000n },
    { productSkuId: 'sku-2', quantity: 1, remaining: 700_000n },
  ];

  it('PERCENTAGE applies basis points and sums exactly across lines', () => {
    const promotion = makePromotion({ discountType: 'PERCENTAGE', discountValue: 1000n }); // 10%
    const result = DiscountEngine.compute(promotion, twoLines);
    expect(result.totalDiscount).toBe(100_000n);
    expect([...result.perLine.values()].reduce((sum, v) => sum + v, 0n)).toBe(100_000n);
  });

  it('FIXED_AMOUNT applies a flat amount, capped at the targeted total', () => {
    const promotion = makePromotion({ discountType: 'FIXED_AMOUNT', discountValue: 50_000n });
    const result = DiscountEngine.compute(promotion, oneLine);
    expect(result.totalDiscount).toBe(50_000n);
  });

  it('FIXED_AMOUNT never discounts more than the targeted subtotal (zero-price protection)', () => {
    const promotion = makePromotion({ discountType: 'FIXED_AMOUNT', discountValue: 999_999_999n });
    const result = DiscountEngine.compute(promotion, [
      { productSkuId: 'sku-1', quantity: 1, remaining: 10_000n },
    ]);
    expect(result.totalDiscount).toBe(10_000n);
  });

  it('FIXED_PRICE forces the targeted total down to the given price', () => {
    const promotion = makePromotion({ discountType: 'FIXED_PRICE', discountValue: 700_000n });
    const result = DiscountEngine.compute(promotion, oneLine);
    expect(result.totalDiscount).toBe(300_000n);
  });

  it('FIXED_PRICE above the current subtotal is a no-op, never a markup', () => {
    const promotion = makePromotion({ discountType: 'FIXED_PRICE', discountValue: 2_000_000n });
    const result = DiscountEngine.compute(promotion, oneLine);
    expect(result.totalDiscount).toBe(0n);
  });

  it('BUNDLE_PRICE uses the same math as FIXED_PRICE against bundlePrice', () => {
    const promotion = makePromotion({ discountType: 'BUNDLE_PRICE', bundlePrice: 600_000n });
    const result = DiscountEngine.compute(promotion, twoLines);
    expect(result.totalDiscount).toBe(400_000n);
  });

  it('FREE_SHIPPING never discounts a line, only signals shippingWaived', () => {
    const promotion = makePromotion({ discountType: 'FREE_SHIPPING', discountValue: null });
    const result = DiscountEngine.compute(promotion, oneLine);
    expect(result.totalDiscount).toBe(0n);
    expect(result.freeShipping).toBe(true);
  });

  it('BUY_X_GET_Y discounts the cheapest units first', () => {
    // buy 2 get 1 at 100% off (free) — 3 units of 100,000 each: cheapest
    // (only) unit in the one full chunk is free.
    const promotion = makePromotion({
      discountType: 'BUY_X_GET_Y',
      buyQuantity: 2,
      getQuantity: 1,
      getDiscountBasisPoints: 10_000, // 100% off
    });
    const result = DiscountEngine.compute(promotion, [
      { productSkuId: 'sku-1', quantity: 3, remaining: 300_000n }, // 100,000/unit
    ]);
    expect(result.totalDiscount).toBe(100_000n);
  });

  it('BUY_X_GET_Y applies nothing when the cart has less than one full chunk', () => {
    const promotion = makePromotion({
      discountType: 'BUY_X_GET_Y',
      buyQuantity: 2,
      getQuantity: 1,
      getDiscountBasisPoints: 10_000,
    });
    const result = DiscountEngine.compute(promotion, [
      { productSkuId: 'sku-1', quantity: 2, remaining: 200_000n },
    ]);
    expect(result.totalDiscount).toBe(0n);
  });

  it('caps every discount type at maximumDiscount', () => {
    const promotion = makePromotion({
      discountType: 'PERCENTAGE',
      discountValue: 5000n, // 50%
      maximumDiscount: 100_000n,
    });
    const result = DiscountEngine.compute(promotion, oneLine);
    expect(result.totalDiscount).toBe(100_000n);
  });

  it('allocates a rounding remainder deterministically without losing a Rial', () => {
    const promotion = makePromotion({ discountType: 'FIXED_AMOUNT', discountValue: 10n });
    const result = DiscountEngine.compute(promotion, [
      { productSkuId: 'sku-a', quantity: 1, remaining: 1n },
      { productSkuId: 'sku-b', quantity: 1, remaining: 1n },
      { productSkuId: 'sku-c', quantity: 1, remaining: 1n },
    ]);
    expect([...result.perLine.values()].reduce((sum, v) => sum + v, 0n)).toBe(3n);
  });
});
