import type { PaymentProviderVerifyResult } from '@iecp/types';

export type VerificationOutcome =
  { readonly matched: true } | { readonly matched: false; readonly reason: string };

/**
 * ADR-008 decision 3, made a pure, independently-testable function: a
 * provider's `verifyPayment()` response is trusted only after it's
 * checked against what the `PaymentIntent` actually expects — its own
 * `amount`/`currency`, never the callback payload's claimed amount. Any
 * mismatch (or the provider itself reporting `verified: false`) is
 * `matched: false`, which the application layer's verify-payment use
 * case turns into `PaymentTransaction.status = FAILED`, never a silent
 * accept. `providerReference` must also be present — a "verified" result
 * with no reference to record is not something this system can act on.
 */
export class VerificationMatcher {
  static evaluate(
    intent: { amount: bigint; currency: string },
    result: PaymentProviderVerifyResult,
  ): VerificationOutcome {
    if (!result.verified) {
      return { matched: false, reason: 'Provider reported the payment as not verified' };
    }
    if (result.providerReference === null || result.providerReference.length === 0) {
      return { matched: false, reason: 'Provider returned no reference for a verified payment' };
    }
    if (BigInt(result.amount) !== intent.amount) {
      return {
        matched: false,
        reason: `Verified amount ${result.amount} does not match the intent's amount ${intent.amount.toString()}`,
      };
    }
    if (result.currency !== intent.currency) {
      return {
        matched: false,
        reason: `Verified currency ${result.currency} does not match the intent's currency ${intent.currency}`,
      };
    }
    return { matched: true };
  }
}
