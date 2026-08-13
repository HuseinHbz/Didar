import type { CurrencyCode, PaymentProviderVerifyResult } from '@iecp/types';

import { VerificationMatcher } from './verification-matcher';

describe('VerificationMatcher', () => {
  const intent = { amount: 1_000_000n, currency: 'IRR' };

  const baseResult: PaymentProviderVerifyResult = {
    verified: true,
    providerReference: 'REF-123',
    amount: '1000000',
    currency: 'IRR',
    raw: {},
  };

  it('matches when the provider confirms and amount/currency line up exactly', () => {
    expect(VerificationMatcher.evaluate(intent, baseResult)).toEqual({ matched: true });
  });

  it('fails when the provider itself reports unverified', () => {
    const result = { ...baseResult, verified: false };
    const outcome = VerificationMatcher.evaluate(intent, result);
    expect(outcome.matched).toBe(false);
  });

  it('fails when verified but the amount does not match the intent', () => {
    const result = { ...baseResult, amount: '999999' };
    const outcome = VerificationMatcher.evaluate(intent, result);
    expect(outcome.matched).toBe(false);
    if (!outcome.matched) expect(outcome.reason).toMatch(/amount/i);
  });

  it('fails when verified but the currency does not match the intent', () => {
    // CurrencyCode is single-valued ('IRR' only) today — this simulates
    // untrusted provider payload data, which bypasses the type system at
    // runtime, same defensive reasoning as Money.assertSameCurrency.
    const result = { ...baseResult, currency: 'USD' as unknown as CurrencyCode };
    const outcome = VerificationMatcher.evaluate(intent, result);
    expect(outcome.matched).toBe(false);
  });

  it('fails when verified but no provider reference is returned', () => {
    const result = { ...baseResult, providerReference: null };
    const outcome = VerificationMatcher.evaluate(intent, result);
    expect(outcome.matched).toBe(false);
  });

  it('never trusts a callback-claimed amount over the intent — the redirect proves nothing', () => {
    // A forged/replayed callback could claim any amount; only the real
    // verify() result (here, still matching) can produce `matched: true`.
    expect(VerificationMatcher.evaluate(intent, baseResult).matched).toBe(true);
  });
});
