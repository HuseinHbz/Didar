import { InvalidReturnTransitionError, ReturnStateMachine } from './return-state-machine';

describe('ReturnStateMachine', () => {
  it('allows the happy path', () => {
    expect(ReturnStateMachine.canTransition('REQUESTED', 'APPROVED')).toBe(true);
    expect(ReturnStateMachine.canTransition('APPROVED', 'CUSTOMER_SHIPPING')).toBe(true);
    expect(ReturnStateMachine.canTransition('CUSTOMER_SHIPPING', 'RECEIVED')).toBe(true);
    expect(ReturnStateMachine.canTransition('RECEIVED', 'INSPECTING')).toBe(true);
    expect(ReturnStateMachine.canTransition('INSPECTING', 'APPROVED_FOR_REFUND')).toBe(true);
    expect(ReturnStateMachine.canTransition('APPROVED_FOR_REFUND', 'REFUNDED')).toBe(true);
    expect(ReturnStateMachine.canTransition('REFUNDED', 'COMPLETED')).toBe(true);
  });

  it('allows REJECTED from REQUESTED, APPROVED, and INSPECTING', () => {
    expect(ReturnStateMachine.canTransition('REQUESTED', 'REJECTED')).toBe(true);
    expect(ReturnStateMachine.canTransition('APPROVED', 'REJECTED')).toBe(true);
    expect(ReturnStateMachine.canTransition('INSPECTING', 'REJECTED')).toBe(true);
  });

  it('never allows REJECTED once APPROVED_FOR_REFUND or later', () => {
    expect(ReturnStateMachine.canTransition('APPROVED_FOR_REFUND', 'REJECTED')).toBe(false);
    expect(ReturnStateMachine.canTransition('REFUNDED', 'REJECTED')).toBe(false);
    expect(ReturnStateMachine.canTransition('COMPLETED', 'REJECTED')).toBe(false);
  });

  it('allows CANCELLED from REQUESTED, APPROVED, and CUSTOMER_SHIPPING only', () => {
    expect(ReturnStateMachine.canTransition('REQUESTED', 'CANCELLED')).toBe(true);
    expect(ReturnStateMachine.canTransition('APPROVED', 'CANCELLED')).toBe(true);
    expect(ReturnStateMachine.canTransition('CUSTOMER_SHIPPING', 'CANCELLED')).toBe(true);
    expect(ReturnStateMachine.canTransition('RECEIVED', 'CANCELLED')).toBe(false);
    expect(ReturnStateMachine.canTransition('INSPECTING', 'CANCELLED')).toBe(false);
  });

  it('rejects skipping straight from REQUESTED to RECEIVED', () => {
    expect(ReturnStateMachine.canTransition('REQUESTED', 'RECEIVED')).toBe(false);
    expect(() => {
      ReturnStateMachine.assertTransition('REQUESTED', 'RECEIVED');
    }).toThrow(InvalidReturnTransitionError);
  });

  it('treats a same-status call as a no-op', () => {
    expect(ReturnStateMachine.isNoOp('APPROVED', 'APPROVED')).toBe(true);
    expect(() => {
      ReturnStateMachine.assertTransition('APPROVED', 'APPROVED');
    }).not.toThrow();
  });

  it('treats every terminal status as having no further transitions', () => {
    expect(ReturnStateMachine.canTransition('REJECTED', 'APPROVED')).toBe(false);
    expect(ReturnStateMachine.canTransition('CANCELLED', 'APPROVED')).toBe(false);
    expect(ReturnStateMachine.canTransition('COMPLETED', 'APPROVED')).toBe(false);
  });

  describe('isCancellable', () => {
    it('is true for every pre-receipt status', () => {
      expect(ReturnStateMachine.isCancellable('REQUESTED')).toBe(true);
      expect(ReturnStateMachine.isCancellable('APPROVED')).toBe(true);
      expect(ReturnStateMachine.isCancellable('CUSTOMER_SHIPPING')).toBe(true);
    });

    it('is false once RECEIVED or beyond, and false for CANCELLED itself', () => {
      expect(ReturnStateMachine.isCancellable('RECEIVED')).toBe(false);
      expect(ReturnStateMachine.isCancellable('INSPECTING')).toBe(false);
      expect(ReturnStateMachine.isCancellable('APPROVED_FOR_REFUND')).toBe(false);
      expect(ReturnStateMachine.isCancellable('CANCELLED')).toBe(false);
    });
  });
});
