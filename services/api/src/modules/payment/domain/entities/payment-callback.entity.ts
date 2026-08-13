import {
  asPaymentCallbackId,
  asPaymentIntentId,
  asPaymentProviderId,
  type PaymentCallbackId,
  type PaymentIntentId,
  type PaymentProviderId,
} from '@iecp/types';

/** Raw, append-only inbox for every inbound callback/webhook (ADR-008
 * decision 4) — persisted verbatim before any processing, so a rejected
 * callback still leaves an audit trail. Never itself the source of truth
 * for whether payment succeeded — processing always re-derives that
 * through `verifyPayment()`. */
export class PaymentCallback {
  private constructor(
    public readonly id: PaymentCallbackId,
    public readonly paymentIntentId: PaymentIntentId | null,
    public readonly providerId: PaymentProviderId,
    public readonly dedupeKey: string,
    public readonly rawPayload: Record<string, unknown>,
    public readonly signatureValid: boolean,
    public readonly processedAt: Date | null,
    public readonly receivedAt: Date,
  ) {}

  static create(props: {
    id: string;
    paymentIntentId?: string | null;
    providerId: string;
    dedupeKey: string;
    rawPayload: Record<string, unknown>;
    signatureValid: boolean;
    processedAt?: Date | null;
    receivedAt: Date;
  }): PaymentCallback {
    return new PaymentCallback(
      asPaymentCallbackId(props.id),
      props.paymentIntentId ? asPaymentIntentId(props.paymentIntentId) : null,
      asPaymentProviderId(props.providerId),
      props.dedupeKey,
      props.rawPayload,
      props.signatureValid,
      props.processedAt ?? null,
      props.receivedAt,
    );
  }

  get isProcessed(): boolean {
    return this.processedAt !== null;
  }
}
