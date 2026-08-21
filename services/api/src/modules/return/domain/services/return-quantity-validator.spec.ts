import {
  NonPositiveReturnQuantityError,
  OverReturnedError,
  ReturnQuantityValidator,
} from './return-quantity-validator';

describe('ReturnQuantityValidator', () => {
  it('allows returning exactly the ordered quantity in one go', () => {
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 0, 10);
    }).not.toThrow();
  });

  it('allows a partial return that leaves some remaining', () => {
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 0, 3);
    }).not.toThrow();
  });

  it('allows successive partial returns that together exactly consume the order (the worked example)', () => {
    // Order 10x Product A; Return#1 2x, Return#2 3x, Return#3 5x — all valid.
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 0, 2);
    }).not.toThrow();
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 2, 3);
    }).not.toThrow();
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 5, 5);
    }).not.toThrow();
    // Return#4 1x must be rejected — nothing left to return.
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 10, 1);
    }).toThrow(OverReturnedError);
  });

  it('rejects returning more than what remains', () => {
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 8, 3);
    }).toThrow(OverReturnedError);
  });

  it('rejects returning more than ordered on the first attempt', () => {
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 0, 11);
    }).toThrow(OverReturnedError);
  });

  it('rejects a zero or negative quantity', () => {
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 0, 0);
    }).toThrow(NonPositiveReturnQuantityError);
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 0, -1);
    }).toThrow(NonPositiveReturnQuantityError);
  });

  it('rejects any return once the item is already fully returned', () => {
    expect(() => {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 10, 1);
    }).toThrow(OverReturnedError);
  });

  it('the OverReturnedError carries the exact figures for a 409 body', () => {
    try {
      ReturnQuantityValidator.assertReturnable('item-1', 10, 8, 5);
      fail('expected OverReturnedError to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OverReturnedError);
      const err = error as OverReturnedError;
      expect(err.orderItemId).toBe('item-1');
      expect(err.orderedQuantity).toBe(10);
      expect(err.alreadyReturnedQuantity).toBe(8);
      expect(err.requestedQuantity).toBe(5);
    }
  });
});
