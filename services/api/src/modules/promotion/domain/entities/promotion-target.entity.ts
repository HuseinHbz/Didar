import { asPromotionTargetId, type PromotionTargetId, type PromotionTargetType } from '@iecp/types';

/** ADR-010 decision 4 — composable, OR'd targeting. `refId` is an
 * unenforced pointer into `catalog` (product/SKU/category/brand/
 * collection id, per `type`). */
export class PromotionTarget {
  constructor(
    public readonly id: PromotionTargetId,
    public readonly promotionId: string,
    public readonly type: PromotionTargetType,
    public readonly refId: string,
  ) {}

  static fromPersistence(row: {
    id: string;
    promotionId: string;
    type: PromotionTargetType;
    refId: string;
  }): PromotionTarget {
    return new PromotionTarget(asPromotionTargetId(row.id), row.promotionId, row.type, row.refId);
  }
}
