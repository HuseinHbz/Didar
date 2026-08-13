import {
  InvalidPaymentIntentTransitionError,
  PaymentIntentStateMachine,
} from './payment-intent-state-machine';

describe('PaymentIntentStateMachine', () => {
  it('allows the happy path', () => {
    expect(PaymentIntentStateMachine.canTransition('CREATED', 'AWAITING_PAYMENT')).toBe(true);
    expect(PaymentIntentStateMachine.canTransition('AWAITING_PAYMENT', 'PROCESSING')).toBe(true);
    expect(PaymentIntentStateMachine.canTransition('PROCESSING', 'SUCCEEDED')).toBe(true);
  });

  it('allows retry after a failure', () => {
    expect(PaymentIntentStateMachine.canTransition('PROCESSING', 'FAILED')).toBe(true);
    expect(PaymentIntentStateMachine.canTransition('FAILED', 'AWAITING_PAYMENT')).toBe(true);
  });

  it('treats a same-status call as a no-op, not an error', () => {
    expect(PaymentIntentStateMachine.isNoOp('SUCCEEDED', 'SUCCEEDED')).toBe(true);
    expect(() => {
      PaymentIntentStateMachine.assertTransition('SUCCEEDED', 'SUCCEEDED');
    }).not.toThrow();
  });

  it('rejects a transition out of SUCCEEDED', () => {
    expect(PaymentIntentStateMachine.canTransition('SUCCEEDED', 'FAILED')).toBe(false);
    expect(() => {
      PaymentIntentStateMachine.assertTransition('SUCCEEDED', 'FAILED');
    }).toThrow(InvalidPaymentIntentTransitionError);
  });

  it('rejects skipping straight from CREATED to SUCCEEDED', () => {
    expect(PaymentIntentStateMachine.canTransition('CREATED', 'SUCCEEDED')).toBe(false);
  });

  it('rejects retrying from a terminal EXPIRED/CANCELLED state', () => {
    expect(PaymentIntentStateMachine.canTransition('EXPIRED', 'AWAITING_PAYMENT')).toBe(false);
    expect(PaymentIntentStateMachine.canTransition('CANCELLED', 'AWAITING_PAYMENT')).toBe(false);
  });
});
