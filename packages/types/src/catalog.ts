/**
 * Shared shapes for the catalog's JSON columns (Phase 005 — see
 * docs/adr/ADR-005-catalog-architecture.md decision 3). These are the
 * contracts `services/api`'s catalog DTOs validate against and
 * `packages/database`'s `Json?` columns (`localizedName`, `seo`, `rules`,
 * ...) are expected to hold — not enforced by Postgres itself, enforced at
 * the application boundary.
 */

/**
 * Localized short text — `{ fa: "...", en: "..." }`. Deliberately a
 * different shape from `Locale` (`'fa-IR' | 'en-US'`, packages/types'
 * `enums.ts`): `Locale` is the `Accept-Language`-style tag used for API
 * content negotiation, this is the bare-language key used inside stored
 * JSON, where a region subtag would be redundant (catalog content isn't
 * region-varied within a language).
 */
export interface LocalizedText {
  fa: string;
  en?: string;
}

/**
 * SEO metadata bag — Brand/Category/Collection/Product's `seo` column.
 * Every field optional: a brand-new draft has none of these yet, and unset
 * fields fall back to computed defaults (e.g. title -> the entity's own
 * name) at the presentation layer, not stored as duplicated data here.
 */
export interface SeoMetadata {
  title?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  ogImageMediaId?: string;
  noIndex?: boolean;
  /** e.g. "Product", "BrandStore" — schema.org @type hint for future JSON-LD. */
  structuredDataType?: string;
}

/**
 * Dynamic collection membership rule (Collection.rules, `type = DYNAMIC`
 * only) — a fixed, narrow filter shape, deliberately not a general
 * expression AST. See ADR-005 decision 4 and
 * services/api's CollectionRuleEvaluator (domain layer) for how this is
 * turned into repository-level filter criteria.
 */
export interface CollectionRules {
  brandId?: string;
  categoryId?: string;
  tags?: string[];
  gender?: string;
  productType?: string;
}
