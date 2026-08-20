import { RefundAmountCalculator } from './refund-amount-calculator';

describe('RefundAmountCalculator', () => {
  describe('lineTotalPayable', () => {
    it('is lineTotal - discountAmount + taxAmount', () => {
      expect(RefundAmountCalculator.lineTotalPayable(100_000n, 10_000n, 9_000n)).toBe(99_000n);
    });

    it('handles a zero discount/tax line', () => {
      expect(RefundAmountCalculator.lineTotalPayable(50_000n, 0n, 0n)).toBe(50_000n);
    });
  });

  describe('perUnitAmounts', () => {
    it('splits evenly when the total divides cleanly', () => {
      expect(RefundAmountCalculator.perUnitAmounts(300n, 3)).toEqual([100n, 100n, 100n]);
    });

    it('assigns the remainder to the first slots by ordinal position', () => {
      // 100 / 3 = 33 remainder 1 -> first slot gets the extra unit.
      expect(RefundAmountCalculator.perUnitAmounts(100n, 3)).toEqual([34n, 33n, 33n]);
    });

    it('returns an empty array for zero or negative quantity', () => {
      expect(RefundAmountCalculator.perUnitAmounts(100n, 0)).toEqual([]);
      expect(RefundAmountCalculator.perUnitAmounts(100n, -1)).toEqual([]);
    });

    it('every slot sums back to the exact total, regardless of remainder', () => {
      const slots = RefundAmountCalculator.perUnitAmounts(1_000_001n, 7);
      const sum = slots.reduce((total, slot) => total + slot, 0n);
      expect(sum).toBe(1_000_001n);
      expect(slots).toHaveLength(7);
    });
  });

  describe('amountForReturnedUnits', () => {
    it('a single full-line return in one request equals the whole payable amount', () => {
      const amount = RefundAmountCalculator.amountForReturnedUnits(13_625_000n, 1, 0, 1);
      expect(amount).toBe(13_625_000n);
    });

    it('summing every partial return against one line, in order, equals the line total exactly (no rounding leakage)', () => {
      // 10 units, total payable 1,000,001 (not evenly divisible by 10).
      const totalPayable = 1_000_001n;
      const orderedQuantity = 10;

      // Return#1 2x, Return#2 3x, Return#3 5x — same worked example
      // ReturnQuantityValidator's own spec uses.
      const r1 = RefundAmountCalculator.amountForReturnedUnits(totalPayable, orderedQuantity, 0, 2);
      const r2 = RefundAmountCalculator.amountForReturnedUnits(totalPayable, orderedQuantity, 2, 3);
      const r3 = RefundAmountCalculator.amountForReturnedUnits(totalPayable, orderedQuantity, 5, 5);

      expect(r1 + r2 + r3).toBe(totalPayable);
    });

    it('returning zero of these units from a middle offset yields zero', () => {
      const amount = RefundAmountCalculator.amountForReturnedUnits(1_000_000n, 10, 5, 0);
      expect(amount).toBe(0n);
    });
  });

  describe('isFullOrderReturn', () => {
    it('is false for an empty order', () => {
      expect(RefundAmountCalculator.isFullOrderReturn([])).toBe(false);
    });

    it('is true only when every line is fully returned', () => {
      expect(
        RefundAmountCalculator.isFullOrderReturn([
          { orderedQuantity: 2, returnedQuantityAfterThisRequest: 2 },
          { orderedQuantity: 1, returnedQuantityAfterThisRequest: 1 },
        ]),
      ).toBe(true);
    });

    it('is false when any single line still has an outstanding quantity', () => {
      expect(
        RefundAmountCalculator.isFullOrderReturn([
          { orderedQuantity: 2, returnedQuantityAfterThisRequest: 2 },
          { orderedQuantity: 1, returnedQuantityAfterThisRequest: 0 },
        ]),
      ).toBe(false);
    });
  });
});
