import { InvalidTransferTransitionError, TransferStateMachine } from './transfer-state-machine';

describe('TransferStateMachine', () => {
  it('allows the full happy path', () => {
    const path: Parameters<typeof TransferStateMachine.assertTransition>[] = [
      ['DRAFT', 'REQUESTED'],
      ['REQUESTED', 'APPROVED'],
      ['APPROVED', 'PICKING'],
      ['PICKING', 'DISPATCHED'],
      ['DISPATCHED', 'IN_TRANSIT'],
      ['IN_TRANSIT', 'RECEIVED'],
    ];
    for (const [from, to] of path) {
      expect(() => {
        TransferStateMachine.assertTransition(from, to);
      }).not.toThrow();
    }
  });

  it('allows a partial receipt before the final receipt', () => {
    expect(() => {
      TransferStateMachine.assertTransition('IN_TRANSIT', 'PARTIALLY_RECEIVED');
    }).not.toThrow();
    expect(() => {
      TransferStateMachine.assertTransition('PARTIALLY_RECEIVED', 'RECEIVED');
    }).not.toThrow();
  });

  it('allows cancellation from every pre-dispatch state', () => {
    for (const from of ['DRAFT', 'REQUESTED', 'APPROVED', 'PICKING'] as const) {
      expect(() => {
        TransferStateMachine.assertTransition(from, 'CANCELLED');
      }).not.toThrow();
    }
  });

  it('rejects cancellation once dispatched', () => {
    expect(() => {
      TransferStateMachine.assertTransition('DISPATCHED', 'CANCELLED');
    }).toThrow(InvalidTransferTransitionError);
  });

  it('rejects skipping states (e.g. REQUESTED straight to DISPATCHED)', () => {
    expect(() => {
      TransferStateMachine.assertTransition('REQUESTED', 'DISPATCHED');
    }).toThrow(InvalidTransferTransitionError);
  });

  it('RECEIVED and CANCELLED are terminal', () => {
    expect(TransferStateMachine.canTransition('RECEIVED', 'DISPATCHED')).toBe(false);
    expect(TransferStateMachine.canTransition('CANCELLED', 'DRAFT')).toBe(false);
  });
});
