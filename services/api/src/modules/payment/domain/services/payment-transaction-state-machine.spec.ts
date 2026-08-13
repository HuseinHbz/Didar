import {
  InvalidPaymentTransactionTransitionError,
  PaymentTransactionStateMachine,
} from './payment-transaction-state-machine';

describe('PaymentTransactionStateMachine', () => {
  it('allows PENDING to resolve either way', () => {
    expect(PaymentTransactionStateMachine.canTransition('PENDING', 'VERIFIED')).toBe(true);
    expect(PaymentTransactionStateMachine.canTransition('PENDING', 'FAILED')).toBe(true);
  });

  it('rejects any transition out of VERIFIED — immutable once verified', () => {
    expect(PaymentTransactionStateMachine.canTransition('VERIFIED', 'FAILED')).toBe(false);
    expect(PaymentTransactionStateMachine.canTransition('VERIFIED', 'PENDING')).toBe(false);
    expect(() => {
      PaymentTransactionStateMachine.assertTransition('VERIFIED', 'FAILED');
    }).toThrow(InvalidPaymentTransactionTransitionError);
  });

  it('rejects any transition out of FAILED', () => {
    expect(PaymentTransactionStateMachine.canTransition('FAILED', 'VERIFIED')).toBe(false);
  });

  it('treats a same-status call as a no-op', () => {
    expect(PaymentTransactionStateMachine.isNoOp('VERIFIED', 'VERIFIED')).toBe(true);
    expect(() => {
      PaymentTransactionStateMachine.assertTransition('VERIFIED', 'VERIFIED');
    }).not.toThrow();
  });
});
