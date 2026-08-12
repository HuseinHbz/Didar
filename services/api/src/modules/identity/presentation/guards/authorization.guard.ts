import { CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { GetEffectivePermissionsUseCase } from '../../application/rbac/get-effective-permissions.usecase';
import { PermissionResolver } from '../../domain/services/permission-resolver';
import { REQUIRED_MODULE_KEY } from '../decorators/require-module.decorator';
import { REQUIRED_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from '../request-context';

/**
 * Runs after `JwtAuthGuard` (registered second — Nest evaluates global
 * guards in registration order, see identity.module.ts) and enforces
 * `@RequirePermission`/`@RequireModule` when a route declares one. A route
 * with neither decorator is authenticated-only: any logged-in caller may
 * proceed, and *that* route's own use case is responsible for any
 * finer-grained ownership check (see e.g. RevokeSessionUseCase).
 *
 * Recomputes effective permissions on every request rather than trusting
 * anything cached in the JWT — see GetEffectivePermissionsUseCase's doc for
 * why that trade-off was made deliberately.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly getEffectivePermissions: GetEffectivePermissionsUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredModule = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermission && !requiredModule) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      // JwtAuthGuard runs first and would already have rejected this
      // request if it weren't authenticated — reaching here without a
      // user means a route is missing @Public() while somehow also
      // skipping JwtAuthGuard, a wiring bug worth failing loudly on.
      throw new ForbiddenException('No authenticated user to authorize');
    }

    const effective = await this.getEffectivePermissions.execute(request.user.userId);

    if (requiredPermission && !PermissionResolver.has(effective, requiredPermission)) {
      throw new ForbiddenException(`Missing required permission: ${requiredPermission}`);
    }
    if (requiredModule && !PermissionResolver.hasModuleAccess(effective, requiredModule)) {
      throw new ForbiddenException(`No access to module: ${requiredModule}`);
    }

    return true;
  }
}
