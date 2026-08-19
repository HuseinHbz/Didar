import { InvalidInvoiceTransitionError, InvoiceStateMachine } from './invoice-state-machine';

describe('InvoiceStateMachine', () => {
  it('allows the happy path', () => {
    expect(InvoiceStateMachine.canTransition('DRAFT', 'ISSUED')).toBe(true);
    expect(InvoiceStateMachine.canTransition('ISSUED', 'PAID')).toBe(true);
  });

  it('allows VOID from ISSUED or PAID', () => {
    expect(InvoiceStateMachine.canTransition('ISSUED', 'VOID')).toBe(true);
    expect(InvoiceStateMachine.canTransition('PAID', 'VOID')).toBe(true);
  });

  it('rejects mutating a VOID invoice', () => {
    expect(InvoiceStateMachine.canTransition('VOID', 'ISSUED')).toBe(false);
    expect(() => {
      InvoiceStateMachine.assertTransition('VOID', 'ISSUED');
    }).toThrow(InvalidInvoiceTransitionError);
  });

  it('rejects skipping straight from DRAFT to PAID', () => {
    expect(InvoiceStateMachine.canTransition('DRAFT', 'PAID')).toBe(false);
  });

  it('treats a same-status call as a no-op', () => {
    expect(InvoiceStateMachine.isNoOp('PAID', 'PAID')).toBe(true);
  });
});
