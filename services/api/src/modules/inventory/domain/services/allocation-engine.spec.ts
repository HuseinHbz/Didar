import type { AllocationRule } from '@iecp/types';

import { AllocationEngine, type AllocationCandidate } from './allocation-engine';

const candidates: AllocationCandidate[] = [
  {
    warehouseId: 'wh-central',
    locationId: 'loc-1',
    availableQuantity: 100,
    isStore: false,
    distanceKm: 500,
    shippingCost: 50,
    priority: 2,
  },
  {
    warehouseId: 'wh-tehran-store',
    locationId: 'loc-2',
    availableQuantity: 5,
    isStore: true,
    distanceKm: 2,
    shippingCost: 5,
    priority: 1,
  },
  {
    warehouseId: 'wh-regional',
    locationId: 'loc-3',
    availableQuantity: 30,
    isStore: false,
    distanceKm: 50,
    shippingCost: 20,
    priority: 3,
  },
];

describe('AllocationEngine', () => {
  it('returns null when no candidate has enough stock', () => {
    const result = AllocationEngine.allocate(candidates, [], { requestedQuantity: 1000 });
    expect(result.warehouseId).toBeNull();
  });

  it('picks the nearest warehouse when that rule is highest priority', () => {
    const rules: AllocationRule[] = [{ type: 'NEAREST_WAREHOUSE', priority: 1 }];
    const result = AllocationEngine.allocate(candidates, rules, { requestedQuantity: 1 });
    expect(result.warehouseId).toBe('wh-tehran-store');
    expect(result.explanation.some((e) => e.rule === 'NEAREST_WAREHOUSE' && e.matched)).toBe(true);
  });

  it('picks the highest available quantity when that rule decides', () => {
    const rules: AllocationRule[] = [{ type: 'HIGHEST_AVAILABLE_QUANTITY', priority: 1 }];
    // exclude the store (only 5 units) by requesting more than it has
    const result = AllocationEngine.allocate(candidates, rules, { requestedQuantity: 10 });
    expect(result.warehouseId).toBe('wh-central');
  });

  it('falls through to the next rule when the first does not decide', () => {
    const rules: AllocationRule[] = [
      { type: 'PREFERRED_STORE', priority: 1 }, // no preferredStoreId in context -> falls through
      { type: 'NEAREST_WAREHOUSE', priority: 2 },
    ];
    const result = AllocationEngine.allocate(candidates, rules, { requestedQuantity: 1 });
    expect(result.warehouseId).toBe('wh-tehran-store');
  });

  it('falls back to highest available quantity when no rule decides', () => {
    const result = AllocationEngine.allocate(candidates, [], { requestedQuantity: 1 });
    expect(result.warehouseId).toBe('wh-central');
    expect(result.explanation.at(-1)?.detail).toContain('Fallback');
  });

  it('honors customer-selected store when it qualifies', () => {
    const rules: AllocationRule[] = [{ type: 'CUSTOMER_SELECTED_STORE', priority: 1 }];
    const result = AllocationEngine.allocate(candidates, rules, {
      requestedQuantity: 1,
      customerSelectedStoreId: 'wh-regional',
    });
    expect(result.warehouseId).toBe('wh-regional');
  });

  it('respects priority order between multiple rules', () => {
    const rules: AllocationRule[] = [
      { type: 'PRIORITY_WAREHOUSE', priority: 5 },
      { type: 'LOWEST_SHIPPING_COST', priority: 1 },
    ];
    const result = AllocationEngine.allocate(candidates, rules, { requestedQuantity: 1 });
    // LOWEST_SHIPPING_COST (priority 1) evaluated first -> tehran-store (cost 5)
    expect(result.warehouseId).toBe('wh-tehran-store');
  });
});
