import type { InventoryAdjustmentType } from '@iecp/types';

import {
  AvailableQuantityCalculator,
  type QuantitySnapshot,
} from './available-quantity-calculator';

export class InvalidAdjustmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidAdjustmentError';
  }
}

/**
 * Manual adjustments are permission-controlled and audited (the brief's
 * own critical_rule) — this is the domain-layer half of "controlled": a
 * negative adjustment can never take on-hand (or, transitively, available)
 * below zero, and a reason is always required (empty-string reasons are a
 * silent-adjustment loophole this project doesn't allow).
 */
export class AdjustmentValidator {
  static assertValid(
    current: QuantitySnapshot,
    adjustmentType: InventoryAdjustmentType,
    quantity: number,
    reason: string,
  ): void {
    if (quantity <= 0) {
      throw new InvalidAdjustmentError(`Adjustment quantity must be positive, got ${quantity}`);
    }
    if (reason.trim().length === 0) {
      throw new InvalidAdjustmentError('Adjustment reason is required');
    }
    const signedDelta = adjustmentType === 'POSITIVE' ? quantity : -quantity;
    const projectedOnHand = current.onHandQuantity + signedDelta;
    if (projectedOnHand < 0) {
      throw new InvalidAdjustmentError(
        `Cannot apply adjustment of ${signedDelta} — on-hand would go negative (currently ${current.onHandQuantity})`,
      );
    }
    AvailableQuantityCalculator.assertNonNegative({ ...current, onHandQuantity: projectedOnHand });
  }
}
