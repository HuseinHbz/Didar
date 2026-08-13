import type { ShippingMethod } from '../entities/shipping-method.entity';

export class ShippingMethodUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShippingMethodUnavailableError';
  }
}

/**
 * Thin domain-layer wrapper around `ShippingMethod`'s own
 * `isAvailableFor`/`costFor` — the "given the full active method list and
 * a destination, which ones apply, in what order" concern that doesn't
 * belong on a single `ShippingMethod` instance. Deliberately flat (ADR-007
 * decision 7): no carrier-rate lookups, no multi-leg zone graphs.
 */
export class ShippingCalculator {
  static availableMethods(
    methods: readonly ShippingMethod[],
    destination: { province: string; city: string },
  ): ShippingMethod[] {
    return methods
      .filter(
        (method) =>
          method.isActive && method.isAvailableFor(destination.province, destination.city),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  static resolveCost(
    methods: readonly ShippingMethod[],
    methodId: string,
    destination: { province: string; city: string },
    subtotal: bigint,
  ): bigint {
    const method = methods.find((candidate) => candidate.id === methodId);
    if (
      !method ||
      !method.isActive ||
      !method.isAvailableFor(destination.province, destination.city)
    ) {
      throw new ShippingMethodUnavailableError(
        'Selected shipping method is not available for this destination',
      );
    }
    return method.costFor(subtotal);
  }
}
