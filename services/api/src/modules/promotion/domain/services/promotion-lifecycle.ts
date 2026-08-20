import type { PromotionStatus } from '@iecp/types';

import { InvalidPromotionTransitionError } from '../errors/promotion-domain.errors';

/** `DRAFT -> SCHEDULED -> ACTIVE -> {PAUSED, EXPIRED, ARCHIVED}`,
 * `PAUSED -> ACTIVE`, and `{DRAFT, SCHEDULED, ACTIVE, PAUSED, EXPIRED} ->
 * ARCHIVED` (terminal, admin-only). `EXPIRED` is also reachable
 * automatically once `endsAt` passes (the `promotion_expiration` sweep,
 * ADR-010 decision 9) — never reversible back to `ACTIVE`; a promotion
 * that should run again is a new promotion, not a reopened one. */
const TRANSITIONS: Record<PromotionStatus, readonly PromotionStatus[]> = {
  DRAFT: ['SCHEDULED', 'ACTIVE', 'ARCHIVED'],
  SCHEDULED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED', 'EXPIRED', 'ARCHIVED'],
  PAUSED: ['ACTIVE', 'ARCHIVED', 'EXPIRED'],
  EXPIRED: ['ARCHIVED'],
  ARCHIVED: [],
};

export class PromotionLifecycle {
  static canTransition(from: PromotionStatus, to: PromotionStatus): boolean {
    if (from === to) return true;
    return TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: PromotionStatus, to: PromotionStatus): void {
    if (!this.canTransition(from, to)) {
      throw new InvalidPromotionTransitionError(from, to);
    }
  }

  static isNoOp(from: PromotionStatus, to: PromotionStatus): boolean {
    return from === to;
  }
}
