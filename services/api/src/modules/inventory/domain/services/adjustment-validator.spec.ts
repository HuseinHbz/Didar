import { AdjustmentValidator, InvalidAdjustmentError } from './adjustment-validator';
import { InsufficientStockError } from './available-quantity-calculator';

const snapshot = {
  onHandQuantity: 20,
  reservedQuantity: 5,
  inTransitQuantity: 0,
  damagedQuantity: 0,
  quarantinedQuantity: 0,
  blockedQuantity: 0,
};

describe('AdjustmentValidator', () => {
  it('allows a positive adjustment', () => {
    expect(() => {
      AdjustmentValidator.assertValid(snapshot, 'POSITIVE', 10, 'found extra stock');
    }).not.toThrow();
  });

  it('allows a negative adjustment that keeps on-hand non-negative', () => {
    expect(() => {
      AdjustmentValidator.assertValid(snapshot, 'NEGATIVE', 15, 'breakage during handling');
    }).not.toThrow();
  });

  it('rejects a negative adjustment that would take on-hand below zero', () => {
    expect(() => {
      AdjustmentValidator.assertValid(snapshot, 'NEGATIVE', 25, 'breakage during handling');
    }).toThrow(InvalidAdjustmentError);
  });

  it('rejects a negative adjustment that would take available below zero even with on-hand still positive', () => {
    // on_hand 20 - 16 = 4, but reserved is 5 -> available would be -1
    expect(() => {
      AdjustmentValidator.assertValid(snapshot, 'NEGATIVE', 16, 'shrinkage');
    }).toThrow(InsufficientStockError);
  });

  it('rejects a non-positive quantity', () => {
    expect(() => {
      AdjustmentValidator.assertValid(snapshot, 'POSITIVE', 0, 'reason');
    }).toThrow(InvalidAdjustmentError);
  });

  it('rejects an empty/whitespace-only reason', () => {
    expect(() => {
      AdjustmentValidator.assertValid(snapshot, 'POSITIVE', 5, '   ');
    }).toThrow(InvalidAdjustmentError);
  });
});
