/**
 * Shared shapes for Phase 007's cart/checkout pricing resolution — see
 * `docs/adr/ADR-007-cart-checkout.md`. Money fields are decimal strings
 * (bigint serialized), never JSON numbers — same convention as everywhere
 * else in this repo (`Money.toJSON()`, `docs/database/README.md`
 * convention 2).
 */

import type { CurrencyCode } from './money.js';

/** One cart/checkout line's fully-resolved price — every field the
 * pricing_engine.outputs list in the brief names, per line. */
export interface PriceLineBreakdown {
  productSkuId: string;
  quantity: number;
  basePrice: string;
  resolvedUnitPrice: string;
  lineDiscount: string;
  lineTax: string;
  lineSubtotal: string;
  taxRateBasisPoints: number;
}

/** The full server-side pricing resolution result — base_price ->
 * resolved_unit_price -> discount -> tax -> shipping -> subtotal ->
 * grand_total, exactly the brief's `pricing_engine.outputs` list, plus a
 * per-line `breakdown` so a caller never has to trust an unexplained
 * total. */
export interface PricingResolutionResult {
  currency: CurrencyCode;
  lines: PriceLineBreakdown[];
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  shippingTotal: string;
  grandTotal: string;
  couponCode: string | null;
  shippingMethodCode: string | null;
}
