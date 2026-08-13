import type {
  ParsedPaymentCallback,
  PaymentProviderHealthResult,
  PaymentProviderIntentResult,
  PaymentProviderRefundResult,
  PaymentProviderStartResult,
  PaymentProviderVerifyResult,
} from '@iecp/types';
import { Injectable, Logger } from '@nestjs/common';

import type { PaymentProviderAdapter } from '../../domain/ports/payment-provider-adapter.port';

export interface ZarinpalAdapterConfig {
  merchantId: string;
  isSandbox: boolean;
}

/**
 * Two hardcoded endpoint pairs, selected only by `isSandbox` — never by
 * anything read from `PaymentProvider.config` (admin-editable JSON in
 * Postgres) or any other request-supplied value. `config` is meant for
 * non-secret operational settings, not an outbound request target; if a
 * `baseUrl`-style field were ever accepted from that JSON instead, a
 * compromised admin session or a bad migration could turn this adapter
 * into an open server-side-request forwarder. Real ZarinPal v4 REST
 * contract, not a mock: `request.json` -> `Authority`, redirect via
 * `/pg/StartPay/:authority`, `verify.json` -> `RefID`.
 */
const API_BASE = {
  production: 'https://api.zarinpal.com/pg/v4/payment',
  sandbox: 'https://sandbox.zarinpal.com/pg/v4/payment',
} as const;

const START_PAY_BASE = {
  production: 'https://www.zarinpal.com/pg/StartPay',
  sandbox: 'https://sandbox.zarinpal.com/pg/StartPay',
} as const;

const REQUEST_TIMEOUT_MS = 15_000;

interface ZarinpalApiErrorShape {
  code: number;
  message: string;
  validations?: unknown;
}

interface ZarinpalEnvelope<T> {
  data: T | Record<string, never>;
  errors: ZarinpalApiErrorShape | [];
}

interface ZarinpalRequestData {
  code: number;
  message: string;
  authority: string;
  fee_type?: string;
  fee?: number;
}

interface ZarinpalVerifyData {
  code: number;
  message: string;
  ref_id?: number;
  card_hash?: string;
  card_pan?: string;
}

interface ZarinpalReverseData {
  code: number;
  message: string;
}

/**
 * `PaymentProviderAdapter.createPaymentIntent`/`startPayment`/
 * `verifyPayment`/`queryPayment`/`refundPayment`/`parseCallback`/
 * `healthCheck` against ZarinPal's real documented REST contract
 * (ADR-008 decision 5). ZarinPal's base currency for this API is Rial —
 * this system's own base unit — so `amount` needs no conversion.
 *
 * Two real gaps in ZarinPal's own API, documented rather than hidden
 * behind a fake success:
 * - `verify.json`/`reverse.json` are keyed on the request's `Authority`,
 *   not the settled transaction's `RefID` (what `PaymentTransaction
 *   .providerReference` stores). Callers of `queryPayment()`/
 *   `refundPayment()` on this adapter must pass the original
 *   `PaymentAttempt.providerAuthority` as `providerReference` — the
 *   application layer resolves this via `PaymentTransaction
 *   .paymentAttemptId` before calling either method.
 * - ZarinPal has no cryptographic callback signature (unlike e.g. a
 *   Stripe-style HMAC webhook) — `parseCallback()`'s `signatureValid`
 *   only reflects "well-formed `Authority`/`Status` query params," never
 *   proof of payment. That's exactly why ADR-008 decision 3 forbids
 *   trusting a callback alone: real trust here always comes from the
 *   follow-up `verifyPayment()` call.
 */
@Injectable()
export class ZarinpalAdapter implements PaymentProviderAdapter {
  readonly providerCode = 'zarinpal';
  private readonly logger = new Logger(ZarinpalAdapter.name);
  private readonly apiBase: string;
  private readonly startPayBase: string;

  constructor(private readonly config: ZarinpalAdapterConfig) {
    this.apiBase = config.isSandbox ? API_BASE.sandbox : API_BASE.production;
    this.startPayBase = config.isSandbox ? START_PAY_BASE.sandbox : START_PAY_BASE.production;
  }

