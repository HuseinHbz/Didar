import { Coupon } from '../entities/coupon.entity';
import { PromotionRule } from '../entities/promotion-rule.entity';
import { PromotionTarget } from '../entities/promotion-target.entity';
import { Promotion } from '../entities/promotion.entity';

import {
  EligibilityEngine,
  type EligibilityCartLine,
  type EligibilityContext,
} from './eligibility-engine';

const PROMOTION_ID = '11111111-1111-4111-8111-111111111111';
const COUPON_ID = '22222222-2222-4222-8222-222222222222';
const RULE_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_ID = '44444444-4444-4444-8444-444444444444';

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

function makeCoupon(overrides: Partial<Parameters<typeof Coupon.fromPersistence>[0]> = {}): Coupon {
  return Coupon.fromPersistence({
    id: COUPON_ID,
    promotionId: PROMOTION_ID,
    code: 'TESTCODE',
    status: 'ACTIVE',
    startsAt: null,
    expiresAt: null,
    usageLimit: null,
    usageCount: 0,
    perCustomerLimit: null,
    metadata: null,
    ...overrides,
  });
}

const baseCtx: EligibilityContext = {
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

const line: EligibilityCartLine = {
  productSkuId: 'sku-1',
  productId: 'prod-1',
  categoryIds: ['cat-1'],
  brandId: 'brand-1',
  collectionIds: [],
  quantity: 1,
  lineSubtotal: 1_000_000n,
};

describe('EligibilityEngine', () => {
  it('is eligible for an ACTIVE, untargeted, unconditioned automatic promotion', () => {
    const promotion = makePromotion({});
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(true);
  });

  it('rejects a non-ACTIVE promotion', () => {
    const promotion = makePromotion({ status: 'PAUSED' });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
  });

  it('rejects outside its date window (not yet started)', () => {
    const promotion = makePromotion({ startsAt: new Date('2026-12-01T00:00:00Z') });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
  });

  it('rejects outside its date window (already ended)', () => {
    const promotion = makePromotion({ endsAt: new Date('2026-01-01T00:00:00Z') });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
  });

  it('rejects when the cart subtotal is below minimumCartValue', () => {
    const promotion = makePromotion({ minimumCartValue: 2_000_000n });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
  });

  it('rejects when no cart line matches its targets', () => {
    const promotion = makePromotion({
      targets: [
        PromotionTarget.fromPersistence({
          id: TARGET_ID,
          promotionId: PROMOTION_ID,
          type: 'CATEGORY',
          refId: 'other-category',
        }),
      ],
    });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
  });

  it('accepts when a cart line matches a CATEGORY target', () => {
    const promotion = makePromotion({
      targets: [
        PromotionTarget.fromPersistence({
          id: TARGET_ID,
          promotionId: PROMOTION_ID,
          type: 'CATEGORY',
          refId: 'cat-1',
        }),
      ],
    });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(true);
  });

  it('MINIMUM_QUANTITY rule rejects a cart under the threshold', () => {
    const promotion = makePromotion({
      rules: [
        PromotionRule.fromPersistence({
          id: RULE_ID,
          promotionId: PROMOTION_ID,
          type: 'MINIMUM_QUANTITY',
          config: { minimumQuantity: 5 },
        }),
      ],
    });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
  });

  it('CUSTOMER_SEGMENT rule requires membership', () => {
    const promotion = makePromotion({
      rules: [
        PromotionRule.fromPersistence({
          id: RULE_ID,
          promotionId: PROMOTION_ID,
          type: 'CUSTOMER_SEGMENT',
          config: { customerSegmentKey: 'vip' },
        }),
      ],
    });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
    expect(
      EligibilityEngine.isEligible({ promotion, coupon: null }, [line], {
        ...baseCtx,
        customerSegmentKeys: ['vip'],
      }),
    ).toBe(true);
  });

  it('FIRST_PURCHASE_ONLY rule requires the context flag', () => {
    const promotion = makePromotion({
      rules: [
        PromotionRule.fromPersistence({
          id: RULE_ID,
          promotionId: PROMOTION_ID,
          type: 'FIRST_PURCHASE_ONLY',
          config: {},
        }),
      ],
    });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
    expect(
      EligibilityEngine.isEligible({ promotion, coupon: null }, [line], {
        ...baseCtx,
        isFirstPurchase: true,
      }),
    ).toBe(true);
  });

  it('rejects a promotion at its global usage limit', () => {
    const promotion = makePromotion({ usageLimit: 1 });
    const ctx = { ...baseCtx, promotionUsageCounts: new Map([[PROMOTION_ID, 1]]) };
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], ctx)).toBe(false);
  });

  it('rejects a promotion at its per-customer usage limit', () => {
    const promotion = makePromotion({ perCustomerLimit: 1 });
    const ctx = {
      ...baseCtx,
      customerId: 'cust-1',
      promotionCustomerUsageCounts: new Map([[PROMOTION_ID, 1]]),
    };
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], ctx)).toBe(false);
  });

  it('requires a matching coupon for a coupon-gated promotion', () => {
    const promotion = makePromotion({ requiresCoupon: true });
    expect(EligibilityEngine.isEligible({ promotion, coupon: null }, [line], baseCtx)).toBe(false);
    expect(EligibilityEngine.isEligible({ promotion, coupon: makeCoupon() }, [line], baseCtx)).toBe(
      true,
    );
  });

  it('rejects an expired coupon', () => {
    const promotion = makePromotion({ requiresCoupon: true });
    const coupon = makeCoupon({ expiresAt: new Date('2026-01-01T00:00:00Z') });
    expect(EligibilityEngine.isEligible({ promotion, coupon }, [line], baseCtx)).toBe(false);
  });

  it('rejects a not-yet-valid (future) coupon', () => {
    const promotion = makePromotion({ requiresCoupon: true });
    const coupon = makeCoupon({ startsAt: new Date('2026-12-01T00:00:00Z') });
    expect(EligibilityEngine.isEligible({ promotion, coupon }, [line], baseCtx)).toBe(false);
  });

  it('rejects a DISABLED coupon', () => {
    const promotion = makePromotion({ requiresCoupon: true });
    const coupon = makeCoupon({ status: 'DISABLED' });
    expect(EligibilityEngine.isEligible({ promotion, coupon }, [line], baseCtx)).toBe(false);
  });
});
