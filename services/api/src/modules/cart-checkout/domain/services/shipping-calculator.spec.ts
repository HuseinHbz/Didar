import { ShippingMethod } from '../entities/shipping-method.entity';

import { ShippingCalculator, ShippingMethodUnavailableError } from './shipping-calculator';

function makeMethod(
  props: Partial<Parameters<typeof ShippingMethod.create>[0]> & { id: string },
): ShippingMethod {
  return ShippingMethod.create({
    code: `CODE-${props.id}`,
    name: 'Method',
    type: 'HOME_DELIVERY',
    baseCost: 50_000n,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...props,
  });
}

describe('ShippingCalculator', () => {
  const nationwide = makeMethod({ id: '00000000-0000-4000-8000-000000000001', sortOrder: 2 });
  const tehranOnly = makeMethod({
    id: '00000000-0000-4000-8000-000000000002',
    sortOrder: 1,
    zoneMatch: { provinces: ['Tehran'] },
  });
  const inactive = makeMethod({ id: '00000000-0000-4000-8000-000000000003', isActive: false });

  describe('availableMethods', () => {
    it('includes nationwide and matching-zone methods, sorted by sortOrder', () => {
      const result = ShippingCalculator.availableMethods([nationwide, tehranOnly, inactive], {
        province: 'Tehran',
        city: 'Tehran',
      });
      expect(result.map((m) => m.id)).toEqual([tehranOnly.id, nationwide.id]);
    });

    it('excludes a zone-restricted method for a non-matching destination', () => {
      const result = ShippingCalculator.availableMethods([nationwide, tehranOnly], {
        province: 'Fars',
        city: 'Shiraz',
      });
      expect(result.map((m) => m.id)).toEqual([nationwide.id]);
    });

    it('excludes inactive methods', () => {
      const result = ShippingCalculator.availableMethods([inactive], {
        province: 'Tehran',
        city: 'Tehran',
      });
      expect(result).toHaveLength(0);
    });
  });

  describe('resolveCost', () => {
    it('resolves the base cost for an available method', () => {
      const cost = ShippingCalculator.resolveCost(
        [nationwide],
        nationwide.id,
        { province: 'Fars', city: 'Shiraz' },
        100_000n,
      );
      expect(cost).toBe(50_000n);
    });

    it('throws for a method unavailable at the destination', () => {
      expect(() =>
        ShippingCalculator.resolveCost(
          [tehranOnly],
          tehranOnly.id,
          { province: 'Fars', city: 'Shiraz' },
          100_000n,
        ),
      ).toThrow(ShippingMethodUnavailableError);
    });

    it('throws for an unknown method id', () => {
      expect(() =>
        ShippingCalculator.resolveCost(
          [nationwide],
          'does-not-exist',
          { province: 'Tehran', city: 'Tehran' },
          100_000n,
        ),
      ).toThrow(ShippingMethodUnavailableError);
    });
  });
});
