import { CouponCode } from './coupon-code';

describe('CouponCode', () => {
  it('normalizes case and surrounding whitespace to one canonical form', () => {
    expect(CouponCode.normalize('didar20')).toBe('DIDAR20');
    expect(CouponCode.normalize('  DiDaR20  ')).toBe('DIDAR20');
    expect(CouponCode.normalize('DIDAR20')).toBe('DIDAR20');
  });

  it('accepts a well-formed code shape', () => {
    expect(CouponCode.isValidShape('DIDAR20')).toBe(true);
    expect(CouponCode.isValidShape('WELCOME-500')).toBe(true);
  });

  it('rejects a malformed code shape', () => {
    expect(CouponCode.isValidShape('AB')).toBe(false); // too short
    expect(CouponCode.isValidShape('has spaces')).toBe(false);
    expect(CouponCode.isValidShape('')).toBe(false);
  });
});
