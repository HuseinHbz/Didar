import { StockCountVarianceCalculator } from './stock-count-variance-calculator';

describe('StockCountVarianceCalculator', () => {
  it('computes a positive variance (found stock)', () => {
    expect(StockCountVarianceCalculator.compute(10, 12)).toBe(2);
  });

  it('computes a negative variance (shrinkage)', () => {
    expect(StockCountVarianceCalculator.compute(10, 7)).toBe(-3);
  });

  it('computes zero variance', () => {
    expect(StockCountVarianceCalculator.compute(10, 10)).toBe(0);
  });

  it('hasVariance reflects a non-zero variance', () => {
    expect(StockCountVarianceCalculator.hasVariance(10, 10)).toBe(false);
    expect(StockCountVarianceCalculator.hasVariance(10, 9)).toBe(true);
  });
});
