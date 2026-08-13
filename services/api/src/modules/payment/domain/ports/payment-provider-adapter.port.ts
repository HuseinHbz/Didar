import type {
  ParsedPaymentCallback,
  PaymentProviderHealthResult,
  PaymentProviderIntentResult,
  PaymentProviderRefundResult,
  PaymentProviderStartResult,
  PaymentProviderVerifyResult,
} from '@iecp/types';

/**
 * The actual provider-independence boundary (ADR-008 decision 5).
 * Implemented once for real against ZarinPal's documented REST contract
 * (`infrastructure/providers/zarinpal.adapter.ts`) — no application-layer
 * code branches on "which gateway," only an adapter does. A second
 * gateway later is implementing this interface again and registering a
 * second `PaymentProvider` row, zero changes here.
 */
export interface PaymentProviderAdapter {
  readonly providerCode: string;

  /** Opens the provider-side handle a `PaymentAttempt` is created
   * against (ZarinPal's `PaymentRequest.json` -> `Authority`). */
  createPaymentIntent(props: {
    amount: bigint;
    currency: string;
    description: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentProviderIntentResult>;

  /** Returns the URL the customer is redirected to. Never itself proof
   * of anything (ADR-008 decision 3). */
  startPayment(providerAuthority: string): Promise<PaymentProviderStartResult>;

  /** The only call allowed to produce a `PaymentTransaction` — a real
   * server-to-server request to the provider, never inferred from the
   * redirect return (ADR-008 decision 3). */
  verifyPayment(props: {
    providerAuthority: string;
    amount: bigint;
    currency: string;
  }): Promise<PaymentProviderVerifyResult>;

  /** Idempotent re-check of an already-processed payment's status,
   * without re-triggering settlement (used by reconciliation and
   * verification-retry jobs). */
  queryPayment(providerReference: string): Promise<PaymentProviderVerifyResult>;

  refundPayment(props: {
    providerReference: string;
    amount: bigint;
    reason?: string;
  }): Promise<PaymentProviderRefundResult>;

  /** Turns a raw inbound callback body into the fields needed to look up
   * the matching intent/attempt — never itself trusted as proof of
   * payment (ADR-008 decision 4). */
  parseCallback(rawPayload: Record<string, unknown>): ParsedPaymentCallback;

  healthCheck(): Promise<PaymentProviderHealthResult>;
}

export const PAYMENT_PROVIDER_ADAPTER_REGISTRY = Symbol('PAYMENT_PROVIDER_ADAPTER_REGISTRY');

export class UnknownPaymentProviderError extends Error {
  constructor(code: string) {
    super(`No PaymentProviderAdapter is registered for provider code "${code}"`);
    this.name = 'UnknownPaymentProviderError';
  }
}

/** Resolves the real adapter instance for a `PaymentProvider` row
 * (ADR-008 decision 5) — the one place application-layer use cases go
 * from "which provider row" to "which adapter to call." Takes `isSandbox`
 * alongside `code` (not just the code) because the adapter needs it to
 * pick the right base URL at construction time (see `ZarinpalAdapter`'s
 * own doc comment on why that choice is never made from `config` JSON);
 * the caller already has the full `PaymentProvider` row loaded by the
 * time it needs an adapter, so this stays a synchronous, no-I/O lookup. */
export interface PaymentProviderAdapterRegistry {
  resolve(provider: { code: string; isSandbox: boolean }): PaymentProviderAdapter;
}
