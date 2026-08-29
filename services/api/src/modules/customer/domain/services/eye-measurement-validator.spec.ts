import { EyeMeasurementValidator, InvalidPrescriptionMeasurementError } from './eye-measurement-validator';

describe('EyeMeasurementValidator', () => {
  it('accepts a valid measurement and converts it to centi-units', () => {
    const result = EyeMeasurementValidator.validate({ sph: -7.25, cyl: -1.5, axis: 90, add: 2, pd: 62 });
    expect(result).toEqual({ sph: -725, cyl: -150, axis: 90, add: 200, pd: 6200 });
  });

  it('accepts a minimal measurement (SPH only)', () => {
    const result = EyeMeasurementValidator.validate({ sph: 0 });
    expect(result).toEqual({ sph: 0, cyl: null, axis: null, add: null, pd: null });
  });

  it('rejects an out-of-range SPH', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: 25 })).toThrow(InvalidPrescriptionMeasurementError);
    expect(() => EyeMeasurementValidator.validate({ sph: -25 })).toThrow(InvalidPrescriptionMeasurementError);
  });

  it('rejects an out-of-range CYL', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: 0, cyl: -15, axis: 90 })).toThrow(
      InvalidPrescriptionMeasurementError,
    );
  });

  it('rejects an out-of-range AXIS', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: 0, cyl: -1, axis: 200 })).toThrow(
      InvalidPrescriptionMeasurementError,
    );
  });

  it('rejects an out-of-range ADD', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: 0, add: 5 })).toThrow(InvalidPrescriptionMeasurementError);
  });

  it('rejects an out-of-range PD', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: 0, pd: 15 })).toThrow(InvalidPrescriptionMeasurementError);
    expect(() => EyeMeasurementValidator.validate({ sph: 0, pd: 90 })).toThrow(InvalidPrescriptionMeasurementError);
  });

  it('rejects a SPH not on the 0.25 step', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: -1.1 })).toThrow(InvalidPrescriptionMeasurementError);
  });

  it('rejects CYL provided without AXIS', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: 0, cyl: -1 })).toThrow(InvalidPrescriptionMeasurementError);
  });

  it('accepts AXIS omitted when CYL is also omitted', () => {
    expect(() => EyeMeasurementValidator.validate({ sph: 0 })).not.toThrow();
  });
});
