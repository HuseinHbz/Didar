import { ReturnEligibilityValidator, ReturnNotEligibleError } from './return-eligibility-validator';

const DAY_MS = 86_400_000;

function baseInput(
  overrides: Partial<Parameters<typeof ReturnEligibilityValidator.assertEligible>[0]> = {},
) {
  const now = new Date('2026-06-01T00:00:00.000Z');
  return {
    orderStatus: 'FULFILLED' as const,
    orderPaymentStatus: 'PAID' as const,
    items: [{ orderItemId: 'item-1', deliveredAt: new Date(now.getTime() - 5 * DAY_MS) }],
    windowDays: 30,
    now,
    ...overrides,
  };
}

describe('ReturnEligibilityValidator', () => {
  it('allows a delivered item well within the return window', () => {
    expect(() => {
      ReturnEligibilityValidator.assertEligible(baseInput());
    }).not.toThrow();
  });

  it('allows both FULFILLED and COMPLETED order statuses', () => {
    expect(ReturnEligibilityValidator.isEligible(baseInput({ orderStatus: 'FULFILLED' }))).toBe(
      true,
    );
    expect(ReturnEligibilityValidator.isEligible(baseInput({ orderStatus: 'COMPLETED' }))).toBe(
      true,
    );
  });

  it('rejects an order that is not FULFILLED/COMPLETED', () => {
    expect(() => {
      ReturnEligibilityValidator.assertEligible(baseInput({ orderStatus: 'PROCESSING' }));
    }).toThrow(ReturnNotEligibleError);
    expect(() => {
      ReturnEligibilityValidator.assertEligible(baseInput({ orderStatus: 'CANCELLED' }));
    }).toThrow(ReturnNotEligibleError);
  });

  it('allows both PAID and PARTIALLY_REFUNDED payment statuses', () => {
    expect(
      ReturnEligibilityValidator.isEligible(
        baseInput({ orderPaymentStatus: 'PARTIALLY_REFUNDED' }),
      ),
    ).toBe(true);
  });

  it('rejects an order whose payment is not settled', () => {
    expect(() => {
      ReturnEligibilityValidator.assertEligible(baseInput({ orderPaymentStatus: 'UNPAID' }));
    }).toThrow(ReturnNotEligibleError);
  });

  it('rejects a request naming zero items', () => {
    expect(() => {
      ReturnEligibilityValidator.assertEligible(baseInput({ items: [] }));
    }).toThrow(ReturnNotEligibleError);
  });

  it('rejects a line that was never delivered', () => {
    expect(() => {
      ReturnEligibilityValidator.assertEligible(
        baseInput({ items: [{ orderItemId: 'item-1', deliveredAt: null }] }),
      );
    }).toThrow(ReturnNotEligibleError);
  });

  it('allows a return requested exactly on the last day of the window', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const deliveredAt = new Date(now.getTime() - 30 * DAY_MS);
    expect(() => {
      ReturnEligibilityValidator.assertEligible(
        baseInput({ now, items: [{ orderItemId: 'item-1', deliveredAt }] }),
      );
    }).not.toThrow();
  });

  it('rejects a return requested after the window has expired', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const deliveredAt = new Date(now.getTime() - 31 * DAY_MS);
    expect(() => {
      ReturnEligibilityValidator.assertEligible(
        baseInput({ now, items: [{ orderItemId: 'item-1', deliveredAt }] }),
      );
    }).toThrow(ReturnNotEligibleError);
  });

  it('respects a configurable window (fallback 30, but any value the caller supplies)', () => {
    const now = new Date('2026-06-01T00:00:00.000Z');
    const deliveredAt = new Date(now.getTime() - 10 * DAY_MS);
    expect(() => {
      ReturnEligibilityValidator.assertEligible(
        baseInput({ now, windowDays: 7, items: [{ orderItemId: 'item-1', deliveredAt }] }),
      );
    }).toThrow(ReturnNotEligibleError);
    expect(() => {
      ReturnEligibilityValidator.assertEligible(
        baseInput({ now, windowDays: 14, items: [{ orderItemId: 'item-1', deliveredAt }] }),
      );
    }).not.toThrow();
  });

  it('collects every failing reason, not just the first', () => {
    try {
      ReturnEligibilityValidator.assertEligible(
        baseInput({ orderStatus: 'PROCESSING', orderPaymentStatus: 'UNPAID' }),
      );
      fail('expected ReturnNotEligibleError to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ReturnNotEligibleError);
      const err = error as ReturnNotEligibleError;
      expect(err.reasons.length).toBeGreaterThanOrEqual(2);
    }
  });
});
