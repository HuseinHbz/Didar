import {
  InvalidProductTransitionError,
  ProductLifecycleStateMachine,
} from './product-lifecycle-state-machine';

describe('ProductLifecycleStateMachine', () => {
  describe('canTransition', () => {
    it('allows the happy path: DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED', () => {
      expect(ProductLifecycleStateMachine.canTransition('DRAFT', 'IN_REVIEW')).toBe(true);
      expect(ProductLifecycleStateMachine.canTransition('IN_REVIEW', 'APPROVED')).toBe(true);
      expect(ProductLifecycleStateMachine.canTransition('APPROVED', 'PUBLISHED')).toBe(true);
    });

    it('rejects publishing a DRAFT directly, skipping review/approval', () => {
      expect(ProductLifecycleStateMachine.canTransition('DRAFT', 'PUBLISHED')).toBe(false);
    });

    it('allows a rejection back to DRAFT from IN_REVIEW or APPROVED', () => {
      expect(ProductLifecycleStateMachine.canTransition('IN_REVIEW', 'DRAFT')).toBe(true);
      expect(ProductLifecycleStateMachine.canTransition('APPROVED', 'DRAFT')).toBe(true);
    });

    it('allows PUBLISHED <-> UNPUBLISHED in both directions', () => {
      expect(ProductLifecycleStateMachine.canTransition('PUBLISHED', 'UNPUBLISHED')).toBe(true);
      expect(ProductLifecycleStateMachine.canTransition('UNPUBLISHED', 'PUBLISHED')).toBe(true);
    });

    it('allows ARCHIVED from every non-terminal state', () => {
      for (const from of ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'UNPUBLISHED'] as const) {
        expect(ProductLifecycleStateMachine.canTransition(from, 'ARCHIVED')).toBe(true);
      }
    });

    it('ARCHIVED is terminal — no transition out of it', () => {
      for (const to of [
        'DRAFT',
        'IN_REVIEW',
        'APPROVED',
        'PUBLISHED',
        'UNPUBLISHED',
        'ARCHIVED',
      ] as const) {
        expect(ProductLifecycleStateMachine.canTransition('ARCHIVED', to)).toBe(false);
      }
    });
  });

  describe('assertTransition', () => {
    it('does not throw for a legal transition', () => {
      expect(() => {
        ProductLifecycleStateMachine.assertTransition('DRAFT', 'IN_REVIEW');
      }).not.toThrow();
    });

    it('throws InvalidProductTransitionError for an illegal transition', () => {
      expect(() => {
        ProductLifecycleStateMachine.assertTransition('DRAFT', 'PUBLISHED');
      }).toThrow(InvalidProductTransitionError);
    });
  });
});
