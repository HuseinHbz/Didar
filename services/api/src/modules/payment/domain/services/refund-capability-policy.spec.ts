import { RefundCapabilityPolicy } from './refund-capability-policy';

describe('RefundCapabilityPolicy', () => {
  const transactionAmount = 1_000_000n;
  const wholeOnly = { partialRefund: false } as const;
  const partialCapable = { partialRefund: true } as const;

  it('allows a refund of the whole transaction on a whole-transaction-only gateway', () => {
    expect(
      RefundCapabilityPolicy.evaluate({
        refundAmount: transactionAmount,
        transactionAmount,
        capabilities: wholeOnly,
      }),
    ).toEqual({ allowed: true });
  });

  it('refuses a partial refund on a whole-transaction-only gateway, saying why', () => {
    const decision = RefundCapabilityPolicy.evaluate({
      refundAmount: 400_000n,
      transactionAmount,
      capabilities: wholeOnly,
    });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) throw new Error('unreachable');
    expect(decision.reason).toMatch(/partial/i);
    // The reason names both amounts so finance can act on it without a lookup…
    expect(decision.reason).toContain('400000');
    expect(decision.reason).toContain('1000000');
    // …and says nothing reached the provider.
    expect(decision.reason).toMatch(/nothing was sent/i);
  });

  it('refuses even a one-unit shortfall — there is no "close enough to whole"', () => {
    const decision = RefundCapabilityPolicy.evaluate({
      refundAmount: transactionAmount - 1n,
      transactionAmount,
      capabilities: wholeOnly,
    });
    expect(decision.allowed).toBe(false);
  });

  it('allows a partial refund on a gateway that declares partial-refund support', () => {
    expect(
      RefundCapabilityPolicy.evaluate({
        refundAmount: 1n,
        transactionAmount,
        capabilities: partialCapable,
      }),
    ).toEqual({ allowed: true });
  });

  it('allows a whole refund on a partial-capable gateway too', () => {
    expect(
      RefundCapabilityPolicy.evaluate({
        refundAmount: transactionAmount,
        transactionAmount,
        capabilities: partialCapable,
      }),
    ).toEqual({ allowed: true });
  });

  it('never allows an amount larger than the transaction, whatever the gateway can do', () => {
    for (const capabilities of [wholeOnly, partialCapable]) {
      const decision = RefundCapabilityPolicy.evaluate({
        refundAmount: transactionAmount + 1n,
        transactionAmount,
        capabilities,
      });
      expect(decision.allowed).toBe(false);
      if (decision.allowed) throw new Error('unreachable');
      expect(decision.reason).toMatch(/larger than/i);
    }
  });
});
