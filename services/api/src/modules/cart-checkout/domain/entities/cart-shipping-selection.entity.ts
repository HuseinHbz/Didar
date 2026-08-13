import {
  asCartId,
  asCartShippingSelectionId,
  asShippingMethodId,
  type CartId,
  type CartShippingSelectionId,
  type ShippingMethodId,
} from '@iecp/types';

export class CartShippingSelection {
  private constructor(
    public readonly id: CartShippingSelectionId,
    public readonly cartId: CartId,
    public readonly shippingMethodId: ShippingMethodId,
    public readonly estimatedCost: bigint,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    cartId: string;
    shippingMethodId: string;
    estimatedCost: bigint;
    createdAt: Date;
    updatedAt: Date;
  }): CartShippingSelection {
    return new CartShippingSelection(
      asCartShippingSelectionId(props.id),
      asCartId(props.cartId),
      asShippingMethodId(props.shippingMethodId),
      props.estimatedCost,
      props.createdAt,
      props.updatedAt,
    );
  }
}
