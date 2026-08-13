import { TaxCalculator } from './tax-calculator';

describe('TaxCalculator', () => {
  describe('effectiveRate', () => {
    it('uses the SKU rate when set', () => {
      expect(TaxCalculator.effectiveRate(900, 500)).toBe(900);
    });

    it('falls back to the configured default when the SKU has no rate', () => {
      expect(TaxCalculator.effectiveRate(null, 500)).toBe(500);
    });
  });

  describe('calculateLineTax', () => {
    it('applies the basis-point rate to the taxable amount', () => {
      expect(TaxCalculator.calculateLineTax(1_000_000n, 900)).toBe(90_000n);
    });

    it('returns zero for a non-taxable (0 rate) line', () => {
      expect(TaxCalculator.calculateLineTax(1_000_000n, 0)).toBe(0n);
    });

    it('returns zero for a non-positive taxable amount', () => {
      expect(TaxCalculator.calculateLineTax(0n, 900)).toBe(0n);
      expect(TaxCalculator.calculateLineTax(-100n, 900)).toBe(0n);
    });
  });
});
