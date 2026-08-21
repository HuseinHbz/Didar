export class OverReturnedError extends Error {
  constructor(
    public readonly orderItemId: string,
    public readonly orderedQuantity: number,
    public readonly alreadyReturnedQuantity: number,
    public readonly requestedQuantity: number,
  ) {
    super(
      `Cannot return ${requestedQuantity} of order item ${orderItemId}: ` +
        `${alreadyReturnedQuantity} of ${orderedQuantity} already returned or currently in an active return`,
    );
    this.name = 'OverReturnedError';
  }
}

export class NonPositiveReturnQuantityError extends Error {
  constructor(quantity: number) {
    super(`Return quantity must be positive, got ${quantity}`);
    this.name = 'NonPositiveReturnQuantityError';
  }
}

/**
 * The invariant the brief states in words: a customer must never be
 * able to return more quantity than
 * `ordered_quantity - previously_returned_quantity - currently_active_return_quantity`.
 * Pure, zero I/O — the caller (`PrismaReturnRepository.create()`) is
 * responsible for computing `alreadyReturnedQuantity` (the sum of every
 * `ReturnItem.quantity` across every non-`REJECTED`/non-`CANCELLED`
 * `ReturnRequest` for this `orderItemId`, "currently active" and
 * "previously returned" collapsed into one figure since both count
 * against the same remaining balance) inside a `SELECT ... FOR UPDATE`-
 * locked transaction on the `OrderItem` row — the same
 * `lockAndSumFulfilled` technique this validator's own sibling,
 * `FulfillmentQuantityValidator`, already relies on — before calling
 * this, so two truly concurrent return requests can never both pass.
 */
export class ReturnQuantityValidator {
  static assertReturnable(
    orderItemId: string,
    orderedQuantity: number,
    alreadyReturnedQuantity: number,
    requestedQuantity: number,
  ): void {
    if (requestedQuantity <= 0) {
      throw new NonPositiveReturnQuantityError(requestedQuantity);
    }
    const remaining = orderedQuantity - alreadyReturnedQuantity;
    if (requestedQuantity > remaining) {
      throw new OverReturnedError(
        orderItemId,
        orderedQuantity,
        alreadyReturnedQuantity,
        requestedQuantity,
      );
    }
  }
}
