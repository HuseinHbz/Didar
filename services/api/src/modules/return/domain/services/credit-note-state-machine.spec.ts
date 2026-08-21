import {
  CreditNoteStateMachine,
  InvalidCreditNoteTransitionError,
} from './credit-note-state-machine';

describe('CreditNoteStateMachine', () => {
  it('allows the happy path', () => {
    expect(CreditNoteStateMachine.canTransition('DRAFT', 'ISSUED')).toBe(true);
    expect(CreditNoteStateMachine.canTransition('ISSUED', 'APPLIED')).toBe(true);
  });

  it('allows VOID from DRAFT or ISSUED', () => {
    expect(CreditNoteStateMachine.canTransition('DRAFT', 'VOID')).toBe(true);
    expect(CreditNoteStateMachine.canTransition('ISSUED', 'VOID')).toBe(true);
  });

  it('never allows VOID once APPLIED', () => {
    expect(CreditNoteStateMachine.canTransition('APPLIED', 'VOID')).toBe(false);
    expect(() => {
      CreditNoteStateMachine.assertTransition('APPLIED', 'VOID');
    }).toThrow(InvalidCreditNoteTransitionError);
  });

  it('rejects skipping straight from DRAFT to APPLIED', () => {
    expect(CreditNoteStateMachine.canTransition('DRAFT', 'APPLIED')).toBe(false);
  });

  it('treats every terminal status as having no further transitions', () => {
    expect(CreditNoteStateMachine.canTransition('APPLIED', 'ISSUED')).toBe(false);
    expect(CreditNoteStateMachine.canTransition('VOID', 'ISSUED')).toBe(false);
  });

  it('treats a same-status call as a no-op', () => {
    expect(CreditNoteStateMachine.isNoOp('ISSUED', 'ISSUED')).toBe(true);
    expect(() => {
      CreditNoteStateMachine.assertTransition('ISSUED', 'ISSUED');
    }).not.toThrow();
  });
});
