import { Prescription } from './prescription.entity';

const baseProps = {
  id: '11111111-1111-4111-8111-111111111111',
  rootId: '11111111-1111-4111-8111-111111111111',
  version: 1,
  customerId: '22222222-2222-4222-8222-222222222222',
  rightEye: { sph: -100, cyl: null, axis: null, add: null, pd: null },
  leftEye: { sph: -100, cyl: null, axis: null, add: null, pd: null },
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('Prescription.isImmutable', () => {
  it('is mutable while DRAFT/SUBMITTED/UNDER_REVIEW', () => {
    for (const status of ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'] as const) {
      const prescription = Prescription.create({ ...baseProps, status });
      expect(prescription.isImmutable).toBe(false);
    }
  });

  it('is immutable once APPROVED, REJECTED, or SUPERSEDED', () => {
    for (const status of ['APPROVED', 'REJECTED', 'SUPERSEDED'] as const) {
      const prescription = Prescription.create({ ...baseProps, status });
      expect(prescription.isImmutable).toBe(true);
    }
  });

  it('defaults to DRAFT when no status is given', () => {
    const prescription = Prescription.create(baseProps);
    expect(prescription.status).toBe('DRAFT');
    expect(prescription.isImmutable).toBe(false);
  });
});
