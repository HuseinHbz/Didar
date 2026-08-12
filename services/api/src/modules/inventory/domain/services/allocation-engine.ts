import type { AllocationExplanationEntry, AllocationResult, AllocationRule } from '@iecp/types';

export interface AllocationCandidate {
  warehouseId: string;
  locationId: string;
  availableQuantity: number;
  isStore: boolean;
  /** Lower number = higher priority, for the `PRIORITY_WAREHOUSE` rule. */
  priority?: number;
  distanceKm?: number;
  /** Stubbed static-cost-table input for `LOWEST_SHIPPING_COST` — see
   * ADR-006's "Deferred" list; no live carrier-rate call this phase. */
  shippingCost?: number;
}

export interface AllocationContext {
  requestedQuantity: number;
  preferredStoreId?: string;
  customerSelectedStoreId?: string;
  clickAndCollect?: boolean;
}

/**
 * Pure — never picks a warehouse the caller then has to trust blindly:
 * `explanation` records every rule evaluated and whether it decided the
 * winner (the brief's own "allocation result must be explainable").
 * Rules are evaluated in ascending `priority` order (1 = evaluated first);
 * the first rule that narrows the qualifying candidates to exactly one
 * wins. Candidates are pre-filtered to `availableQuantity >=
 * requestedQuantity` — this engine only ever picks a warehouse that
 * actually has enough stock, never bypassing the reservation engine's own
 * `ReservationRules` (ADR-006 decision 5's "must not bypass reservation
 * logic"). If no rule decides, the fallback is the qualifying candidate
 * with the highest available quantity (the brief's own "fallback
 * warehouse selection").
 */
export class AllocationEngine {
  static allocate(
    candidates: readonly AllocationCandidate[],
    rules: readonly AllocationRule[],
    context: AllocationContext,
  ): AllocationResult {
    const explanation: AllocationExplanationEntry[] = [];
    const qualifying = candidates.filter((c) => c.availableQuantity >= context.requestedQuantity);

    if (qualifying.length === 0) {
      return { warehouseId: null, locationId: null, explanation };
    }

    const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sortedRules) {
      const winner = AllocationEngine.applyRule(rule, qualifying, context);
      if (winner) {
        for (const candidate of qualifying) {
          explanation.push({
            rule: rule.type,
            warehouseId: candidate.warehouseId,
            matched: candidate.warehouseId === winner.warehouseId,
            detail:
              candidate.warehouseId === winner.warehouseId
                ? 'Selected by this rule'
                : 'Not selected by this rule',
          });
        }
        return { warehouseId: winner.warehouseId, locationId: winner.locationId, explanation };
      }
      explanation.push({
        rule: rule.type,
        warehouseId: '',
        matched: false,
        detail: 'No decisive candidate for this rule — falling through',
      });
    }

    // No rule decided — fallback: highest available quantity among the
    // still-qualifying candidates (the brief's "fallback warehouse selection").
    // `qualifying` is non-empty here (checked above), so this always finds one.
    const fallback = AllocationEngine.pickMax(qualifying, (c) => c.availableQuantity);
    if (!fallback) {
      return { warehouseId: null, locationId: null, explanation };
    }
    explanation.push({
      rule: 'HIGHEST_AVAILABLE_QUANTITY',
      warehouseId: fallback.warehouseId,
      matched: true,
      detail: 'Fallback: no configured rule decided, chose highest available quantity',
    });
    return { warehouseId: fallback.warehouseId, locationId: fallback.locationId, explanation };
  }

  private static applyRule(
    rule: AllocationRule,
    candidates: readonly AllocationCandidate[],
    context: AllocationContext,
  ): AllocationCandidate | null {
    switch (rule.type) {
      case 'NEAREST_WAREHOUSE':
        return AllocationEngine.pickMin(candidates, (c) => c.distanceKm);
      case 'LOWEST_SHIPPING_COST':
        return AllocationEngine.pickMin(candidates, (c) => c.shippingCost);
      case 'HIGHEST_AVAILABLE_QUANTITY':
        return AllocationEngine.pickMax(candidates, (c) => c.availableQuantity);
      case 'PRIORITY_WAREHOUSE':
        return AllocationEngine.pickMin(candidates, (c) => c.priority);
      case 'PREFERRED_STORE':
        return context.preferredStoreId
          ? (candidates.find((c) => c.isStore && c.warehouseId === context.preferredStoreId) ??
              null)
          : null;
      case 'CUSTOMER_SELECTED_STORE':
        return context.customerSelectedStoreId
          ? (candidates.find((c) => c.warehouseId === context.customerSelectedStoreId) ?? null)
          : null;
      case 'CLICK_AND_COLLECT': {
        if (!context.clickAndCollect) return null;
        const stores = candidates.filter((c) => c.isStore);
        return stores.length === 1 ? (stores[0] ?? null) : null;
      }
      default:
        return null;
    }
  }

  private static pickMin(
    candidates: readonly AllocationCandidate[],
    key: (c: AllocationCandidate) => number | undefined,
  ): AllocationCandidate | null {
    return AllocationEngine.pickBy(candidates, key, (a, b) => a < b);
  }

  private static pickMax(
    candidates: readonly AllocationCandidate[],
    key: (c: AllocationCandidate) => number | undefined,
  ): AllocationCandidate | null {
    return AllocationEngine.pickBy(candidates, key, (a, b) => a > b);
  }

  private static pickBy(
    candidates: readonly AllocationCandidate[],
    key: (c: AllocationCandidate) => number | undefined,
    isBetter: (a: number, b: number) => boolean,
  ): AllocationCandidate | null {
    let best: { candidate: AllocationCandidate; value: number } | null = null;
    for (const candidate of candidates) {
      const value = key(candidate);
      if (value === undefined) continue;
      if (best === null || isBetter(value, best.value)) {
        best = { candidate, value };
      }
    }
    return best?.candidate ?? null;
  }
}
