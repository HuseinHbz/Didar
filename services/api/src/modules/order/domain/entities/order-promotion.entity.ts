import { asOrderId, asOrderPromotionId, type OrderId, type OrderPromotionId } from '@iecp/types';

/** Phase 010's immutable per-order promotion snapshot (ADR-010 decision
 * 7/11), read-only from this module's point of view — `order` never
 * writes these rows itself (`OrderConversionService` does, via
 * `OrderRepositoryPort.addPromotions()`), it only reads them back for
 * the order detail response (ADR-011 decision 7). `promotionId`/
 * `couponId` are unenforced cross-schema pointers into `marketing`;
 * `promotionName`/`couponCode`/`discountType` are plain strings copied
 * verbatim at order-creation time, never re-read from the live
 * promotion — this row is historical truth, not a live join. */
export class OrderPromotion {
  private constructor(
    public readonly id: OrderPromotionId,
    public readonly orderId: OrderId,
    public readonly promotionId: string,
    public readonly promotionName: string,
    public readonly couponId: string | null,
    public readonly couponCode: string | null,
    public readonly discountType: string,
    public readonly discountAmount: bigint,
    public readonly affectedItemIds: readonly string[],
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    orderId: string;
    promotionId: string;
    promotionName: string;
    couponId: string | null;
    couponCode: string | null;
    discountType: string;
    discountAmount: bigint;
    affectedItemIds: readonly string[];
    createdAt: Date;
  }): OrderPromotion {
    return new OrderPromotion(
      asOrderPromotionId(props.id),
      asOrderId(props.orderId),
      props.promotionId,
      props.promotionName,
      props.couponId,
      props.couponCode,
      props.discountType,
      props.discountAmount,
      props.affectedItemIds,
      props.createdAt,
    );
  }
}
