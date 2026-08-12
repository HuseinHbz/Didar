export class InvalidPriceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPriceError';
  }
}

export interface PriceInput {
  basePrice: bigint;
  compareAtPrice?: bigint | null;
  costPrice?: bigint | null;
  validFrom?: Date | null;
  validTo?: Date | null;
}

/**
 * Pure validation for the pricing foundation (Phase 005 `pricing`
 * requirements) — money-integrity rules that must hold regardless of which
 * use case is setting a price. Currency conversion/formatting stays in
 * `@iecp/types`' `Money`; this only checks the raw integer minor-unit
 * amounts a SKU's price row is about to be written with.
 */
export class PriceValidator {
  static validate(input: PriceInput): void {
    if (input.basePrice <= 0n) {
      throw new InvalidPriceError('basePrice must be a positive integer amount');
    }
    if (input.compareAtPrice !== null && input.compareAtPrice !== undefined) {
      if (input.compareAtPrice <= input.basePrice) {
        throw new InvalidPriceError('compareAtPrice must be greater than basePrice');
      }
    }
    if (input.costPrice !== null && input.costPrice !== undefined && input.costPrice < 0n) {
      throw new InvalidPriceError('costPrice cannot be negative');
    }
    if (input.validFrom && input.validTo && input.validFrom >= input.validTo) {
      throw new InvalidPriceError('validFrom must be before validTo');
    }
  }

  static validateTaxRateBasisPoints(value: number | null | undefined): void {
    if (value === null || value === undefined) return;
    if (!Number.isInteger(value) || value < 0 || value > 10_000) {
      throw new InvalidPriceError('taxRateBasisPoints must be an integer between 0 and 10000');
    }
  }
}
