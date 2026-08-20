import { asPromotionRuleId, type PromotionRuleId, type PromotionRuleType } from '@iecp/types';

/** `config` shape depends on `type`, validated by the domain layer (never
 * trusted raw from the DB row — see `PromotionRuleConfig` guards below). */
export type PromotionRuleConfig =
  { minimumQuantity: number } | { customerSegmentKey: string } | Record<string, never>; // FIRST_PURCHASE_ONLY needs no config

export class PromotionRule {
  constructor(
    public readonly id: PromotionRuleId,
    public readonly promotionId: string,
    public readonly type: PromotionRuleType,
    public readonly config: PromotionRuleConfig,
  ) {}

  static fromPersistence(row: {
    id: string;
    promotionId: string;
    type: PromotionRuleType;
    config: unknown;
  }): PromotionRule {
    return new PromotionRule(
      asPromotionRuleId(row.id),
      row.promotionId,
      row.type,
      (row.config ?? {}) as PromotionRuleConfig,
    );
  }
}
