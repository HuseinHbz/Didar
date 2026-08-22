export class InvalidPurchaseOrderLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPurchaseOrderLineError';
  }
}

export interface PurchaseOrderLineInput {
  productSkuId: string;
  orderedQuantity: number;
  unitCost: bigint;
}

/**
 * Line-level invariants for `PurchaseOrder.create()` — the application-
 * layer half of what `purchase_order_items`' own CHECK constraints
 * (`ordered_quantity > 0`, `unit_cost >= 0`) already enforce at the
 * database. Checked here too so a bad request 400s before it ever
 * reaches a transaction, the same "validation fails, security first"
 * (blueprint §100) shape every other domain validator in this repo
 * follows — the database constraint is the backstop against a second,
 * buggy call site, not the only line of defense.
 */
export class PurchaseOrderLineValidator {
  static assertValid(lines: readonly PurchaseOrderLineInput[]): void {
    if (lines.length === 0) {
      throw new InvalidPurchaseOrderLineError('A purchase order must have at least one line');
    }
    const seenSkus = new Set<string>();
    for (const line of lines) {
      if (line.orderedQuantity <= 0) {
        throw new InvalidPurchaseOrderLineError(
          `Ordered quantity must be positive, got ${line.orderedQuantity} for SKU ${line.productSkuId}`,
        );
      }
      if (line.unitCost < 0n) {
        throw new InvalidPurchaseOrderLineError(
          `Unit cost cannot be negative, got ${line.unitCost} for SKU ${line.productSkuId}`,
        );
      }
      if (seenSkus.has(line.productSkuId)) {
        throw new InvalidPurchaseOrderLineError(
          `Duplicate SKU ${line.productSkuId} — combine into a single line instead`,
        );
      }
      seenSkus.add(line.productSkuId);
    }
  }

  /** A `receive()` call's own quantities: never zero/negative, never
   * more than what's still outstanding on that line (the "no over-
   * receiving" invariant `purchase_order_items_received_within_ordered`
   * backstops at the database). */
  static assertValidReceipt(
    receivedQuantity: number,
    outstandingQuantity: number,
    productSkuId: string,
  ): void {
    if (receivedQuantity <= 0) {
      throw new InvalidPurchaseOrderLineError(
        `Received quantity must be positive, got ${receivedQuantity} for SKU ${productSkuId}`,
      );
    }
    if (receivedQuantity > outstandingQuantity) {
      throw new InvalidPurchaseOrderLineError(
        `Cannot receive ${receivedQuantity} for SKU ${productSkuId} — only ${outstandingQuantity} outstanding`,
      );
    }
  }
}
