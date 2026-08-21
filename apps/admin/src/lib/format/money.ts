import { Money } from '@iecp/types';

/** Every money field in every admin DTO serializes as a plain decimal
 * Rial-integer string (`bigint.toString()` — verified against
 * order/return/payment DTOs before this phase started, never
 * `Money.toJSON()`'s `{amount,currency}` shape). Reconstructs a real
 * `Money` and formats via its own `.formatToman()` — the only place
 * Persian-locale number formatting happens (ADR-018 decision 5), never
 * re-implemented here. */
export function formatRial(value: string | null | undefined): string {
  if (value === null || value === undefined) return '—';
  try {
    return Money.ofRial(BigInt(value)).formatToman('fa-IR');
  } catch {
    return value;
  }
}
