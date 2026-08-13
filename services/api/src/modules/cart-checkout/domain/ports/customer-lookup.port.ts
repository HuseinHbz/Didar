export const CUSTOMER_LOOKUP_PORT = Symbol('CUSTOMER_LOOKUP_PORT');

export interface CustomerLookupResult {
  id: string;
  defaultAddress: {
    id: string;
    recipientName: string;
    phone: string;
    province: string;
    city: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string | null;
  } | null;
}

/**
 * Minimal, Prisma-direct read of `customer.customers` (+ its default
 * `customer_addresses` row) by `identity.users.id` — same "minimal port,
 * no full domain import" precedent as Phase 006's `SkuLookupPort` (ADR-007
 * decision 11), justified here because no customer-registration module
 * exists in this repo yet to import from at all, not as a stylistic
 * choice against importing one.
 */
export interface CustomerLookupPort {
  findByUserId(userId: string): Promise<CustomerLookupResult | null>;
}
