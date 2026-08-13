import { asCartId, asCustomerId, type CartId, type CartStatus, type CustomerId } from '@iecp/types';

/** blueprint §16 — the long-lived, freely-mutable basket (ADR-007 decision
 * 1). `guestToken` (opaque, 256-bit) XOR `customerId` identify the owner;
 * both null only transiently mid-merge. `customerId` points at
 * `customer.customers.id`, not `identity.users.id` (ADR-007 decision 11). */
export class Cart {
  private constructor(
    public readonly id: CartId,
    public readonly customerId: CustomerId | null,
    public readonly guestToken: string | null,
    public readonly status: CartStatus,
    public readonly currency: string,
    public readonly expiresAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    customerId?: string | null;
    guestToken?: string | null;
    status?: CartStatus;
    currency?: string;
    expiresAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): Cart {
    return new Cart(
      asCartId(props.id),
      props.customerId ? asCustomerId(props.customerId) : null,
      props.guestToken ?? null,
      props.status ?? 'ACTIVE',
      props.currency ?? 'IRR',
      props.expiresAt ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  get isGuest(): boolean {
    return this.customerId === null;
  }

  get isActive(): boolean {
    return this.status === 'ACTIVE';
  }
}
