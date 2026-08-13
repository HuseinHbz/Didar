import {
  asCartItemId,
  asCartItemOptionId,
  type CartItemId,
  type CartItemOptionId,
  type CartItemOptionType,
} from '@iecp/types';

/** `optionKey` is always a *reference* (an id), never raw sensitive data —
 * `PRESCRIPTION_REFERENCE`'s key is a prescription id, never SPH/CYL/AXIS
 * values themselves (the brief's own rule, ADR-007 decision 9). */
export class CartItemOption {
  private constructor(
    public readonly id: CartItemOptionId,
    public readonly cartItemId: CartItemId,
    public readonly optionType: CartItemOptionType,
    public readonly optionKey: string,
    public readonly optionLabel: string | null,
    public readonly priceAdjustment: bigint | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    cartItemId: string;
    optionType: CartItemOptionType;
    optionKey: string;
    optionLabel?: string | null;
    priceAdjustment?: bigint | null;
    createdAt: Date;
  }): CartItemOption {
    return new CartItemOption(
      asCartItemOptionId(props.id),
      asCartItemId(props.cartItemId),
      props.optionType,
      props.optionKey,
      props.optionLabel ?? null,
      props.priceAdjustment ?? null,
      props.createdAt,
    );
  }
}
