import { asCustomerAddressId, asCustomerId, type CustomerAddressId, type CustomerId } from '@iecp/types';

export class CustomerAddress {
  private constructor(
    public readonly id: CustomerAddressId,
    public readonly customerId: CustomerId,
    public readonly label: string | null,
    public readonly recipientName: string,
    public readonly phone: string,
    public readonly province: string,
    public readonly city: string,
    public readonly addressLine1: string,
    public readonly addressLine2: string | null,
    public readonly postalCode: string | null,
    public readonly isDefault: boolean,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    customerId: string;
    label?: string | null;
    recipientName: string;
    phone: string;
    province: string;
    city: string;
    addressLine1: string;
    addressLine2?: string | null;
    postalCode?: string | null;
    isDefault?: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): CustomerAddress {
    return new CustomerAddress(
      asCustomerAddressId(props.id),
      asCustomerId(props.customerId),
      props.label ?? null,
      props.recipientName,
      props.phone,
      props.province,
      props.city,
      props.addressLine1,
      props.addressLine2 ?? null,
      props.postalCode ?? null,
      props.isDefault ?? false,
      props.createdAt,
      props.updatedAt,
    );
  }
}
