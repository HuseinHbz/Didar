import { describe, expect, it } from 'vitest';

import { NAV_ITEMS, visibleNavItems } from './nav-config';

/**
 * `testing_requirements`'s "component tests for permission-aware
 * rendering" — this is the pure-logic half (no React needed);
 * `shell.spec.tsx` covers the same behavior through an actual rendered
 * component. Cosmetic only, stated explicitly here too: this proves
 * what the UI *shows*, never what the API *allows* — see
 * `e2e/authorization.spec.ts` for the real server-side proof.
 */
describe('visibleNavItems', () => {
  it('returns nothing when the caller holds no permissions and no module access', () => {
    const result = visibleNavItems({ hasModuleAccess: () => false, hasPermission: () => false });
    expect(result).toEqual([]);
  });

  it('returns every item when the caller holds every gate', () => {
    const result = visibleNavItems({ hasModuleAccess: () => true, hasPermission: () => true });
    expect(result).toHaveLength(NAV_ITEMS.length);
  });

  it('includes a module-gated item only when hasModuleAccess answers true for that exact module', () => {
    const seen: string[] = [];
    const result = visibleNavItems({
      hasModuleAccess: (module) => {
        seen.push(module);
        return module === 'catalog';
      },
      hasPermission: () => false,
    });
    expect(result.map((item) => item.href)).toEqual(['/catalog/products']);
    expect(seen).toContain('catalog');
  });

  it('includes a permission-gated item only when hasPermission answers true for that exact key', () => {
    const result = visibleNavItems({
      hasModuleAccess: () => false,
      hasPermission: (key) => key === 'order.read',
    });
    expect(result.map((item) => item.href)).toEqual(['/orders']);
  });

  it('every NAV_ITEM gate references a real, non-empty key — no silently-broken entries', () => {
    for (const item of NAV_ITEMS) {
      const key = item.gate.type === 'module' ? item.gate.module : item.gate.permission;
      expect(key.length).toBeGreaterThan(0);
    }
  });
});
