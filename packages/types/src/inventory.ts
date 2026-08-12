/**
 * Inventory/allocation shared shapes — Phase 006. See
 * docs/adr/ADR-006-inventory-architecture.md decision 7 for why allocation
 * rules live in `system.Setting` (key `inventory.allocation_rules`) rather
 * than a dedicated table.
 */

/** The seven allocation strategies the brief requires — a fixed, known
 * set (not a general rule engine), same "narrow fixed shape" pattern
 * ADR-005 decision 4 used for `CollectionRules`. */
export const ALLOCATION_RULE_TYPES = [
  'NEAREST_WAREHOUSE',
  'PREFERRED_STORE',
  'LOWEST_SHIPPING_COST',
  'HIGHEST_AVAILABLE_QUANTITY',
  'PRIORITY_WAREHOUSE',
  'CUSTOMER_SELECTED_STORE',
  'CLICK_AND_COLLECT',
] as const;
export type AllocationRuleType = (typeof ALLOCATION_RULE_TYPES)[number];

/** One entry in the ordered `inventory.allocation_rules` Setting value.
 * `params` is deliberately loose JSON — its shape varies by `type` (e.g.
 * `PRIORITY_WAREHOUSE` needs an ordered warehouse-id list,
 * `CUSTOMER_SELECTED_STORE` needs none). */
export interface AllocationRule {
  type: AllocationRuleType;
  priority: number;
  params?: Record<string, unknown>;
}

/** What `AllocationEngine.allocate()` returns — the chosen warehouse plus
 * the full evaluation trail, so "allocation result must be explainable"
 * (the brief's own words) is a returned value, not a log line. */
export interface AllocationExplanationEntry {
  rule: AllocationRuleType;
  warehouseId: string;
  matched: boolean;
  detail: string;
}

export interface AllocationResult {
  warehouseId: string | null;
  locationId: string | null;
  explanation: AllocationExplanationEntry[];
}
