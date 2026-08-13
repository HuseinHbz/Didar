import { CartQuantityRules, InvalidQuantityError } from './cart-quantity-rules';

describe('CartQuantityRules', () => {
  describe('assertValid', () => {
    it('accepts a positive integer within the max', () => {
      expect(() => {
        CartQuantityRules.assertValid(3, 10);
      }).not.toThrow();
    });

    it('rejects zero, negative, and non-integer quantities', () => {
      expect(() => {
        CartQuantityRules.assertValid(0, 10);
      }).toThrow(InvalidQuantityError);
      expect(() => {
        CartQuantityRules.assertValid(-1, 10);
      }).toThrow(InvalidQuantityError);
      expect(() => {
        CartQuantityRules.assertValid(1.5, 10);
      }).toThrow(InvalidQuantityError);
    });

    it('rejects a quantity exceeding the configured max per line', () => {
      expect(() => {
        CartQuantityRules.assertValid(11, 10);
      }).toThrow(InvalidQuantityError);
    });
  });

  describe('assertAvailable', () => {
    it('accepts a quantity within available stock', () => {
      expect(() => {
        CartQuantityRules.assertAvailable(5, 10);
      }).not.toThrow();
    });

    it('rejects a quantity exceeding available stock', () => {
      expect(() => {
        CartQuantityRules.assertAvailable(11, 10);
      }).toThrow(InvalidQuantityError);
    });
  });
});
