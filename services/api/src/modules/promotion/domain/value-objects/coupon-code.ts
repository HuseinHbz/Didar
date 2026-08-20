/** ADR-010 decision 2 — `Coupon.code` is stored/looked-up normalized so
 * `didar20`/`DIDAR20`/` DiDaR20 ` all resolve to one row. Applied at
 * every write and every lookup, never left to caller discipline. */
export class CouponCode {
  static normalize(raw: string): string {
    return raw.trim().toUpperCase();
  }

  static isValidShape(normalized: string): boolean {
    // 3-32 chars, letters/digits/underscore/hyphen only — generous enough
    // for real promo codes, tight enough to reject obvious junk before a
    // DB round trip.
    return /^[A-Z0-9_-]{3,32}$/.test(normalized);
  }
}
