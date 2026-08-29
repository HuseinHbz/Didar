import { asCustomerId, asUserId, type CustomerId, type UserId } from '@iecp/types';

/** Mirrors `customer.customers` (Phase 004) — CP-019 is the first phase to
 * actually read/write this table through application code (previously
 * only `cart-checkout`'s read-only `PrismaCustomerLookupRepository`
 * touched it, for ownership checks alone). */
export class Customer {
  private constructor(
    public readonly id: CustomerId,
    public readonly userId: UserId,
    public readonly firstName: string,
    public readonly lastName: string,
    public readonly nationalId: string | null,
    public readonly birthDate: Date | null,
    public readonly gender: 'MALE' | 'FEMALE' | 'OTHER' | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    nationalId?: string | null;
    birthDate?: Date | null;
    gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
    createdAt: Date;
    updatedAt: Date;
  }): Customer {
    return new Customer(
      asCustomerId(props.id),
      asUserId(props.userId),
      props.firstName,
      props.lastName,
      props.nationalId ?? null,
      props.birthDate ?? null,
      props.gender ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
