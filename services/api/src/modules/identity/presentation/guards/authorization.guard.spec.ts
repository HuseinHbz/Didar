import { randomUUID } from 'node:crypto';

import { asUserId } from '@iecp/types';
import { type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import type { GetEffectivePermissionsUseCase } from '../../application/rbac/get-effective-permissions.usecase';
import type { AuthenticatedRequest } from '../request-context';

import { AuthorizationGuard } from './authorization.guard';

/**
 * CP-028 (P1-7/P2-6) — no guard-level unit coverage existed for this
 * class either, despite it being the single enforcement point for every
 * `@RequirePermission`/`@RequireModule` route in the app. Covers both
 * the pre-existing RBAC path and the new `apiKeyScopes` narrowing this
 * pass adds — an owner having a permission must never be enough on its
 * own once a request authenticated via a narrower-scoped API key.
 */
describe('AuthorizationGuard', () => {
  const USER_ID = asUserId(randomUUID());

  function makeGuard(props: {
    requiredPermission?: string;
    requiredModule?: string;
    effectivePermissions: readonly string[];
  }): AuthorizationGuard {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === 'requiredPermission' ? props.requiredPermission : props.requiredModule,
    } as unknown as Reflector;
    const getEffectivePermissions = {
      execute: () => Promise.resolve(new Set(props.effectivePermissions)),
    } as unknown as GetEffectivePermissionsUseCase;
    return new AuthorizationGuard(reflector, getEffectivePermissions);
  }

  function makeContext(user: AuthenticatedRequest['user']): ExecutionContext {
    const request = { user } as AuthenticatedRequest;
    return {
      getHandler: () => ({}) as never,
      getClass: () => ({}) as never,
      switchToHttp: () => ({ getRequest: () => request }) as never,
    } as unknown as ExecutionContext;
  }

  it('allows a route with no @RequirePermission/@RequireModule for any authenticated user', async () => {
    const guard = makeGuard({ effectivePermissions: [] });
    const context = makeContext({ userId: USER_ID });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('allows a request whose effective permissions include the required one', async () => {
    const guard = makeGuard({
      requiredPermission: 'catalog.brands.create',
      effectivePermissions: ['catalog.brands.create'],
    });
    const context = makeContext({ userId: USER_ID });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a request missing the required permission with 403', async () => {
    const guard = makeGuard({
      requiredPermission: 'catalog.brands.delete',
      effectivePermissions: ['catalog.brands.create'],
    });
    const context = makeContext({ userId: USER_ID });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a request missing module access with 403', async () => {
    const guard = makeGuard({
      requiredModule: 'inventory',
      effectivePermissions: ['catalog.brands.create'],
    });
    const context = makeContext({ userId: USER_ID });

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('allows module access when any permission under that module prefix is held', async () => {
    const guard = makeGuard({
      requiredModule: 'catalog',
      effectivePermissions: ['catalog.brands.create'],
    });
    const context = makeContext({ userId: USER_ID });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('fails loudly (403) if this ever runs without a request.user, rather than silently passing', async () => {
    const guard = makeGuard({
      requiredPermission: 'catalog.brands.create',
      effectivePermissions: [],
    });
    const context = makeContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  describe('API-key scope narrowing (CP-028/P2-6)', () => {
    it('allows an API-key-authenticated request whose scopes include the required permission', async () => {
      const guard = makeGuard({
        requiredPermission: 'catalog.brands.create',
        effectivePermissions: ['catalog.brands.create', 'catalog.brands.delete'],
      });
      const context = makeContext({
        userId: USER_ID,
        apiKeyScopes: ['catalog.brands.create'],
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });

    it('rejects an API-key-authenticated request when the owner has the permission but the key scope does not', async () => {
      // The real adversarial case: a leaked key scoped to one thing must
      // never grant everything its owner could otherwise do.
      const guard = makeGuard({
        requiredPermission: 'catalog.brands.delete',
        effectivePermissions: ['catalog.brands.create', 'catalog.brands.delete'],
      });
      const context = makeContext({
        userId: USER_ID,
        apiKeyScopes: ['catalog.brands.create'],
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('rejects module access via API key when no scope entry falls under that module', async () => {
      const guard = makeGuard({
        requiredModule: 'inventory',
        effectivePermissions: ['inventory.warehouses.manage'],
      });
      const context = makeContext({
        userId: USER_ID,
        apiKeyScopes: ['catalog.brands.create'],
      });

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    });

    it('does not narrow an unscoped (no permission/module required) route for an API key', async () => {
      const guard = makeGuard({ effectivePermissions: [] });
      const context = makeContext({ userId: USER_ID, apiKeyScopes: [] });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });
});
