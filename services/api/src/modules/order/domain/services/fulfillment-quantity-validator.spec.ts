import {
  FulfillmentQuantityValidator,
  NonPositiveFulfillmentQuantityError,
  OverFulfillmentError,
} from './fulfillment-quantity-validator';

describe('FulfillmentQuantityValidator', () => {
  it('allows fulfilling exactly the ordered quantity in one go', () => {
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 0, 5);
    }).not.toThrow();
  });

  it('allows a partial fulfillment that leaves some remaining', () => {
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 0, 3);
    }).not.toThrow();
  });

  it('allows completing the remainder after a partial fulfillment', () => {
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 3, 2);
    }).not.toThrow();
  });

  it('rejects fulfilling more than what remains', () => {
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 3, 3);
    }).toThrow(OverFulfillmentError);
  });

  it('rejects fulfilling more than ordered on the first attempt', () => {
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 0, 6);
    }).toThrow(OverFulfillmentError);
  });

  it('rejects a zero or negative quantity', () => {
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 0, 0);
    }).toThrow(NonPositiveFulfillmentQuantityError);
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 0, -1);
    }).toThrow(NonPositiveFulfillmentQuantityError);
  });

  it('rejects any fulfillment once the item is already fully fulfilled', () => {
    expect(() => {
      FulfillmentQuantityValidator.assertFulfillable('item-1', 5, 5, 1);
    }).toThrow(OverFulfillmentError);
  });
});
