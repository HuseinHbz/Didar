import {
  FulfillmentStateMachine,
  InvalidFulfillmentTransitionError,
} from './fulfillment-state-machine';

describe('FulfillmentStateMachine', () => {
  it('allows the happy path', () => {
    expect(FulfillmentStateMachine.canTransition('PENDING', 'ALLOCATED')).toBe(true);
    expect(FulfillmentStateMachine.canTransition('ALLOCATED', 'PROCESSING')).toBe(true);
    expect(FulfillmentStateMachine.canTransition('PROCESSING', 'PACKED')).toBe(true);
    expect(FulfillmentStateMachine.canTransition('PACKED', 'READY')).toBe(true);
    expect(FulfillmentStateMachine.canTransition('READY', 'SHIPPED')).toBe(true);
    expect(FulfillmentStateMachine.canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('allows cancellation up through READY', () => {
    expect(FulfillmentStateMachine.canTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(FulfillmentStateMachine.canTransition('READY', 'CANCELLED')).toBe(true);
  });

  it('rejects cancellation once SHIPPED or DELIVERED', () => {
    expect(FulfillmentStateMachine.canTransition('SHIPPED', 'CANCELLED')).toBe(false);
    expect(FulfillmentStateMachine.canTransition('DELIVERED', 'CANCELLED')).toBe(false);
    expect(() => {
      FulfillmentStateMachine.assertTransition('SHIPPED', 'CANCELLED');
    }).toThrow(InvalidFulfillmentTransitionError);
  });

  it('rejects skipping straight from PENDING to SHIPPED', () => {
    expect(FulfillmentStateMachine.canTransition('PENDING', 'SHIPPED')).toBe(false);
  });

  it('treats a same-status call as a no-op', () => {
    expect(FulfillmentStateMachine.isNoOp('DELIVERED', 'DELIVERED')).toBe(true);
    expect(() => {
      FulfillmentStateMachine.assertTransition('DELIVERED', 'DELIVERED');
    }).not.toThrow();
  });
});
