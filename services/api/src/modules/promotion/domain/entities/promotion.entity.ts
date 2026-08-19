import {
  asPromotionId,
  type PromotionActionType,
  type PromotionId,
  type PromotionStatus,
} from '@iecp/types';

import type { PromotionRule } from './promotion-rule.entity';
import type { PromotionTarget } from './promotion-target.entity';

/** Aggregate root (ADR-010 decision 1). Discount-action fields
 * (`discountType`..`bundlePrice`) live directly on the promotion — see
 * the schema comment for why no separate `PromotionAction` table exists. */
export class Promotion {
  constructor(
    public readonly id: PromotionId,
    public readonly name: string,
    public readonly description: string | null,
    public readonly status: PromotionStatus,
    public readonly priority: number,
    public readonly startsAt: Date | null,
    public readonly endsAt: Date | null,
    public readonly usageLimit: number | null,
    public readonly perCustomerLimit: number | null,
    public readonly usageCount: number,
    public readonly stackable: boolean,
    public readonly exclusive: boolean,
    public readonly minimumCartValue: bigint | null,
    public readonly maximumDiscount: bigint | null,
    public readonly currency: string,
    public readonly requiresCoupon: boolean,
    public readonly discountType: PromotionActionType,
    public readonly discountValue: bigint | null,
    public readonly buyQuantity: number | null,
    public readonly getQuantity: number | null,
    public readonly getDiscountBasisPoints: number | null,
    public readonly bundlePrice: bigint | null,
    public readonly rules: readonly PromotionRule[],
    public readonly targets: readonly PromotionTarget[],
  ) {}

  /** Zero target rows means "whole cart" (ADR-010 decision 4) —
   * unambiguous, never a separate `ALL` sentinel. */
  get targetsWholeCart(): boolean {
    return this.targets.length === 0;
  }

  isWithinWindow(now: Date): boolean {
    if (this.startsAt && now < this.startsAt) return false;
    if (this.endsAt && now > this.endsAt) return false;
    return true;
  }

  static fromPersistence(row: {
    id: string;
    name: string;
    description: string | null;
    status: PromotionStatus;
    priority: number;
    startsAt: Date | null;
    endsAt: Date | null;
    usageLimit: number | null;
    perCustomerLimit: number | null;
    usageCount: number;
    stackable: boolean;
    exclusive: boolean;
    minimumCartValue: bigint | null;
    maximumDiscount: bigint | null;
    currency: string;
    requiresCoupon: boolean;
    discountType: PromotionActionType;
    discountValue: bigint | null;
    buyQuantity: number | null;
    getQuantity: number | null;
    getDiscountBasisPoints: number | null;
    bundlePrice: bigint | null;
    rules: readonly PromotionRule[];
    targets: readonly PromotionTarget[];
  }): Promotion {
    return new Promotion(
      asPromotionId(row.id),
      row.name,
      row.description,
      row.status,
      row.priority,
      row.startsAt,
      row.endsAt,
      row.usageLimit,
      row.perCustomerLimit,
      row.usageCount,
      row.stackable,
      row.exclusive,
      row.minimumCartValue,
      row.maximumDiscount,
      row.currency,
      row.requiresCoupon,
      row.discountType,
      row.discountValue,
      row.buyQuantity,
      row.getQuantity,
      row.getDiscountBasisPoints,
      row.bundlePrice,
      row.rules,
      row.targets,
    );
  }
}
