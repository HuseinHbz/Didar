import { Promotion } from '../entities/promotion.entity';

import type { EligibilityCartLine, EligibilityContext } from './eligibility-engine';
import { PromotionResolver } from './promotion-resolver';

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

function makePromotion(
  overrides: Partial<Parameters<typeof Promotion.fromPersistence>[0]>,
): Promotion {
  return Promotion.fromPersistence({
    id: ID_A,
    name: 'Test',
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

const ctx: EligibilityContext = {
  now: new Date('2026-06-01T00:00:00Z'),
  customerId: null,
  cartSubtotal: 1_000_000n,
  customerSegmentKeys: [],
  isFirstPurchase: false,
  promotionUsageCounts: new Map(),
  promotionCustomerUsageCounts: new Map(),
  couponUsageCounts: new Map(),
  couponCustomerUsageCounts: new Map(),
};

const lines: EligibilityCartLine[] = [
  {
    productSkuId: 'sku-1',
    productId: 'prod-1',
    categoryIds: [],
    brandId: null,
    collectionIds: [],
    quantity: 1,
    lineSubtotal: 1_000_000n,
  },
];

describe('PromotionResolver', () => {
  it('resolves an empty candidate list to no discount', () => {
    const result = PromotionResolver.resolve(lines, [], ctx);
    expect(result.discountTotal).toBe(0n);
    expect(result.accepted).toHaveLength(0);
  });

  it('accepts a single eligible automatic promotion', () => {
    const promotion = makePromotion({ id: ID_A, discountType: 'PERCENTAGE', discountValue: 1000n });
    const result = PromotionResolver.resolve(lines, [{ promotion, coupon: null }], ctx);
    expect(result.discountTotal).toBe(100_000n);
    expect(result.accepted).toHaveLength(1);
  });

  it('orders acceptance by priority ASC, never by input array order', () => {
    const low = makePromotion({
      id: ID_A,
      priority: 1,
      discountType: 'FIXED_AMOUNT',
      discountValue: 10_000n,
      exclusive: true,
    });
    const high = makePromotion({
      id: ID_B,
      priority: 999,
      discountType: 'FIXED_AMOUNT',
      discountValue: 20_000n,
      exclusive: true,
    });
    // Input order deliberately reversed from priority order.
    const result = PromotionResolver.resolve(
      lines,
      [
        { promotion: high, coupon: null },
        { promotion: low, coupon: null },
      ],
      ctx,
    );
    // Both exclusive: only the lower-priority one (accepted first) wins.
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.promotionId).toBe(ID_A);
  });

  it('is deterministic: same input always produces the same result', () => {
    const a = makePromotion({ id: ID_A, priority: 5 });
    const b = makePromotion({ id: ID_B, priority: 5, stackable: true });
    const candidates = [
      { promotion: b, coupon: null },
      { promotion: a, coupon: null },
    ];
    const first = PromotionResolver.resolve(lines, candidates, ctx);
    const second = PromotionResolver.resolve(lines, candidates, ctx);
    expect(first.discountTotal).toBe(second.discountTotal);
    expect(first.accepted.map((x) => x.promotionId)).toEqual(
      second.accepted.map((x) => x.promotionId),
    );
  });

  describe('stacking and exclusivity', () => {
    it('an exclusive promotion locks out every other candidate', () => {
      const exclusive = makePromotion({
        id: ID_A,
        priority: 1,
        exclusive: true,
        discountType: 'FIXED_AMOUNT',
        discountValue: 50_000n,
      });
      const other = makePromotion({
        id: ID_B,
        priority: 2,
        stackable: true,
        discountType: 'FIXED_AMOUNT',
        discountValue: 10_000n,
      });
      const result = PromotionResolver.resolve(
        lines,
        [
          { promotion: exclusive, coupon: null },
          { promotion: other, coupon: null },
        ],
        ctx,
      );
      expect(result.accepted).toHaveLength(1);
      expect(result.accepted[0]?.promotionId).toBe(ID_A);
    });

    it('two stackable promotions both apply', () => {
      const a = makePromotion({
        id: ID_A,
        priority: 1,
        stackable: true,
        discountType: 'FIXED_AMOUNT',
        discountValue: 10_000n,
      });
      const b = makePromotion({
        id: ID_B,
        priority: 2,
        stackable: true,
        discountType: 'FIXED_AMOUNT',
        discountValue: 20_000n,
      });
      const result = PromotionResolver.resolve(
        lines,
        [
          { promotion: a, coupon: null },
          { promotion: b, coupon: null },
        ],
        ctx,
      );
      expect(result.accepted).toHaveLength(2);
      expect(result.discountTotal).toBe(30_000n);
    });

    it('a non-stackable base blocks a later non-stackable promotion but not a stackable one', () => {
      const base = makePromotion({
        id: ID_A,
        priority: 1,
        stackable: false,
        discountType: 'FIXED_AMOUNT',
        discountValue: 10_000n,
      });
      const otherBase = makePromotion({
        id: ID_B,
        priority: 2,
        stackable: false,
        discountType: 'FIXED_AMOUNT',
        discountValue: 20_000n,
      });
      const stackable = makePromotion({
        id: ID_C,
        priority: 3,
        stackable: true,
        discountType: 'FIXED_AMOUNT',
        discountValue: 5_000n,
      });
      const result = PromotionResolver.resolve(
        lines,
        [
          { promotion: base, coupon: null },
          { promotion: otherBase, coupon: null },
          { promotion: stackable, coupon: null },
        ],
        ctx,
      );
      const acceptedIds = result.accepted.map((x) => x.promotionId);
      expect(acceptedIds).toContain(ID_A);
      expect(acceptedIds).not.toContain(ID_B);
      expect(acceptedIds).toContain(ID_C);
    });
  });

  it('compounds two stacked percentage promotions multiplicatively, not additively', () => {
    // 20% then 10% of the remaining amount = 1,000,000 * 0.8 * 0.9 =
    // 720,000 remaining -> 280,000 total discount, not 300,000 (30%
    // additive would be wrong per ADR-010 decision 5).
    const first = makePromotion({
      id: ID_A,
      priority: 1,
      stackable: true,
      discountType: 'PERCENTAGE',
      discountValue: 2000n,
    });
    const second = makePromotion({
      id: ID_B,
      priority: 2,
      stackable: true,
      discountType: 'PERCENTAGE',
      discountValue: 1000n,
    });
    const result = PromotionResolver.resolve(
      lines,
      [
        { promotion: first, coupon: null },
        { promotion: second, coupon: null },
      ],
      ctx,
    );
    expect(result.discountTotal).toBe(280_000n);
  });

  it('surfaces freeShipping when a FREE_SHIPPING promotion is accepted', () => {
    const promotion = makePromotion({
      id: ID_A,
      discountType: 'FREE_SHIPPING',
      discountValue: null,
    });
    const result = PromotionResolver.resolve(lines, [{ promotion, coupon: null }], ctx);
    expect(result.freeShipping).toBe(true);
    expect(result.discountTotal).toBe(0n);
  });
});
