import { InvalidPriceError, PriceValidator } from './price-validator';

describe('PriceValidator', () => {
  describe('validate', () => {
    it('accepts a plain positive basePrice with nothing else set', () => {
      expect(() => {
        PriceValidator.validate({ basePrice: 12_500_000n });
      }).not.toThrow();
    });

    it('rejects a zero or negative basePrice', () => {
      expect(() => {
        PriceValidator.validate({ basePrice: 0n });
      }).toThrow(InvalidPriceError);
      expect(() => {
        PriceValidator.validate({ basePrice: -1n });
      }).toThrow(InvalidPriceError);
    });

    it('accepts a compareAtPrice strictly greater than basePrice', () => {
      expect(() => {
        PriceValidator.validate({ basePrice: 10_000_000n, compareAtPrice: 15_000_000n });
      }).not.toThrow();
    });

    it('rejects a compareAtPrice that is not greater than basePrice', () => {
      expect(() => {
        PriceValidator.validate({ basePrice: 10_000_000n, compareAtPrice: 10_000_000n });
      }).toThrow(InvalidPriceError);
      expect(() => {
        PriceValidator.validate({ basePrice: 10_000_000n, compareAtPrice: 5_000_000n });
      }).toThrow(InvalidPriceError);
    });

    it('rejects a negative costPrice', () => {
      expect(() => {
        PriceValidator.validate({ basePrice: 10_000_000n, costPrice: -1n });
      }).toThrow(InvalidPriceError);
    });

    it('accepts a zero costPrice', () => {
      expect(() => {
        PriceValidator.validate({ basePrice: 10_000_000n, costPrice: 0n });
      }).not.toThrow();
    });

    it('rejects validFrom on or after validTo', () => {
      const from = new Date('2026-06-01T00:00:00Z');
      const to = new Date('2026-05-01T00:00:00Z');
      expect(() => {
        PriceValidator.validate({ basePrice: 10_000_000n, validFrom: from, validTo: to });
      }).toThrow(InvalidPriceError);
    });

    it('accepts validFrom strictly before validTo', () => {
      const from = new Date('2026-05-01T00:00:00Z');
      const to = new Date('2026-06-01T00:00:00Z');
      expect(() => {
        PriceValidator.validate({ basePrice: 10_000_000n, validFrom: from, validTo: to });
      }).not.toThrow();
    });
  });

  describe('validateTaxRateBasisPoints', () => {
    it('accepts null/undefined (no tax configured)', () => {
      expect(() => {
        PriceValidator.validateTaxRateBasisPoints(null);
      }).not.toThrow();
      expect(() => {
        PriceValidator.validateTaxRateBasisPoints(undefined);
      }).not.toThrow();
    });

    it('accepts 0 and 10000 (the inclusive bounds)', () => {
      expect(() => {
        PriceValidator.validateTaxRateBasisPoints(0);
      }).not.toThrow();
      expect(() => {
        PriceValidator.validateTaxRateBasisPoints(10_000);
      }).not.toThrow();
    });

    it('rejects a value outside [0, 10000]', () => {
      expect(() => {
        PriceValidator.validateTaxRateBasisPoints(-1);
      }).toThrow(InvalidPriceError);
      expect(() => {
        PriceValidator.validateTaxRateBasisPoints(10_001);
      }).toThrow(InvalidPriceError);
    });

    it('rejects a non-integer value', () => {
      expect(() => {
        PriceValidator.validateTaxRateBasisPoints(900.5);
      }).toThrow(InvalidPriceError);
    });
  });
});
