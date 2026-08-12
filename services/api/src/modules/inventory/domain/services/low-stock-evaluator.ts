export interface LowStockThresholdInput {
  reorderPoint: number;
  safetyStock: number;
  minStock: number | null;
  maxStock: number | null;
}

export interface LowStockResult {
  isLow: boolean;
  /** `reorderPoint + safetyStock` — the effective floor this evaluation used. */
  effectiveFloor: number;
  availableQuantity: number;
  shortfall: number;
}

/**
 * Pure — thresholds are always read from the database
 * (`InventoryThreshold`, per SKU+warehouse — ADR-006 decision 6), never
 * hardcoded. "Low" means total available quantity across a warehouse's
 * locations for this SKU is at or below `reorderPoint + safetyStock`; if
 * `minStock` is set and stricter than that sum, `minStock` wins (an admin
 * can demand a harder floor than the reorder math alone implies).
 */
export class LowStockEvaluator {
  static evaluate(availableQuantity: number, threshold: LowStockThresholdInput): LowStockResult {
    const reorderFloor = threshold.reorderPoint + threshold.safetyStock;
    const effectiveFloor =
      threshold.minStock !== null ? Math.max(reorderFloor, threshold.minStock) : reorderFloor;
    const isLow = availableQuantity <= effectiveFloor;
    return {
      isLow,
      effectiveFloor,
      availableQuantity,
      shortfall: isLow ? Math.max(effectiveFloor - availableQuantity, 0) : 0,
    };
  }
}
