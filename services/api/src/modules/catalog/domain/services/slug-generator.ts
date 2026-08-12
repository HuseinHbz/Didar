import { slugify } from '@iecp/validation';

/**
 * Pure slug derivation. Uniqueness (does `slug` already exist for this
 * entity type?) is a repository concern, not domain logic — the
 * application-layer use case calls `base()` once, then probes the
 * repository with `withSuffix()` candidates until one is free. Kept pure
 * and DB-free so it's unit-testable without a database, same discipline as
 * identity's PermissionResolver.
 */
export class SlugGenerator {
  /** Derives the first candidate slug from a display name. */
  static base(name: string): string {
    return slugify(name);
  }

  /** Deterministic collision-breaker: `my-slug`, `my-slug-2`, `my-slug-3`, ... */
  static withSuffix(base: string, attempt: number): string {
    return attempt <= 1 ? base : `${base}-${attempt}`;
  }
}
