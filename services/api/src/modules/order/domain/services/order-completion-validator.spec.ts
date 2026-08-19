import {
  OrderCompletionValidator,
  OrderNotReadyToCompleteError,
} from './order-completion-validator';

const readyInput = {
  fulfillmentStatus: 'FULFILLED' as const,
  paymentStatus: 'PAID' as const,
  fulfillments: [{ status: 'DELIVERED' as const }],
};

describe('OrderCompletionValidator', () => {
  it('allows completion when fulfilled, paid, and every active fulfillment is delivered', () => {
    expect(() => {
      OrderCompletionValidator.assertReady(readyInput);
    }).not.toThrow();
    expect(OrderCompletionValidator.isReady(readyInput)).toBe(true);
  });

  it('allows completion with multiple fulfillments as long as every non-cancelled one is delivered', () => {
    const input = {
      ...readyInput,
      fulfillments: [
        { status: 'DELIVERED' as const },
        { status: 'DELIVERED' as const },
        { status: 'CANCELLED' as const }, // ignored — not active
      ],
    };
    expect(() => {
      OrderCompletionValidator.assertReady(input);
    }).not.toThrow();
  });

  it('rejects when fulfillmentStatus is not FULFILLED', () => {
    const input = { ...readyInput, fulfillmentStatus: 'PARTIALLY_FULFILLED' as const };
    expect(() => {
      OrderCompletionValidator.assertReady(input);
    }).toThrow(OrderNotReadyToCompleteError);
    expect(OrderCompletionValidator.isReady(input)).toBe(false);
  });

  it('rejects when the order is still UNPAID or PARTIALLY_PAID', () => {
    expect(() => {
      OrderCompletionValidator.assertReady({ ...readyInput, paymentStatus: 'UNPAID' });
    }).toThrow(OrderNotReadyToCompleteError);
    expect(() => {
      OrderCompletionValidator.assertReady({ ...readyInput, paymentStatus: 'PARTIALLY_PAID' });
    }).toThrow(OrderNotReadyToCompleteError);
  });

  it('rejects when a fulfillment quantity-covers the order but has not shipped/delivered yet', () => {
    const input = { ...readyInput, fulfillments: [{ status: 'PACKED' as const }] };
    expect(() => {
      OrderCompletionValidator.assertReady(input);
    }).toThrow(OrderNotReadyToCompleteError);
  });

  it('rejects when there is no active fulfillment at all (e.g. the only one was cancelled)', () => {
    const input = { ...readyInput, fulfillments: [{ status: 'CANCELLED' as const }] };
    expect(() => {
      OrderCompletionValidator.assertReady(input);
    }).toThrow(OrderNotReadyToCompleteError);
  });

  it('rejects when fulfillments is empty', () => {
    const input = { ...readyInput, fulfillments: [] };
    expect(() => {
      OrderCompletionValidator.assertReady(input);
    }).toThrow(OrderNotReadyToCompleteError);
  });

  it('accumulates every failing reason, not just the first', () => {
    expect.assertions(2);
    const input = {
      fulfillmentStatus: 'UNFULFILLED' as const,
      paymentStatus: 'UNPAID' as const,
      fulfillments: [],
    };
    try {
      OrderCompletionValidator.assertReady(input);
    } catch (error) {
      expect(error).toBeInstanceOf(OrderNotReadyToCompleteError);
      expect((error as OrderNotReadyToCompleteError).reasons.length).toBeGreaterThanOrEqual(3);
    }
  });
});
