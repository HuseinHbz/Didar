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

    // CP-031 (gap P0-5): `available` is a signed sum, so two wrong buckets can
    // cancel out. A double-applied convert took reserved and on-hand negative
    // together while `available` stayed positive — each stored bucket is now
    // checked on its own.
    describe('every stored bucket must be non-negative on its own', () => {
      const healthy = {
        onHandQuantity: 10,
        reservedQuantity: 2,
        inTransitQuantity: 1,
        damagedQuantity: 1,
        quarantinedQuantity: 1,
        blockedQuantity: 1,
      };

      it('rejects negative reserved + negative on-hand even though available stays positive', () => {
        // The exact shape of the phantom-stock state the unlocked convert race
        // produced: both buckets below zero, derived `available` still +2.
        const phantom = {
          onHandQuantity: -1,
          reservedQuantity: -3,
          inTransitQuantity: 0,
          damagedQuantity: 0,
          quarantinedQuantity: 0,
          blockedQuantity: 0,
        };
        expect(AvailableQuantityCalculator.compute(phantom)).toBe(2);
        expect(() => AvailableQuantityCalculator.assertNonNegative(phantom)).toThrow(
          InsufficientStockError,
        );
      });

      it.each([
        ['on_hand_quantity', { onHandQuantity: -1 }],
        ['reserved_quantity', { reservedQuantity: -1 }],
        ['in_transit_quantity', { inTransitQuantity: -1 }],
        ['damaged_quantity', { damagedQuantity: -1 }],
        ['quarantined_quantity', { quarantinedQuantity: -1 }],
        ['blocked_quantity', { blockedQuantity: -1 }],
      ])('names %s when only that bucket is negative', (bucket, override) => {
        // A big on-hand keeps `available` positive so the stored-bucket check
        // is the only thing that can fire.
        const snapshot = { ...healthy, onHandQuantity: 100, ...override };
        let thrown: unknown;
        try {
          AvailableQuantityCalculator.assertNonNegative(snapshot);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(InsufficientStockError);
        expect((thrown as InsufficientStockError).bucket).toBe(bucket);
      });

      it('still reports available_quantity when only the derived figure is negative', () => {
        let thrown: unknown;
        try {
          AvailableQuantityCalculator.assertNonNegative({ ...healthy, reservedQuantity: 50 });
        } catch (error) {
          thrown = error;
        }
        expect((thrown as InsufficientStockError).bucket).toBe('available_quantity');
      });

      it('accepts a snapshot where every bucket is zero', () => {
        expect(
          AvailableQuantityCalculator.assertNonNegative({
            onHandQuantity: 0,
            reservedQuantity: 0,
            inTransitQuantity: 0,
            damagedQuantity: 0,
            quarantinedQuantity: 0,
            blockedQuantity: 0,
          }),
        ).toBe(0);
      });
    });
  });
});
