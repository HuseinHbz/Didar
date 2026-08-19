/** Thrown by `CouponResolver`/application services when a supplied coupon
 * code cannot be applied right now — deliberately generic (ADR-010
 * decision 2's no-enumeration-leakage requirement): the same error/message
 * shape covers "doesn't exist," "disabled," "expired," "not yet valid,"
 * and "cart doesn't qualify," so a caller brute-forcing codes gets no
 * signal distinguishing them. */
export class CouponNotApplicableError extends Error {
  constructor(message = 'Coupon is not applicable') {
    super(message);
    this.name = 'CouponNotApplicableError';
  }
}

/** Thrown only by admin-facing lifecycle transitions, where leaking
 * "which state it's in" is not a security concern (the caller is already
 * authorized to manage promotions). */
export class InvalidPromotionTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition promotion from ${from} to ${to}`);
    this.name = 'InvalidPromotionTransitionError';
  }
}

export class InvalidCouponTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition coupon from ${from} to ${to}`);
    this.name = 'InvalidCouponTransitionError';
  }
}

/** Thrown when a reservation attempt loses the capacity race — the
 * caller (application layer) must treat this as "no slot available,"
 * never retry-until-success (ADR-010 decision 8). */
export class CouponUsageLimitExceededError extends Error {
  constructor(message = 'Coupon usage limit reached') {
    super(message);
    this.name = 'CouponUsageLimitExceededError';
  }
}
