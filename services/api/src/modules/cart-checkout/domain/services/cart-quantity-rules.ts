export class InvalidQuantityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidQuantityError';
  }
}

/**
 * Quantity validation — a positive integer, never exceeding the caller-
 * supplied `maxPerLine` (read from `system.Setting` by the application
 * layer, never hardcoded here — the brief's own "never hardcode... cart
 * rules") or the currently-available stock. This class never touches
 * inventory itself; `availableQuantity` is passed in by the caller
 * (`CartService`, after a real `StockQueryService` read) so this stays a
 * pure, DB-free function.
 */
export class CartQuantityRules {
  static assertValid(quantity: number, maxPerLine: number): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InvalidQuantityError('Quantity must be a positive integer');
    }
    if (quantity > maxPerLine) {
      throw new InvalidQuantityError(`Quantity exceeds the maximum of ${maxPerLine} per line`);
    }
  }

  static assertAvailable(requestedQuantity: number, availableQuantity: number): void {
    if (requestedQuantity > availableQuantity) {
      throw new InvalidQuantityError(
        `Requested quantity ${requestedQuantity} exceeds available stock ${availableQuantity}`,
      );
    }
  }
}
