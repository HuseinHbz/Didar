import { InvalidRefundTransitionError, RefundStateMachine } from './refund-state-machine';

describe('RefundStateMachine', () => {
  it('allows the happy path to COMPLETED', () => {
    expect(RefundStateMachine.canTransition('PENDING', 'PROCESSING')).toBe(true);
    expect(RefundStateMachine.canTransition('PROCESSING', 'COMPLETED')).toBe(true);
  });

  it('allows PROCESSING to resolve to FAILED or REJECTED', () => {
    expect(RefundStateMachine.canTransition('PROCESSING', 'FAILED')).toBe(true);
    expect(RefundStateMachine.canTransition('PROCESSING', 'REJECTED')).toBe(true);
  });

  it('rejects skipping PROCESSING entirely', () => {
    expect(RefundStateMachine.canTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(RefundStateMachine.canTransition('PENDING', 'REJECTED')).toBe(false);
  });

  it('rejects any transition out of a terminal state', () => {
    expect(RefundStateMachine.canTransition('COMPLETED', 'PROCESSING')).toBe(false);
    expect(() => {
      RefundStateMachine.assertTransition('REJECTED', 'PROCESSING');
    }).toThrow(InvalidRefundTransitionError);
  });

  it('treats a same-status call as a no-op', () => {
    expect(RefundStateMachine.isNoOp('COMPLETED', 'COMPLETED')).toBe(true);
  });
});
