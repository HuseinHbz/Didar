import type { PromotionRuleType, PromotionStatus, PromotionTargetType } from '@iecp/types';

import type { PromotionRuleConfig } from '../entities/promotion-rule.entity';
import type { Promotion } from '../entities/promotion.entity';

export const PROMOTION_REPOSITORY = Symbol('PROMOTION_REPOSITORY');

export interface CreatePromotionInput {
  name: string;
  description: string | null;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  stackable: boolean;
  exclusive: boolean;
  minimumCartValue: bigint | null;
  maximumDiscount: bigint | null;
  currency: string;
  requiresCoupon: boolean;
  discountType: Promotion['discountType'];
  discountValue: bigint | null;
  buyQuantity: number | null;
  getQuantity: number | null;
  getDiscountBasisPoints: number | null;
  bundlePrice: bigint | null;
  rules: readonly { type: PromotionRuleType; config: PromotionRuleConfig }[];
  targets: readonly { type: PromotionTargetType; refId: string }[];
}

export type UpdatePromotionInput = Partial<
  Omit<CreatePromotionInput, 'rules' | 'targets'> & {
    rules: readonly { type: PromotionRuleType; config: PromotionRuleConfig }[];
    targets: readonly { type: PromotionTargetType; refId: string }[];
  }
>;

/** Aggregate-root port (ADR-010 decision 1) — `PromotionRule`/
 * `PromotionTarget` have no independent lifecycle, same "child rows, no
 * separate repository" shape `OrderRepositoryPort` already established
 * for `OrderItem`/`OrderStatusHistory`. */
export interface PromotionRepositoryPort {
  create(input: CreatePromotionInput): Promise<Promotion>;
  update(id: string, input: UpdatePromotionInput): Promise<Promotion>;
  findById(id: string): Promise<Promotion | null>;
  list(filter: {
    status?: PromotionStatus;
    limit: number;
    offset: number;
  }): Promise<{ items: Promotion[]; total: number }>;
  /** Every promotion `ACTIVE` right now, window included — the resolver's
   * candidate pool for automatic + coupon-gated evaluation alike. */
  listActive(now: Date): Promise<Promotion[]>;
  updateStatus(id: string, status: PromotionStatus): Promise<Promotion>;
  /** Every `ACTIVE`/`PAUSED`/`SCHEDULED`/`DRAFT` promotion whose `endsAt`
   * has passed — the `promotion_expiration` sweep's own read (ADR-010
   * decision 9). */
  listExpiredNotMarked(now: Date): Promise<Promotion[]>;
}
