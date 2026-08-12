import type { ProductLifecycleStatus } from '@iecp/types';

/** Thrown by `assertTransition` — the presentation layer maps this to a 409/422. */
export class InvalidProductTransitionError extends Error {
  constructor(
    public readonly from: ProductLifecycleStatus,
    public readonly to: ProductLifecycleStatus,
  ) {
    super(`Cannot transition product from ${from} to ${to}`);
    this.name = 'InvalidProductTransitionError';
  }
}

/**
 * Phase 005 `product_lifecycle`: DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED
 * -> UNPUBLISHED, with ARCHIVED reachable from any non-terminal state (and
 * itself terminal — see ADR-005). Pure, no I/O: the use case loads the
 * current `Product.status`, calls `assertTransition`, and only then writes.
 */
export class ProductLifecycleStateMachine {
  private static readonly TRANSITIONS: Readonly<
    Record<ProductLifecycleStatus, readonly ProductLifecycleStatus[]>
  > = {
    DRAFT: ['IN_REVIEW', 'ARCHIVED'],
    IN_REVIEW: ['APPROVED', 'DRAFT', 'ARCHIVED'],
    APPROVED: ['PUBLISHED', 'DRAFT', 'ARCHIVED'],
    PUBLISHED: ['UNPUBLISHED', 'ARCHIVED'],
    UNPUBLISHED: ['PUBLISHED', 'ARCHIVED'],
    ARCHIVED: [],
  };

  static canTransition(from: ProductLifecycleStatus, to: ProductLifecycleStatus): boolean {
    return ProductLifecycleStateMachine.TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: ProductLifecycleStatus, to: ProductLifecycleStatus): void {
    if (!ProductLifecycleStateMachine.canTransition(from, to)) {
      throw new InvalidProductTransitionError(from, to);
    }
  }
}
