import {
  InvalidPurchaseOrderTransitionError,
  PurchaseOrderStateMachine,
} from './purchase-order-state-machine';

describe('PurchaseOrderStateMachine', () => {
  it('allows the full happy path to a single-delivery close', () => {
    const path: Parameters<typeof PurchaseOrderStateMachine.assertTransition>[] = [
      ['DRAFT', 'SUBMITTED'],
      ['SUBMITTED', 'APPROVED'],
      ['APPROVED', 'RECEIVED'],
    ];
    for (const [from, to] of path) {
      expect(() => {
        PurchaseOrderStateMachine.assertTransition(from, to);
      }).not.toThrow();
    }
  });

  it('allows a partial receipt before the final receipt', () => {
    expect(() => {
      PurchaseOrderStateMachine.assertTransition('APPROVED', 'PARTIALLY_RECEIVED');
    }).not.toThrow();
    expect(() => {
      PurchaseOrderStateMachine.assertTransition('PARTIALLY_RECEIVED', 'RECEIVED');
    }).not.toThrow();
  });

  it('allows cancellation from every pre-receiving state', () => {
    for (const from of ['DRAFT', 'SUBMITTED', 'APPROVED'] as const) {
      expect(PurchaseOrderStateMachine.canCancel(from)).toBe(true);
      expect(() => {
        PurchaseOrderStateMachine.assertCanCancel(from);
      }).not.toThrow();
    }
  });

  it('rejects cancellation once any receiving has happened', () => {
    expect(PurchaseOrderStateMachine.canCancel('PARTIALLY_RECEIVED')).toBe(false);
    expect(() => {
      PurchaseOrderStateMachine.assertCanCancel('PARTIALLY_RECEIVED');
    }).toThrow(InvalidPurchaseOrderTransitionError);
    expect(() => {
      PurchaseOrderStateMachine.assertCanCancel('RECEIVED');
    }).toThrow(InvalidPurchaseOrderTransitionError);
  });

  it('rejects skipping states (e.g. SUBMITTED straight to RECEIVED)', () => {
    expect(() => {
      PurchaseOrderStateMachine.assertTransition('SUBMITTED', 'RECEIVED');
    }).toThrow(InvalidPurchaseOrderTransitionError);
  });

  it('RECEIVED and CANCELLED are terminal', () => {
    expect(PurchaseOrderStateMachine.canTransition('RECEIVED', 'CANCELLED')).toBe(false);
    expect(PurchaseOrderStateMachine.canTransition('CANCELLED', 'SUBMITTED')).toBe(false);
  });

  describe('receiving', () => {
    it('allows receiving only while APPROVED or PARTIALLY_RECEIVED', () => {
      expect(() => {
        PurchaseOrderStateMachine.assertCanReceive('APPROVED');
      }).not.toThrow();
      expect(() => {
        PurchaseOrderStateMachine.assertCanReceive('PARTIALLY_RECEIVED');
      }).not.toThrow();
    });

    it('rejects receiving against a not-yet-approved, received, or cancelled order', () => {
      for (const status of ['DRAFT', 'SUBMITTED', 'RECEIVED', 'CANCELLED'] as const) {
        expect(() => {
          PurchaseOrderStateMachine.assertCanReceive(status);
        }).toThrow(InvalidPurchaseOrderTransitionError);
      }
    });

    it('computes RECEIVED only when every line is fully received', () => {
      expect(PurchaseOrderStateMachine.nextStatusAfterReceipt(true)).toBe('RECEIVED');
      expect(PurchaseOrderStateMachine.nextStatusAfterReceipt(false)).toBe('PARTIALLY_RECEIVED');
    });
  });
});
