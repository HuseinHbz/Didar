import { PrescriptionReferenceValidator } from './prescription-reference-validator';

describe('PrescriptionReferenceValidator', () => {
  it('rejects a malformed reference as invalid_shape', () => {
    expect(PrescriptionReferenceValidator.validate('not-a-uuid')).toBe('invalid_shape');
  });

  it('returns unverified (never a fabricated "valid") for a well-formed reference', () => {
    expect(PrescriptionReferenceValidator.validate('00000000-0000-4000-8000-000000000001')).toBe(
      'unverified',
    );
  });
});
