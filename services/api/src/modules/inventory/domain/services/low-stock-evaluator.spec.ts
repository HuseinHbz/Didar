import { LowStockEvaluator } from './low-stock-evaluator';

describe('LowStockEvaluator', () => {
  it('is not low when available comfortably exceeds reorderPoint+safetyStock', () => {
    const result = LowStockEvaluator.evaluate(50, {
      reorderPoint: 10,
      safetyStock: 5,
      minStock: null,
      maxStock: null,
    });
    expect(result.isLow).toBe(false);
    expect(result.shortfall).toBe(0);
  });

  it('is low exactly at the floor (reorderPoint+safetyStock)', () => {
    const result = LowStockEvaluator.evaluate(15, {
      reorderPoint: 10,
      safetyStock: 5,
      minStock: null,
      maxStock: null,
    });
    expect(result.isLow).toBe(true);
    expect(result.effectiveFloor).toBe(15);
    expect(result.shortfall).toBe(0);
  });

  it('is low below the floor and reports the correct shortfall', () => {
    const result = LowStockEvaluator.evaluate(8, {
      reorderPoint: 10,
      safetyStock: 5,
      minStock: null,
      maxStock: null,
    });
    expect(result.isLow).toBe(true);
    expect(result.shortfall).toBe(7);
  });

  it('minStock overrides a lower reorder+safety floor when stricter', () => {
    const result = LowStockEvaluator.evaluate(12, {
      reorderPoint: 5,
      safetyStock: 2,
      minStock: 20,
      maxStock: null,
    });
    expect(result.effectiveFloor).toBe(20);
    expect(result.isLow).toBe(true);
    expect(result.shortfall).toBe(8);
  });

  it('minStock is ignored when looser than reorder+safety', () => {
    const result = LowStockEvaluator.evaluate(12, {
      reorderPoint: 10,
      safetyStock: 5,
      minStock: 3,
      maxStock: null,
    });
    expect(result.effectiveFloor).toBe(15);
  });
});
