import {
  AvailableQuantityCalculator,
  InsufficientStockError,
} from './available-quantity-calculator';

describe('AvailableQuantityCalculator', () => {
  describe('compute', () => {
    it("applies the brief's exact formula", () => {
      const available = AvailableQuantityCalculator.compute({
        onHandQuantity: 100,
        reservedQuantity: 20,
        inTransitQuantity: 0,
        damagedQuantity: 5,
        quarantinedQuantity: 3,
        blockedQuantity: 2,
      });
      expect(available).toBe(70);
    });

    it('ignores inTransitQuantity (not part of the formula)', () => {
      const available = AvailableQuantityCalculator.compute({
        onHandQuantity: 50,
        reservedQuantity: 0,
        inTransitQuantity: 1000,
        damagedQuantity: 0,
        quarantinedQuantity: 0,
        blockedQuantity: 0,
      });
      expect(available).toBe(50);
    });

    it('can go negative (compute alone does not throw)', () => {
      const available = AvailableQuantityCalculator.compute({
        onHandQuantity: 5,
        reservedQuantity: 10,
        inTransitQuantity: 0,
        damagedQuantity: 0,
        quarantinedQuantity: 0,
        blockedQuantity: 0,
      });
      expect(available).toBe(-5);
    });
  });

  describe('assertNonNegative', () => {
    it('returns the available quantity when non-negative', () => {
      expect(
        AvailableQuantityCalculator.assertNonNegative({
          onHandQuantity: 10,
          reservedQuantity: 4,
          inTransitQuantity: 0,
          damagedQuantity: 0,
          quarantinedQuantity: 0,
          blockedQuantity: 0,
        }),
      ).toBe(6);
    });

    it('throws InsufficientStockError when the result would be negative', () => {
      expect(() =>
        AvailableQuantityCalculator.assertNonNegative({
          onHandQuantity: 3,
          reservedQuantity: 5,
          inTransitQuantity: 0,
          damagedQuantity: 0,
          quarantinedQuantity: 0,
          blockedQuantity: 0,
        }),
      ).toThrow(InsufficientStockError);
    });

    it('is exactly zero at the boundary (allowed, not an error)', () => {
      expect(
        AvailableQuantityCalculator.assertNonNegative({
          onHandQuantity: 10,
          reservedQuantity: 10,
          inTransitQuantity: 0,
          damagedQuantity: 0,
          quarantinedQuantity: 0,
          blockedQuantity: 0,
        }),
      ).toBe(0);
    });
  });
});
