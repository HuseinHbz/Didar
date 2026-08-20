import { InvalidOrderTransitionError, OrderStateMachine } from './order-state-machine';

describe('OrderStateMachine', () => {
  it('allows the happy path', () => {
    expect(OrderStateMachine.canTransition('PENDING_PAYMENT', 'PAID')).toBe(true);
    expect(OrderStateMachine.canTransition('PAID', 'PROCESSING')).toBe(true);
    expect(OrderStateMachine.canTransition('PROCESSING', 'READY_TO_FULFILL')).toBe(true);
    expect(OrderStateMachine.canTransition('READY_TO_FULFILL', 'FULFILLED')).toBe(true);
    expect(OrderStateMachine.canTransition('FULFILLED', 'COMPLETED')).toBe(true);
  });

  it('allows the partial-fulfillment path', () => {
    expect(OrderStateMachine.canTransition('READY_TO_FULFILL', 'PARTIALLY_FULFILLED')).toBe(true);
    expect(OrderStateMachine.canTransition('PARTIALLY_FULFILLED', 'FULFILLED')).toBe(true);
  });

  it('treats a same-status call as a no-op, not an error', () => {
    expect(OrderStateMachine.isNoOp('CANCELLED', 'CANCELLED')).toBe(true);
    expect(() => {
      OrderStateMachine.assertTransition('COMPLETED', 'COMPLETED');
    }).not.toThrow();
  });

  it('rejects the brief’s three explicit illegal-transition examples', () => {
    expect(OrderStateMachine.canTransition('PENDING_PAYMENT', 'FULFILLED')).toBe(false);
    expect(() => {
      OrderStateMachine.assertTransition('PENDING_PAYMENT', 'FULFILLED');
    }).toThrow(InvalidOrderTransitionError);

    expect(OrderStateMachine.canTransition('CANCELLED', 'PAID')).toBe(false);
    expect(() => {
      OrderStateMachine.assertTransition('CANCELLED', 'PAID');
    }).toThrow(InvalidOrderTransitionError);

    expect(OrderStateMachine.canTransition('COMPLETED', 'PROCESSING')).toBe(false);
    expect(() => {
      OrderStateMachine.assertTransition('COMPLETED', 'PROCESSING');
    }).toThrow(InvalidOrderTransitionError);
  });

  it('rejects cancellation once fulfillment has begun or completed', () => {
    expect(OrderStateMachine.canTransition('PARTIALLY_FULFILLED', 'CANCELLED')).toBe(false);
    expect(OrderStateMachine.canTransition('FULFILLED', 'CANCELLED')).toBe(false);
    expect(OrderStateMachine.canTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('allows cancellation from every pre-fulfillment state', () => {
    expect(OrderStateMachine.isCancellable('PENDING_PAYMENT')).toBe(true);
    expect(OrderStateMachine.isCancellable('PAID')).toBe(true);
    expect(OrderStateMachine.isCancellable('PROCESSING')).toBe(true);
    expect(OrderStateMachine.isCancellable('READY_TO_FULFILL')).toBe(true);
  });

  it('reports CANCELLED itself and post-fulfillment states as not cancellable', () => {
    expect(OrderStateMachine.isCancellable('CANCELLED')).toBe(false);
    expect(OrderStateMachine.isCancellable('PARTIALLY_FULFILLED')).toBe(false);
    expect(OrderStateMachine.isCancellable('FULFILLED')).toBe(false);
    expect(OrderStateMachine.isCancellable('COMPLETED')).toBe(false);
  });
});
