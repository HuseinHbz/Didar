import { InvalidCouponTransitionError } from '../errors/promotion-domain.errors';

import { CouponLifecycle } from './coupon-lifecycle';

describe('CouponLifecycle', () => {
  it('allows ACTIVE <-> PAUSED', () => {
    expect(CouponLifecycle.canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(CouponLifecycle.canTransition('PAUSED', 'ACTIVE')).toBe(true);
  });

  it('allows ACTIVE -> DISABLED, terminal', () => {
    expect(CouponLifecycle.canTransition('ACTIVE', 'DISABLED')).toBe(true);
    expect(CouponLifecycle.canTransition('DISABLED', 'ACTIVE')).toBe(false);
  });

  it('a DISABLED coupon never reactivates automatically', () => {
    expect(() => {
      CouponLifecycle.assertTransition('DISABLED', 'ACTIVE');
    }).toThrow(InvalidCouponTransitionError);
  });

  it('treats a same-status transition as a no-op', () => {
    expect(CouponLifecycle.isNoOp('PAUSED', 'PAUSED')).toBe(true);
  });
});
