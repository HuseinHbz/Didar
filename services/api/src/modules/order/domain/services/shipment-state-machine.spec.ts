import { InvalidShipmentTransitionError, ShipmentStateMachine } from './shipment-state-machine';

describe('ShipmentStateMachine', () => {
  it('allows the happy path', () => {
    expect(ShipmentStateMachine.canTransition('PENDING', 'IN_TRANSIT')).toBe(true);
    expect(ShipmentStateMachine.canTransition('IN_TRANSIT', 'DELIVERED')).toBe(true);
  });

  it('allows a failed transit', () => {
    expect(ShipmentStateMachine.canTransition('IN_TRANSIT', 'FAILED')).toBe(true);
  });

  it('allows cancellation only from PENDING', () => {
    expect(ShipmentStateMachine.canTransition('PENDING', 'CANCELLED')).toBe(true);
    expect(ShipmentStateMachine.canTransition('IN_TRANSIT', 'CANCELLED')).toBe(false);
    expect(() => {
      ShipmentStateMachine.assertTransition('IN_TRANSIT', 'CANCELLED');
    }).toThrow(InvalidShipmentTransitionError);
  });

  it('rejects a transition out of DELIVERED', () => {
    expect(ShipmentStateMachine.canTransition('DELIVERED', 'IN_TRANSIT')).toBe(false);
  });
});