  async createPaymentIntent(props: {
    amount: bigint;
    currency: string;
    description: string;
    callbackUrl: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentProviderIntentResult> {
    const result = await this.post<ZarinpalRequestData>('/request.json', {
      merchant_id: this.config.merchantId,
      amount: Number(props.amount),
      description: props.description,
      callback_url: props.callbackUrl,
      metadata: props.metadata,
    });
    return {
      providerAuthority: result.authority,
      redirectUrl: `${this.startPayBase}/${result.authority}`,
    };
  }

  startPayment(providerAuthority: string): Promise<PaymentProviderStartResult> {
    return Promise.resolve({ redirectUrl: `${this.startPayBase}/${providerAuthority}` });
  }

  async verifyPayment(props: {
    providerAuthority: string;
    amount: bigint;
    currency: string;
  }): Promise<PaymentProviderVerifyResult> {
    try {
      const result = await this.post<ZarinpalVerifyData>('/verify.json', {
        merchant_id: this.config.merchantId,
        amount: Number(props.amount),
        authority: props.providerAuthority,
      });
      // 100 = verified now; 101 = already verified in a prior call — both
      // are a real, successful payment, never re-triggering settlement.
      const verified = result.code === 100 || result.code === 101;
      return {
        verified,
        providerReference: verified && result.ref_id !== undefined ? String(result.ref_id) : null,
        amount: props.amount.toString(),
        // ZarinPal only ever settles in Rial — this system's only
        // CurrencyCode today — so the literal is honest, not a cast
        // around untrusted input.
        currency: 'IRR',
        raw: result as unknown as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.warn(`ZarinPal verifyPayment failed: ${String(error)}`);
      return {
        verified: false,
        providerReference: null,
        amount: props.amount.toString(),
        // ZarinPal only ever settles in Rial — this system's only
        // CurrencyCode today — so the literal is honest, not a cast
        // around untrusted input.
        currency: 'IRR',
        raw: { error: String(error) },
      };
    }
  }

  /** ZarinPal has no separate query endpoint — `verify.json` is itself
   * idempotent (see the `code === 101` branch above), so re-calling it is
   * the real "check status without re-triggering settlement" operation.
   * `providerReference` here must be the original `Authority` (see this
   * class's own doc comment). */
  queryPayment(providerReference: string): Promise<PaymentProviderVerifyResult> {
    return this.verifyPayment({
      providerAuthority: providerReference,
      amount: 0n,
      currency: 'IRR',
    });
  }

  async refundPayment(props: {
    providerReference: string;
    amount: bigint;
    reason?: string;
  }): Promise<PaymentProviderRefundResult> {
    try {
      const result = await this.post<ZarinpalReverseData>('/reverse.json', {
        merchant_id: this.config.merchantId,
        authority: props.providerReference,
      });
      return {
        accepted: result.code === 100,
        providerRefundReference: result.code === 100 ? props.providerReference : null,
        raw: result as unknown as Record<string, unknown>,
      };
    } catch (error) {
      this.logger.warn(`ZarinPal refundPayment failed: ${String(error)}`);
      return { accepted: false, providerRefundReference: null, raw: { error: String(error) } };
    }
  }

  parseCallback(rawPayload: Record<string, unknown>): ParsedPaymentCallback {
    const rawAuthority = rawPayload['Authority'];
    const authority = typeof rawAuthority === 'string' ? rawAuthority : null;
    const status = typeof rawPayload['Status'] === 'string' ? rawPayload['Status'] : null;
    return {
      providerAuthority: authority,
      dedupeKey: `zarinpal:${authority ?? 'unknown'}:${status ?? 'unknown'}`,
      claimedStatus: status === 'OK' ? 'PAID' : status === 'NOK' ? 'FAILED' : 'UNKNOWN',
    };
  }

  async healthCheck(): Promise<PaymentProviderHealthResult> {
    // ZarinPal has no dedicated health-check endpoint; a request with a
    // deliberately invalid (zero) amount is rejected fast with a real,
    // well-formed error envelope, which is enough to prove the API is
    // reachable and answering — never a real payment intent. Deliberately
    // NOT a bare `response.status < 500` check: a network intermediary
    // between this service and ZarinPal (a misconfigured proxy, a
    // captive portal) can answer with its own non-5xx status without
    // ZarinPal ever seeing the request — only a body that actually
    // parses as ZarinPal's own `{ data, errors }` envelope counts as
    // "reachable and answering."
    try {
      const response = await fetch(`${this.apiBase}/request.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          merchant_id: this.config.merchantId,
          amount: 0,
          description: 'health-check',
          callback_url: 'https://example.com/health-check',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body: unknown = await response.json();
      const isZarinpalEnvelope =
        typeof body === 'object' && body !== null && 'data' in body && 'errors' in body;
      return {
        ok: isZarinpalEnvelope,
        checkedAt: new Date().toISOString(),
        detail: isZarinpalEnvelope ? null : `Unexpected response shape (HTTP ${response.status})`,
      };
    } catch (error) {
      return { ok: false, checkedAt: new Date().toISOString(), detail: String(error) };
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const envelope = (await response.json()) as ZarinpalEnvelope<T>;
    // A successful call's `errors` is an empty array; a failed one's is
    // the error object itself — never both shapes at once.
    if (!Array.isArray(envelope.errors)) {
      const err = envelope.errors;
      throw new Error(`ZarinPal API error ${err.code}: ${err.message}`);
    }
    return envelope.data as T;
  }
}
