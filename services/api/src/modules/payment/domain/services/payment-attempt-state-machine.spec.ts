import {
  InvalidPaymentAttemptTransitionError,
  PaymentAttemptStateMachine,
} from './payment-attempt-state-machine';

describe('PaymentAttemptStateMachine', () => {
  it('allows the happy path', () => {
    expect(PaymentAttemptStateMachine.canTransition('INITIATED', 'REDIRECTED')).toBe(true);
    expect(PaymentAttemptStateMachine.canTransition('REDIRECTED', 'RETURNED')).toBe(true);
  });

  it('allows abandonment/expiry from either non-terminal state', () => {
    expect(PaymentAttemptStateMachine.canTransition('INITIATED', 'ABANDONED')).toBe(true);
    expect(PaymentAttemptStateMachine.canTransition('INITIATED', 'EXPIRED')).toBe(true);
    expect(PaymentAttemptStateMachine.canTransition('REDIRECTED', 'ABANDONED')).toBe(true);
    expect(PaymentAttemptStateMachine.canTransition('REDIRECTED', 'EXPIRED')).toBe(true);
  });

  it('treats a same-status call as a no-op', () => {
    expect(PaymentAttemptStateMachine.isNoOp('RETURNED', 'RETURNED')).toBe(true);
  });

  it('rejects any transition out of a terminal state', () => {
    expect(PaymentAttemptStateMachine.canTransition('RETURNED', 'ABANDONED')).toBe(false);
    expect(PaymentAttemptStateMachine.canTransition('ABANDONED', 'REDIRECTED')).toBe(false);
    expect(() => {
      PaymentAttemptStateMachine.assertTransition('EXPIRED', 'RETURNED');
    }).toThrow(InvalidPaymentAttemptTransitionError);
  });

  it('rejects skipping straight from INITIATED to RETURNED', () => {
    expect(PaymentAttemptStateMachine.canTransition('INITIATED', 'RETURNED')).toBe(false);
  });
});
