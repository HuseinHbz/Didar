import {
  asCartId,
  asCartItemId,
  asProductSkuId,
  type CartId,
  type CartItemId,
  type ProductSkuId,
} from '@iecp/types';

/** `configurationHash` is a deterministic hash of `configurationSnapshot`
 * (empty string = no configuration) — two adds of the same SKU with the
 * same hash consolidate (quantity summed); different hashes stay distinct
 * lines. See `CartConsolidationRules` (domain service) for how the hash is
 * computed and applied. */
export class CartItem {
  private constructor(
    public readonly id: CartItemId,
    public readonly cartId: CartId,
    public readonly productSkuId: ProductSkuId,
    public readonly quantity: number,
    public readonly unitPriceSnapshot: bigint,
    public readonly currency: string,
    public readonly configurationSnapshot: Record<string, unknown> | null,
    public readonly configurationHash: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    cartId: string;
    productSkuId: string;
    quantity: number;
    unitPriceSnapshot: bigint;
    currency?: string;
    configurationSnapshot?: Record<string, unknown> | null;
    configurationHash?: string;
    createdAt: Date;
    updatedAt: Date;
  }): CartItem {
    return new CartItem(
      asCartItemId(props.id),
      asCartId(props.cartId),
      asProductSkuId(props.productSkuId),
      props.quantity,
      props.unitPriceSnapshot,
      props.currency ?? 'IRR',
      props.configurationSnapshot ?? null,
      props.configurationHash ?? '',
      props.createdAt,
      props.updatedAt,
    );
  }

  get lineSubtotal(): bigint {
    return this.unitPriceSnapshot * BigInt(this.quantity);
  }
}
