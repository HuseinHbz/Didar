import { InvalidPromotionTransitionError } from '../errors/promotion-domain.errors';

import { PromotionLifecycle } from './promotion-lifecycle';

describe('PromotionLifecycle', () => {
  it('allows DRAFT -> ACTIVE', () => {
    expect(PromotionLifecycle.canTransition('DRAFT', 'ACTIVE')).toBe(true);
  });

  it('allows ACTIVE -> PAUSED -> ACTIVE', () => {
    expect(PromotionLifecycle.canTransition('ACTIVE', 'PAUSED')).toBe(true);
    expect(PromotionLifecycle.canTransition('PAUSED', 'ACTIVE')).toBe(true);
  });

  it('rejects ARCHIVED -> ACTIVE (terminal)', () => {
    expect(PromotionLifecycle.canTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(() => {
      PromotionLifecycle.assertTransition('ARCHIVED', 'ACTIVE');
    }).toThrow(InvalidPromotionTransitionError);
  });

  it('rejects EXPIRED -> ACTIVE (never reversible)', () => {
    expect(PromotionLifecycle.canTransition('EXPIRED', 'ACTIVE')).toBe(false);
  });

  it('treats a same-status transition as a no-op, not an error', () => {
    expect(PromotionLifecycle.isNoOp('ACTIVE', 'ACTIVE')).toBe(true);
    expect(PromotionLifecycle.canTransition('ACTIVE', 'ACTIVE')).toBe(true);
  });
});
