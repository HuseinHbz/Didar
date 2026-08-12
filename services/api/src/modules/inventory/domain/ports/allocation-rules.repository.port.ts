import type { AllocationRule } from '@iecp/types';

export const ALLOCATION_RULES_REPOSITORY = Symbol('ALLOCATION_RULES_REPOSITORY');

/** Reads/writes the `system.Setting` row (key `inventory.allocation_rules`)
 * that configures `AllocationEngine` — ADR-006 decision 7. A missing
 * Setting row means "no rules configured yet," resolved as an empty array
 * (the engine then falls straight to its own highest-available-quantity
 * fallback), not an error. */
export interface AllocationRulesRepositoryPort {
  get(): Promise<AllocationRule[]>;
  set(rules: AllocationRule[]): Promise<AllocationRule[]>;
}
