import { InvalidPrescriptionTransitionError, PrescriptionStateMachine } from './prescription-state-machine';

describe('PrescriptionStateMachine', () => {
  it('allows the happy path to APPROVED', () => {
    expect(PrescriptionStateMachine.canTransition('DRAFT', 'SUBMITTED')).toBe(true);
    expect(PrescriptionStateMachine.canTransition('SUBMITTED', 'UNDER_REVIEW')).toBe(true);
    expect(PrescriptionStateMachine.canTransition('UNDER_REVIEW', 'APPROVED')).toBe(true);
  });

  it('allows the rejection path', () => {
    expect(PrescriptionStateMachine.canTransition('UNDER_REVIEW', 'REJECTED')).toBe(true);
  });

  it('treats a same-status call as a no-op, not an error', () => {
    expect(PrescriptionStateMachine.isNoOp('DRAFT', 'DRAFT')).toBe(true);
    expect(() => {
      PrescriptionStateMachine.assertTransition('APPROVED', 'APPROVED');
    }).not.toThrow();
  });

  it('rejects skipping a step', () => {
    expect(PrescriptionStateMachine.canTransition('DRAFT', 'UNDER_REVIEW')).toBe(false);
    expect(() => {
      PrescriptionStateMachine.assertTransition('DRAFT', 'UNDER_REVIEW');
    }).toThrow(InvalidPrescriptionTransitionError);

    expect(PrescriptionStateMachine.canTransition('DRAFT', 'APPROVED')).toBe(false);
  });

  it('rejects any transition out of every terminal state', () => {
    for (const terminal of ['APPROVED', 'REJECTED', 'SUPERSEDED'] as const) {
      expect(PrescriptionStateMachine.canTransition(terminal, 'SUBMITTED')).toBe(false);
      expect(PrescriptionStateMachine.canTransition(terminal, 'UNDER_REVIEW')).toBe(false);
    }
  });

  it('rejects re-submitting an already-submitted prescription', () => {
    expect(PrescriptionStateMachine.canTransition('SUBMITTED', 'SUBMITTED')).toBe(true); // no-op
    expect(PrescriptionStateMachine.canTransition('SUBMITTED', 'DRAFT')).toBe(false); // real backward move
  });

  it('has no direct entry point into SUPERSEDED — only PrismaPrescriptionRepository.approve() reaches it', () => {
    for (const from of ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const) {
      expect(PrescriptionStateMachine.canTransition(from, 'SUPERSEDED')).toBe(false);
    }
  });
});
