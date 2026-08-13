/** Domain-layer mirror of `@iecp/types`' `PriceLineBreakdown` but with
 * `bigint` amounts (the DTO layer converts to decimal strings at the HTTP
 * boundary — same money convention as everywhere else in this repo). Kept
 * as a plain interface, not a class, since it's a pure data snapshot with
 * no behavior of its own. */
export interface PriceLineBreakdown {
  productSkuId: string;
  quantity: number;
  basePrice: bigint;
  resolvedUnitPrice: bigint;
  lineDiscount: bigint;
  lineTax: bigint;
  lineSubtotal: bigint;
  taxRateBasisPoints: number;
}
