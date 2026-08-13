import { createHash } from 'node:crypto';

/**
 * Computes the deterministic `configurationHash` two cart-item adds must
 * match to consolidate into one line (quantity summed) rather than
 * becoming two distinct lines — the brief's "prevent duplicate cart lines
 * where business rules require consolidation" / "preserve line-specific
 * configuration", both satisfied by the same mechanism (ADR-007, `CartItem`
 * doc comment). No configuration (`undefined`/`null`/`{}`) hashes to the
 * empty string, matching the schema's `@default("")` for a plain,
 * unconfigured SKU add.
 */
export class CartConsolidationRules {
  static hashConfiguration(configuration: Record<string, unknown> | null | undefined): string {
    if (!configuration || Object.keys(configuration).length === 0) return '';
    // Sort keys so `{a:1,b:2}` and `{b:2,a:1}` hash identically —
    // configuration is meant as an unordered bag of choices, not a
    // sequence.
    const sorted = Object.keys(configuration)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = configuration[key];
        return acc;
      }, {});
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
  }
}
