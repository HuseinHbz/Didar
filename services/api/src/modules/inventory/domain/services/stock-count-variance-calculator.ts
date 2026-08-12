/** Pure — `variance = counted - expected`. A positive variance means more
 * was physically counted than the system expected (found stock); negative
 * means less (shrinkage/loss). Reconciling a count writes this exact value
 * as a `COUNT_ADJUSTMENT` ledger entry, never a silent overwrite of
 * `on_hand_quantity`. */
export class StockCountVarianceCalculator {
  static compute(expectedQuantity: number, countedQuantity: number): number {
    return countedQuantity - expectedQuantity;
  }

  static hasVariance(expectedQuantity: number, countedQuantity: number): boolean {
    return StockCountVarianceCalculator.compute(expectedQuantity, countedQuantity) !== 0;
  }
}
