import type { CustomerAddressId, CustomerId } from '@iecp/types';

import type { CustomerAddress } from '../entities/customer-address.entity';

export const CUSTOMER_ADDRESS_REPOSITORY = Symbol('CUSTOMER_ADDRESS_REPOSITORY');

export interface CustomerAddressRepositoryPort {
  listByCustomer(customerId: CustomerId): Promise<CustomerAddress[]>;
  findById(id: CustomerAddressId): Promise<CustomerAddress | null>;
  create(props: {
    customerId: CustomerId;
    label: string | null;
    recipientName: string;
    phone: string;
    province: string;
    city: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string | null;
    /** Whether the caller asked for this to be the default. The
     * repository — not the caller — resolves what that means (first
     * address for a customer is always default regardless of this
     * flag; see `PrismaCustomerAddressRepository.create()`). */
    isDefault: boolean;
  }): Promise<CustomerAddress>;
  update(
    id: CustomerAddressId,
    props: Partial<{
      label: string | null;
      recipientName: string;
      phone: string;
      province: string;
      city: string;
      addressLine1: string;
      addressLine2: string | null;
      postalCode: string | null;
    }>,
  ): Promise<CustomerAddress>;
  /** Soft-deletes and, if the deleted address was the default, promotes
   * the customer's next-most-recently-created remaining address to
   * default (deterministic — see this module's README). No-op-safe: an
   * already-deleted id throws `AddressNotFoundError` from the calling
   * use case, not from here (existence is checked before this is
   * called). */
  softDelete(id: CustomerAddressId): Promise<void>;
  /** Atomically makes `id` the sole default address for its customer —
   * clears any other default first, in the same transaction, backstopped
   * by `customer_addresses_one_default_per_customer` (partial unique
   * index) against concurrent callers. */
  setDefault(id: CustomerAddressId, customerId: CustomerId): Promise<CustomerAddress>;
}
