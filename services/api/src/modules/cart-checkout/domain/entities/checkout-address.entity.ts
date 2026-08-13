import {
  asCheckoutAddressId,
  asCheckoutSessionId,
  type CheckoutAddressId,
  type CheckoutSessionId,
} from '@iecp/types';

/** Snapshotted at checkout time — from a real `customer.customer_addresses`
 * row (`customerAddressId` set) or freeform guest input (`null`). Never
 * re-read live afterward (order ≠ live product, extended to addresses). */
export class CheckoutAddress {
  private constructor(
    public readonly id: CheckoutAddressId,
    public readonly checkoutSessionId: CheckoutSessionId,
    public readonly customerAddressId: string | null,
    public readonly recipientName: string,
    public readonly phone: string,
    public readonly province: string,
    public readonly city: string,
    public readonly addressLine1: string,
    public readonly addressLine2: string | null,
    public readonly postalCode: string | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    checkoutSessionId: string;
    customerAddressId?: string | null;
    recipientName: string;
    phone: string;
    province: string;
    city: string;
    addressLine1: string;
    addressLine2?: string | null;
    postalCode?: string | null;
    createdAt: Date;
  }): CheckoutAddress {
    return new CheckoutAddress(
      asCheckoutAddressId(props.id),
      asCheckoutSessionId(props.checkoutSessionId),
      props.customerAddressId ?? null,
      props.recipientName,
      props.phone,
      props.province,
      props.city,
      props.addressLine1,
      props.addressLine2 ?? null,
      props.postalCode ?? null,
      props.createdAt,
    );
  }
}
