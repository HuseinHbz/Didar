import type { CollectionRules } from '@iecp/types';

export interface EvaluableProduct {
  brandId: string;
  categoryId: string;
  tags: readonly string[];
  gender: string | null;
  productType: string;
}

/**
 * Pure predicate over a fixed, narrow rule shape (ADR-005 decision 4 — not
 * a general rule engine). `CollectionRepositoryPort`'s dynamic-membership
 * query translates the same fields into a Prisma `where` clause for
 * listing at scale; this evaluator exists for single-item "does this
 * product belong to this dynamic collection" checks and, more importantly,
 * so the rule semantics have one place they're both defined and
 * unit-tested — the repository's `where`-clause translation is expected to
 * agree with it, not redefine it.
 */
export class CollectionRuleEvaluator {
  static matches(rules: CollectionRules, product: EvaluableProduct): boolean {
    if (rules.brandId && rules.brandId !== product.brandId) return false;
    if (rules.categoryId && rules.categoryId !== product.categoryId) return false;
    if (rules.gender && rules.gender !== product.gender) return false;
    if (rules.productType && rules.productType !== product.productType) return false;
    if (rules.tags && rules.tags.length > 0) {
      const hasAnyTag = rules.tags.some((tag) => product.tags.includes(tag));
      if (!hasAnyTag) return false;
    }
    return true;
  }
}
