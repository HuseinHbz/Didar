import { randomUUID } from 'node:crypto';

import type {
  ParsedPaymentCallback,
  PaymentProviderHealthResult,
  PaymentProviderIntentResult,
  PaymentProviderRefundResult,
  PaymentProviderStartResult,
  PaymentProviderVerifyResult,
} from '@iecp/types';

import type {
  PaymentProviderAdapter,
  PaymentProviderAdapterRegistry,
} from '../../src/modules/payment/domain/ports/payment-provider-adapter.port';

/**
 * A real `PaymentProviderAdapter` implementation, minus the actual network
 * call — this sandboxed environment's outbound proxy policy does not
 * allow reaching `sandbox.zarinpal.com` (confirmed via `curl`: the
 * gateway answers the CONNECT with a 403, "policy denial or upstream
 * failure" — see this session's own investigation of that constraint),
 * so a real end-to-end test against the live sandbox cannot run here.
 * This fake is the standard boundary-substitution every payment-gateway
 * test suite uses for exactly this reason: it satisfies the same
 * `PaymentProviderAdapter` contract `ZarinpalAdapter` does (so every
 * caller — `PaymentIntentService`, `RefundService`,
 * `ReconciliationService`, and now Phase 009's `OrderConversionService` —
 * runs its real code, unmodified), and only the HTTP call to ZarinPal
 * itself is swapped for a deterministic, per-authority-configurable
 * result. `ZarinpalAdapter`'s own request/response shapes were verified
 * separately against the real (blocked) network boundary during Phase
 * 008's own implementation.
 *
 * Shared between `payment.e2e-spec.ts` and `order.e2e-spec.ts` — both
 * override the same `PAYMENT_PROVIDER_ADAPTER_REGISTRY` token, and
 * duplicating this class per file would drift the two suites' payment
 * behavior apart for no reason.
 */
export class FakePaymentProviderAdapter implements PaymentProviderAdapter {
  readonly providerCode = 'zarinpal';
  private readonly verifyOverrides = new Map<string, PaymentProviderVerifyResult>();
  private readonly refundOverrides = new Map<string, PaymentProviderRefundResult>();
  public verifyCallCount = 0;

  /** Configures what `verifyPayment()` returns for one specific
   * `providerAuthority` — the default (no override) is "verified,
   * matching whatever amount/currency was asked for," which is the
   * common happy path every test that doesn't care about verification
   * detail can rely on. */
  setVerifyResult(providerAuthority: string, result: PaymentProviderVerifyResult): void {
    this.verifyOverrides.set(providerAuthority, result);
  }

  setRefundResult(providerReference: string, result: PaymentProviderRefundResult): void {
    this.refundOverrides.set(providerReference, result);
  }

  createPaymentIntent(_props: {
    amount: bigint;
    currency: string;
    description: string;
    callbackUrl: string;
  }): Promise<PaymentProviderIntentResult> {
    const authority = `FAKE-AUTH-${randomUUID()}`;
    return Promise.resolve({
      providerAuthority: authority,
      redirectUrl: `https://fake.zarinpal.test/pg/StartPay/${authority}`,
    });
  }

  startPayment(providerAuthority: string): Promise<PaymentProviderStartResult> {
    return Promise.resolve({
      redirectUrl: `https://fake.zarinpal.test/pg/StartPay/${providerAuthority}`,
    });
  }

  verifyPayment(props: {
    providerAuthority: string;
    amount: bigint;
    currency: string;
  }): Promise<PaymentProviderVerifyResult> {
    this.verifyCallCount += 1;
    const override = this.verifyOverrides.get(props.providerAuthority);
    if (override) return Promise.resolve(override);
    return Promise.resolve({
      verified: true,
      providerReference: `FAKE-REF-${props.providerAuthority}`,
      amount: props.amount.toString(),
      // This system only ever handles IRR — same "literal, not a cast
      // around untrusted input" reasoning ZarinpalAdapter itself uses.
      currency: 'IRR',
      raw: { fake: true, code: 100 },
    });
  }

  queryPayment(providerReference: string): Promise<PaymentProviderVerifyResult> {
    return this.verifyPayment({
      providerAuthority: providerReference,
      amount: 0n,
      currency: 'IRR',
    });
  }

  refundPayment(props: {
    providerReference: string;
    amount: bigint;
  }): Promise<PaymentProviderRefundResult> {
    const override = this.refundOverrides.get(props.providerReference);
    if (override) return Promise.resolve(override);
    return Promise.resolve({
      accepted: true,
      providerRefundReference: `FAKE-REFUND-${props.providerReference}`,
      raw: { fake: true, code: 100 },
    });
  }

  parseCallback(rawPayload: Record<string, unknown>): ParsedPaymentCallback {
    const authority = typeof rawPayload['Authority'] === 'string' ? rawPayload['Authority'] : null;
    const status = typeof rawPayload['Status'] === 'string' ? rawPayload['Status'] : null;
    const nonce = typeof rawPayload['nonce'] === 'string' ? rawPayload['nonce'] : '';
    return {
      providerAuthority: authority,
      dedupeKey: `zarinpal:${authority ?? 'unknown'}:${status ?? 'unknown'}:${nonce}`,
      claimedStatus: status === 'OK' ? 'PAID' : status === 'NOK' ? 'FAILED' : 'UNKNOWN',
    };
  }

  healthCheck(): Promise<PaymentProviderHealthResult> {
    return Promise.resolve({ ok: true, checkedAt: new Date().toISOString(), detail: null });
  }
}

export class FakePaymentProviderAdapterRegistry implements PaymentProviderAdapterRegistry {
  readonly adapter = new FakePaymentProviderAdapter();
  resolve(): PaymentProviderAdapter {
    return this.adapter;
  }
}
