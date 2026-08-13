/**
 * Shared shapes for Phase 008's payment orchestration — see
 * `docs/adr/ADR-008-payment-orchestration.md`. These are the
 * `PaymentProviderAdapter` interface's return contracts (ADR-008 decision
 * 5): the domain layer depends on these shapes, the infrastructure
 * layer's real ZarinPal adapter produces them, and tests assert against
 * them — one canonical definition instead of three drifting copies. Money
 * fields are decimal strings (bigint serialized), never JSON numbers,
 * same convention as `PricingResolutionResult`.
 */

import type { CurrencyCode } from './money.js';

/** `PaymentProviderAdapter.createPaymentIntent()` — the provider-side
 * handle a `PaymentAttempt` is opened against. `providerAuthority` is
 * ZarinPal's own term (`Authority`) generalized for any adapter. */
export interface PaymentProviderIntentResult {
  providerAuthority: string;
  redirectUrl: string;
}

/** `PaymentProviderAdapter.startPayment()` — nothing beyond the redirect
 * itself; ADR-008 decision 3 forbids treating this as proof of anything. */
export interface PaymentProviderStartResult {
  redirectUrl: string;
}

/** `PaymentProviderAdapter.verifyPayment()` / `queryPayment()` — the only
 * shape allowed to produce a `PaymentTransaction` (ADR-008 decision 3).
 * `verified: false` means the provider itself rejected/never completed
 * the payment, not a transport error (those throw). */
export interface PaymentProviderVerifyResult {
  verified: boolean;
  providerReference: string | null;
  amount: string;
  currency: CurrencyCode;
  raw: Record<string, unknown>;
}

/** `PaymentProviderAdapter.refundPayment()` result (ADR-008 decision 6). */
export interface PaymentProviderRefundResult {
  accepted: boolean;
  providerRefundReference: string | null;
  raw: Record<string, unknown>;
}

/** `PaymentProviderAdapter.parseCallback()` — turns a provider's raw
 * inbound payload into the fields needed to look up the matching
 * `PaymentIntent`/`PaymentAttempt` and trigger re-verification (ADR-008
 * decision 4). Never itself trusted as proof of payment. */
export interface ParsedPaymentCallback {
  providerAuthority: string | null;
  dedupeKey: string;
  claimedStatus: 'PAID' | 'FAILED' | 'UNKNOWN';
}

/** `PaymentProviderAdapter.healthCheck()` result — backs
 * `PaymentProvider.lastHealthCheckAt`/`lastHealthCheckOk`. */
export interface PaymentProviderHealthResult {
  ok: boolean;
  checkedAt: string;
  detail: string | null;
}
