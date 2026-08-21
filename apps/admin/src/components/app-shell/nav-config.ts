export interface NavItem {
  href: string;
  label: string;
  /** Gate type matches the backend's own two decorators exactly
   * (`@RequireModule` vs `@RequirePermission`) — a nav item never
   * invents a third kind of check the API doesn't also enforce. */
  gate: { type: 'module'; module: string } | { type: 'permission'; permission: string };
}

/** The five canonical `P018` deliverables, each mapped to the exact
 * backend gate its own list route already enforces — see
 * docs/product/admin-panel.md's scope matrix. */
export const NAV_ITEMS: NavItem[] = [
  { href: '/catalog/products', label: 'محصولات', gate: { type: 'module', module: 'catalog' } },
  {
    href: '/inventory/adjustments',
    label: 'تعدیل موجودی',
    gate: { type: 'permission', permission: 'inventory.ledger.read' },
  },
  {
    href: '/inventory/transfers',
    label: 'انتقال موجودی',
    gate: { type: 'permission', permission: 'inventory.ledger.read' },
  },
  { href: '/orders', label: 'سفارش‌ها', gate: { type: 'permission', permission: 'order.read' } },
  { href: '/returns', label: 'بازگشت‌ها', gate: { type: 'permission', permission: 'return.read' } },
];

/**
 * The one place nav-visibility decisions are made — `AppShell` and the
 * dashboard page both call this rather than each re-implementing the
 * same filter, so there is exactly one function
 * `nav-config.spec.ts`'s permission-aware-rendering tests need to cover
 * (this phase's own `testing_requirements`). Cosmetic only: every route
 * this admits to is still independently authorized server-side.
 */
export function visibleNavItems(check: {
  hasModuleAccess: (module: string) => boolean;
  hasPermission: (permission: string) => boolean;
}): NavItem[] {
  return NAV_ITEMS.filter((item) =>
    item.gate.type === 'module'
      ? check.hasModuleAccess(item.gate.module)
      : check.hasPermission(item.gate.permission),
  );
}
