export const CUSTOMER_CONTEXT_PORT = Symbol('CUSTOMER_CONTEXT_PORT');

/** Minimal, read-only cross-module port (same "minimal port" precedent
 * `CouponLookupPort`/`CustomerLookupPort` already established, ADR-007
 * decision 8) — reuses `customer.CustomerSegment` (real, Phase 007) and
 * `commerce.orders` for the `FIRST_PURCHASE_ONLY` rule (ADR-010 decision
 * 6), never re-implemented here. */
export interface CustomerContextPort {
  /** Segment `key`s (e.g. `"vip"`) this customer is a member of. Guests
   * (`customerId === null`) always resolve to an empty array. */
  listSegmentKeys(customerId: string | null): Promise<string[]>;
  /** True if this customer has zero prior orders in a non-cancelled
   * state. Guests always resolve to `true` (never disqualified from a
   * first-purchase promotion purely for being a guest). */
  isFirstPurchase(customerId: string | null): Promise<boolean>;
}
