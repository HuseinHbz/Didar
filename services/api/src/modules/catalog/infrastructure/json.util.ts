import { Prisma } from '@iecp/database';

/**
 * Casts a Prisma `Json?` column's value to the shape the application layer
 * validated it against before writing it (see `@iecp/types`' LocalizedText/
 * SeoMetadata/CollectionRules). Prisma types every JSON column as the
 * generic `Prisma.JsonValue`, which is correct at the database layer (it
 * genuinely doesn't know the shape) but not useful past the repository
 * boundary — the repository is where that knowledge belongs, matching how
 * `identity`'s repositories cast Prisma's generated enum/id string types
 * back to this project's branded types.
 *
 * `T` appears only in the return position, which `no-unnecessary-type-
 * parameters` flags as providing no inference benefit — true, but the
 * point of this helper *is* letting each call site explicitly instantiate
 * the shape it knows the column holds (`fromJson<LocalizedText>(row.seo)`),
 * the same justified pattern as identity's `test/identity.e2e-spec.ts`
 * `body<T>()` helper; the rule has no carve-out for it.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function fromJson<T>(value: Prisma.JsonValue | null): T | null {
  return value === null ? null : (value as T);
}

/**
 * Inverse: prepares a typed value for a Prisma `Json?` write. Only called
 * once the caller has already decided the field belongs in the `data`
 * object (i.e. after an `!== undefined` check) — `null` here means
 * "clear the column," mapped to Prisma's `JsonNull` sentinel (a bare SQL
 * `NULL`, not the JSON string `"null"`, which `null as InputJsonValue`
 * would otherwise silently become). Same justified single-use-generic
 * pattern as `fromJson` above.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export function toJson<T>(value: T | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}
