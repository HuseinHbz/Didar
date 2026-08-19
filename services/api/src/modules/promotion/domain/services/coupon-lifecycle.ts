import type { CouponStatus } from '@iecp/types';

import { InvalidCouponTransitionError } from '../errors/promotion-domain.errors';

/** ADR-010 decision 2 — `ACTIVE <-> PAUSED`, either `-> DISABLED`
 * (terminal, admin-only), `ACTIVE|PAUSED -> EXPIRED` (automatic once
 * `expiresAt` passes). A `DISABLED` coupon never reactivates
 * automatically. */
const TRANSITIONS: Record<CouponStatus, readonly CouponStatus[]> = {
  ACTIVE: ['PAUSED', 'DISABLED', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'DISABLED', 'EXPIRED'],
  EXPIRED: ['DISABLED'],
  DISABLED: [],
};

export class CouponLifecycle {
  static canTransition(from: CouponStatus, to: CouponStatus): boolean {
    if (from === to) return true;
    return TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: CouponStatus, to: CouponStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidCouponTransitionError(from, to);
    }
  }

  static isNoOp(from: CouponStatus, to: CouponStatus): boolean {
    return from === to;
  }
}
