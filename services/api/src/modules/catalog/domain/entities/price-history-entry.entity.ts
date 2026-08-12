import { asProductSkuId, asUserId, type ProductSkuId, type UserId } from '@iecp/types';

/** blueprint §13 — append-only audit trail for price changes. */
export class PriceHistoryEntry {
  private constructor(
    public readonly id: string,
    public readonly productSkuId: ProductSkuId,
    public readonly oldPrice: bigint | null,
    public readonly newPrice: bigint,
    public readonly changedBy: UserId | null,
    public readonly reason: string | null,
    public readonly changedAt: Date,
  ) {}

  static create(props: {
    id: string;
    productSkuId: string;
    oldPrice?: bigint | null;
    newPrice: bigint;
    changedBy?: string | null;
    reason?: string | null;
    changedAt: Date;
  }): PriceHistoryEntry {
    return new PriceHistoryEntry(
      props.id,
      asProductSkuId(props.productSkuId),
      props.oldPrice ?? null,
      props.newPrice,
      props.changedBy ? asUserId(props.changedBy) : null,
      props.reason ?? null,
      props.changedAt,
    );
  }
}
