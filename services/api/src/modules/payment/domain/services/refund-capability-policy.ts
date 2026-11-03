import type { PaymentProviderCapabilities } from '../ports/payment-provider-adapter.port';

/** The verdict on whether a refund may be sent to a gateway. A value, not an
 * exception: a refused refund is an expected business outcome that must be
 * recorded against the refund (`failureReason`) and surfaced to finance, never
 * a 500 or a swallowed error. */
export type RefundCapabilityDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/**
 * CP-031 (gap P0-6) — "never send a gateway what it cannot express".
 *
 * ZarinPal's `reverse.json` has no amount field: it reverses a transaction as a
 * whole. The ledger, however, happily records a *partial* refund. Sending that
 * request on would either be refused (money not returned, ledger says it is
 * pending) or accepted as a whole-transaction reversal (the customer is refunded
 * more than the ledger records) — either way the ledger and the gateway
 * disagree about where the money is, with no alert. So the decision is made
 * here, from the adapter's *declared* capabilities, before anything is sent:
 *
 * - a refund of the whole transaction is something every gateway can express;
 * - a smaller amount needs `capabilities.partialRefund`;
 * - an amount larger than the transaction is never sendable (the amount guard in
 *   `RefundValidator` makes this unreachable through the application, so this is
 *   defence in depth, kept so the policy is total over its inputs).
 *
 * Pure and I/O-free like the other domain services; `RefundService` calls it
 * after loading the transaction and resolving the adapter.
 */
export class RefundCapabilityPolicy {
  static evaluate(input: {
    refundAmount: bigint;
    transactionAmount: bigint;
    capabilities: PaymentProviderCapabilities;
  }): RefundCapabilityDecision {
    const { refundAmount, transactionAmount, capabilities } = input;

    if (refundAmount > transactionAmount) {
      return {
        allowed: false,
        reason:
          `Refund not sent: the amount ${refundAmount.toString()} is larger than the ` +
          `original transaction (${transactionAmount.toString()}).`,
      };
    }
    if (refundAmount === transactionAmount || capabilities.partialRefund) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason:
        `Partial refund not sent: the payment provider can only reverse a transaction as ` +
        `a whole, and this refund is ${refundAmount.toString()} of ` +
        `${transactionAmount.toString()}. Settle the refund with the customer manually ` +
        `and record it; nothing was sent to the provider.`,
    };
  }
}
