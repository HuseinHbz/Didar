import { PermissionResolver } from './permission-resolver';

/**
 * No DB, no NestJS test module — PermissionResolver is a pure function over
 * plain data (see its own class doc for why), so this is the fast, direct
 * proof of blueprint §53's two rules. The e2e suite
 * (test/identity.e2e-spec.ts's "Permission bypass" block) proves the same
 * rules hold once role inheritance and overrides are actually fetched from
 * a real database — this file proves the combination logic itself is
 * correct in isolation.
 */
describe('PermissionResolver', () => {
  describe('resolve', () => {
    it('grants everything the role-derived set includes, with no overrides', () => {
      const resolved = PermissionResolver.resolve(
        ['catalog.products.view', 'catalog.products.edit'],
        [],
      );
      expect([...resolved].sort()).toEqual(['catalog.products.edit', 'catalog.products.view']);
    });

    it('an ALLOW override grants a permission no role does', () => {
      const resolved = PermissionResolver.resolve(
        ['catalog.products.view'],
        [{ permissionKey: 'catalog.products.publish', effect: 'ALLOW' }],
      );
      expect(resolved.has('catalog.products.publish')).toBe(true);
      expect(resolved.has('catalog.products.view')).toBe(true);
    });

    it('a DENY override removes a permission the role set grants', () => {
      const resolved = PermissionResolver.resolve(
        ['catalog.products.view', 'catalog.products.publish'],
        [{ permissionKey: 'catalog.products.publish', effect: 'DENY' }],
      );
      expect(resolved.has('catalog.products.publish')).toBe(false);
      expect(resolved.has('catalog.products.view')).toBe(true);
    });

    it('DENY always wins over ALLOW for the same permission key (deny-wins, not last-write-wins)', () => {
      // Real data should never contain both for the same (user, permission)
      // — the unique constraint on UserPermissionOverride prevents it — but
      // the resolver itself shouldn't depend on that database invariant to
      // stay safe; it applies ALLOW first, DENY second, unconditionally.
      const resolved = PermissionResolver.resolve(
        [],
        [
          { permissionKey: 'identity.roles.manage', effect: 'ALLOW' },
          { permissionKey: 'identity.roles.manage', effect: 'DENY' },
        ],
      );
      expect(resolved.has('identity.roles.manage')).toBe(false);
    });

    it('a DENY override on a permission nobody was granted is a harmless no-op', () => {
      const resolved = PermissionResolver.resolve(
        ['catalog.products.view'],
        [{ permissionKey: 'finance.reports.view', effect: 'DENY' }],
      );
      expect([...resolved]).toEqual(['catalog.products.view']);
    });
  });

  describe('has', () => {
    it('reflects membership in the resolved set', () => {
      const set = new Set(['identity.roles.manage']);
      expect(PermissionResolver.has(set, 'identity.roles.manage')).toBe(true);
      expect(PermissionResolver.has(set, 'identity.audit_logs.view')).toBe(false);
    });
  });

  describe('hasModuleAccess', () => {
    it('true when the caller holds ANY permission in that module, regardless of action', () => {
      const set = new Set(['identity.users.view_contact']);
      expect(PermissionResolver.hasModuleAccess(set, 'identity')).toBe(true);
    });

    it('false when the caller holds permissions only in other modules', () => {
      const set = new Set(['finance.pricing.view_cost']);
      expect(PermissionResolver.hasModuleAccess(set, 'identity')).toBe(false);
    });

    it('does not false-positive on a module name that is a prefix of another (e.g. "id" vs "identity")', () => {
      const set = new Set(['identity.roles.manage']);
      expect(PermissionResolver.hasModuleAccess(set, 'id')).toBe(false);
    });
  });
});
