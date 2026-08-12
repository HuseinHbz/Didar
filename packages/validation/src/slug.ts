import { z } from 'zod';

/**
 * Catalog slug strategy (Phase 005 — blueprint's "Persian slug strategy"
 * requirement). Unlike a typical Latin-only slugify, this project's
 * storefront URLs are Persian-first (root CLAUDE.md: "fa-IR first") — a
 * slug is allowed to *stay* Persian (`/محصولات/عینک-ری-بن-آویاتور`) rather
 * than being forced through a lossy transliteration to Latin. What's
 * enforced is the URL-safety properties that matter regardless of script:
 * lowercase Latin where Latin is used, hyphen-separated segments, no
 * whitespace, no consecutive/leading/trailing hyphens.
 */

// Persian/Arabic block (؀-ۿ) covers the letters this platform's
// content actually uses; combined with lowercase Latin, digits, and hyphen.
const SLUG_RE = /^[a-z0-9؀-ۿ]+(?:-[a-z0-9؀-ۿ]+)*$/;

/** Validates an already-chosen slug (e.g. on a create/update DTO). */
export const slugSchema = z
  .string()
  .trim()
  .min(1, 'Slug is required')
  .max(200, 'Slug is too long')
  .regex(SLUG_RE, 'Slug must be lowercase, hyphen-separated, and contain no whitespace');

export type Slug = z.infer<typeof slugSchema>;

// Perso-Arabic homoglyphs that commonly appear in pasted/typed Persian text
// but aren't the canonical Persian codepoint — normalized so two names that
// read identically in Persian don't produce two different slugs.
const PERSIAN_NORMALIZE: readonly (readonly [RegExp, string])[] = [
  [/ي/g, 'ی'], // Arabic Yeh -> Persian Yeh (ی)
  [/ك/g, 'ک'], // Arabic Kaf -> Persian Keh (ک)
  [/[ً-ْ]/g, ''], // strip Arabic diacritics (tashkeel)
];

/**
 * Derives a URL-safe slug from a display name. Pure and deterministic — no
 * uniqueness check or DB access here; that's the application layer's job
 * (see services/api's catalog `SlugGenerator` domain service, which layers
 * a uniqueness suffix on top of this).
 */
export function slugify(input: string): string {
  let value = input.trim().toLowerCase();
  for (const [pattern, replacement] of PERSIAN_NORMALIZE) {
    value = value.replace(pattern, replacement);
  }
  return value
    .replace(/[^a-z0-9؀-ۿ\s-]/g, '') // drop anything not letter/digit/space/hyphen
    .replace(/[\s_]+/g, '-') // whitespace/underscore runs -> one hyphen
    .replace(/-+/g, '-') // collapse repeated hyphens
    .replace(/^-|-$/g, ''); // trim leading/trailing hyphen
}
