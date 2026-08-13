import { CheckoutStateMachine, InvalidCheckoutTransitionError } from './checkout-state-machine';

describe('CheckoutStateMachine', () => {
  it('allows the happy path OPEN -> VALIDATING -> READY_FOR_PAYMENT -> CONVERTED', () => {
    expect(CheckoutStateMachine.canTransition('OPEN', 'VALIDATING')).toBe(true);
    expect(CheckoutStateMachine.canTransition('VALIDATING', 'READY_FOR_PAYMENT')).toBe(true);
    expect(CheckoutStateMachine.canTransition('READY_FOR_PAYMENT', 'CONVERTED')).toBe(true);
  });

  it('allows EXPIRED/CANCELLED from any non-terminal state', () => {
    expect(CheckoutStateMachine.canTransition('OPEN', 'EXPIRED')).toBe(true);
    expect(CheckoutStateMachine.canTransition('VALIDATING', 'CANCELLED')).toBe(true);
    expect(CheckoutStateMachine.canTransition('READY_FOR_PAYMENT', 'CANCELLED')).toBe(true);
  });

  it('rejects CONVERTED from anything but READY_FOR_PAYMENT', () => {
    expect(CheckoutStateMachine.canTransition('OPEN', 'CONVERTED')).toBe(false);
    expect(CheckoutStateMachine.canTransition('VALIDATING', 'CONVERTED')).toBe(false);
  });

  it('rejects any transition out of a terminal state', () => {
    expect(CheckoutStateMachine.canTransition('EXPIRED', 'OPEN')).toBe(false);
    expect(CheckoutStateMachine.canTransition('CANCELLED', 'VALIDATING')).toBe(false);
    expect(CheckoutStateMachine.canTransition('CONVERTED', 'CANCELLED')).toBe(false);
  });

  it('treats a same-status transition as a no-op, not an error', () => {
    expect(CheckoutStateMachine.canTransition('CANCELLED', 'CANCELLED')).toBe(true);
    expect(CheckoutStateMachine.isNoOp('CANCELLED', 'CANCELLED')).toBe(true);
  });

  it('assertTransition throws InvalidCheckoutTransitionError for an illegal move', () => {
    expect(() => {
      CheckoutStateMachine.assertTransition('OPEN', 'CONVERTED');
    }).toThrow(InvalidCheckoutTransitionError);
  });
});
