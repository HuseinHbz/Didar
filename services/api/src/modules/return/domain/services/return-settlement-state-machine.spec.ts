import type { ReturnSettlementStatus } from '@iecp/types';

import {
  InvalidReturnSettlementTransitionError,
  ReturnSettlementStateMachine,
} from './return-settlement-state-machine';

const ALL_STATUSES: readonly ReturnSettlementStatus[] = [
  'PENDING_RESTOCK',
  'RESTOCKED',
  'REFUND_REQUESTED',
  'SETTLED',
  'COMPLETED',
  'FAILED_RETRYABLE',
  'FAILED_TERMINAL',
  'MANUAL_REVIEW',
];

describe('ReturnSettlementStateMachine', () => {
  it('allows the full happy path in order', () => {
    expect(ReturnSettlementStateMachine.canTransition('PENDING_RESTOCK', 'RESTOCKED')).toBe(true);
    expect(ReturnSettlementStateMachine.canTransition('RESTOCKED', 'REFUND_REQUESTED')).toBe(true);
    expect(ReturnSettlementStateMachine.canTransition('REFUND_REQUESTED', 'SETTLED')).toBe(true);
    expect(ReturnSettlementStateMachine.canTransition('SETTLED', 'COMPLETED')).toBe(true);
  });

  it('rejects skipping straight from PENDING_RESTOCK to REFUND_REQUESTED', () => {
    expect(ReturnSettlementStateMachine.canTransition('PENDING_RESTOCK', 'REFUND_REQUESTED')).toBe(
      false,
    );
    expect(() => {
      ReturnSettlementStateMachine.assertTransition('PENDING_RESTOCK', 'REFUND_REQUESTED');
    }).toThrow(InvalidReturnSettlementTransitionError);
  });

  it('rejects skipping straight from PENDING_RESTOCK to SETTLED/COMPLETED', () => {
    expect(ReturnSettlementStateMachine.canTransition('PENDING_RESTOCK', 'SETTLED')).toBe(false);
    expect(ReturnSettlementStateMachine.canTransition('PENDING_RESTOCK', 'COMPLETED')).toBe(false);
  });

  it('allows FAILED_TERMINAL and MANUAL_REVIEW from every active, non-SETTLED/COMPLETED state', () => {
    for (const from of ['PENDING_RESTOCK', 'RESTOCKED', 'REFUND_REQUESTED'] as const) {
      expect(ReturnSettlementStateMachine.canTransition(from, 'FAILED_TERMINAL')).toBe(true);
      expect(ReturnSettlementStateMachine.canTransition(from, 'MANUAL_REVIEW')).toBe(true);
    }
  });

  it('never allows FAILED_TERMINAL or MANUAL_REVIEW once SETTLED or COMPLETED', () => {
    for (const from of ['SETTLED', 'COMPLETED'] as const) {
      expect(ReturnSettlementStateMachine.canTransition(from, 'FAILED_TERMINAL')).toBe(false);
      expect(ReturnSettlementStateMachine.canTransition(from, 'MANUAL_REVIEW')).toBe(false);
    }
  });

  it('treats COMPLETED and FAILED_TERMINAL as true dead ends — no transition out, ever', () => {
    for (const to of ALL_STATUSES) {
      if (to === 'COMPLETED') continue; // isNoOp — same-status is always allowed
      expect(ReturnSettlementStateMachine.canTransition('COMPLETED', to)).toBe(false);
    }
    for (const to of ALL_STATUSES) {
      if (to === 'FAILED_TERMINAL') continue;
      expect(ReturnSettlementStateMachine.canTransition('FAILED_TERMINAL', to)).toBe(false);
    }
  });

  it('FAILED_RETRYABLE is unreachable — no transition leads into it, and it has none out', () => {
    for (const from of ALL_STATUSES) {
      if (from === 'FAILED_RETRYABLE') continue;
      expect(ReturnSettlementStateMachine.canTransition(from, 'FAILED_RETRYABLE')).toBe(false);
    }
    for (const to of ALL_STATUSES) {
      if (to === 'FAILED_RETRYABLE') continue;
      expect(ReturnSettlementStateMachine.canTransition('FAILED_RETRYABLE', to)).toBe(false);
    }
  });

  it('MANUAL_REVIEW can resume into any progressing state, or acknowledge as terminal', () => {
    expect(ReturnSettlementStateMachine.canTransition('MANUAL_REVIEW', 'PENDING_RESTOCK')).toBe(
      true,
    );
    expect(ReturnSettlementStateMachine.canTransition('MANUAL_REVIEW', 'RESTOCKED')).toBe(true);
    expect(ReturnSettlementStateMachine.canTransition('MANUAL_REVIEW', 'REFUND_REQUESTED')).toBe(
      true,
    );
    expect(ReturnSettlementStateMachine.canTransition('MANUAL_REVIEW', 'FAILED_TERMINAL')).toBe(
      true,
    );
  });

  it('MANUAL_REVIEW never jumps straight to SETTLED or COMPLETED', () => {
    expect(ReturnSettlementStateMachine.canTransition('MANUAL_REVIEW', 'SETTLED')).toBe(false);
    expect(ReturnSettlementStateMachine.canTransition('MANUAL_REVIEW', 'COMPLETED')).toBe(false);
  });

  it('treats a same-status call as a no-op for every status, even the dead ends', () => {
    for (const status of ALL_STATUSES) {
      expect(ReturnSettlementStateMachine.isNoOp(status, status)).toBe(true);
      expect(() => {
        ReturnSettlementStateMachine.assertTransition(status, status);
      }).not.toThrow();
    }
  });

  describe('isActive', () => {
    it('is true for every progressing state', () => {
      for (const status of [
        'PENDING_RESTOCK',
        'RESTOCKED',
        'REFUND_REQUESTED',
        'SETTLED',
      ] as const) {
        expect(ReturnSettlementStateMachine.isActive(status)).toBe(true);
      }
    });

    it('is false for COMPLETED, FAILED_TERMINAL, and MANUAL_REVIEW', () => {
      for (const status of ['COMPLETED', 'FAILED_TERMINAL', 'MANUAL_REVIEW'] as const) {
        expect(ReturnSettlementStateMachine.isActive(status)).toBe(false);
      }
    });
  });

  it('InvalidReturnSettlementTransitionError carries both endpoints in its message', () => {
    try {
      ReturnSettlementStateMachine.assertTransition('COMPLETED', 'PENDING_RESTOCK');
      fail('expected assertTransition to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidReturnSettlementTransitionError);
      expect((error as Error).message).toContain('COMPLETED');
      expect((error as Error).message).toContain('PENDING_RESTOCK');
    }
  });
});
