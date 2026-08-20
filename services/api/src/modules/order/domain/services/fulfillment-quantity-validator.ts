export class OverFulfillmentError extends Error {
  constructor(
    public readonly orderItemId: string,
    public readonly orderedQuantity: number,
    public readonly alreadyFulfilledQuantity: number,
    public readonly requestedQuantity: number,
  ) {
    super(
      `Cannot fulfill ${requestedQuantity} of order item ${orderItemId}: ` +
        `${alreadyFulfilledQuantity} of ${orderedQuantity} already fulfilled`,
    );
    this.name = 'OverFulfillmentError';
  }
}

export class NonPositiveFulfillmentQuantityError extends Error {
  constructor(quantity: number) {
    super(`Fulfillment quantity must be positive, got ${quantity}`);
    this.name = 'NonPositiveFulfillmentQuantityError';
  }
}

/**
 * The invariant ADR-009 decision 8 states in words:
 * `fulfilled_quantity ≤ ordered_quantity − already_fulfilled_quantity`.
 * Pure, zero I/O — the caller (`PrismaFulfillmentRepository.create()`) is
 * responsible for computing `alreadyFulfilledQuantity` inside a
 * `SELECT ... FOR UPDATE`-locked transaction on the `OrderItem` row
 * (`mutateInventoryItem`'s own technique, reused) before calling this, so
 * two truly concurrent fulfillment requests can never both pass.
 */
export class FulfillmentQuantityValidator {
  static assertFulfillable(
    orderItemId: string,
    orderedQuantity: number,
    alreadyFulfilledQuantity: number,
    requestedQuantity: number,
  ): void {
    if (requestedQuantity <= 0) {
      throw new NonPositiveFulfillmentQuantityError(requestedQuantity);
    }
    const remaining = orderedQuantity - alreadyFulfilledQuantity;
    if (requestedQuantity > remaining) {
      throw new OverFulfillmentError(
        orderItemId,
        orderedQuantity,
        alreadyFulfilledQuantity,
        requestedQuantity,
      );
    }
  }
}
