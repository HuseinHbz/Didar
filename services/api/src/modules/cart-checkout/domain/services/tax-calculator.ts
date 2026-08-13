import { Money } from '@iecp/types';

/**
 * Reuses `catalog.product_skus.tax_rate_basis_points` (Phase 005) as the
 * configurable, per-SKU, never-hardcoded tax rate — `null` means
 * non-taxable, a set value is the exact rate to apply (ADR-007 decision
 * 6). `defaultTaxRateBasisPoints` (read from `system.Setting` by the
 * application layer) fills the one gap: a SKU with no explicit rate at
 * all. Tax is computed on the taxable amount *after* discount — a
 * discounted line is taxed on what the customer actually pays, not the
 * pre-discount price.
 */
export class TaxCalculator {
  static effectiveRate(
    skuTaxRateBasisPoints: number | null,
    defaultTaxRateBasisPoints: number,
  ): number {
    return skuTaxRateBasisPoints ?? defaultTaxRateBasisPoints;
  }

  static calculateLineTax(taxableAmount: bigint, rateBasisPoints: number): bigint {
    if (taxableAmount <= 0n || rateBasisPoints <= 0) return 0n;
    return Money.ofRial(taxableAmount).applyBasisPoints(rateBasisPoints).amount;
  }
}
