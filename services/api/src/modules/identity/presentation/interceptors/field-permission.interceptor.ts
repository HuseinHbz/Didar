import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { GetEffectivePermissionsUseCase } from '../../application/rbac/get-effective-permissions.usecase';
import { PermissionResolver } from '../../domain/services/permission-resolver';
import {
  FIELD_PERMISSIONS_KEY,
  type FieldPermissionRule,
} from '../decorators/field-permissions.decorator';
import type { AuthenticatedRequest } from '../request-context';

/**
 * Runs after the handler returns, before the response is serialized: for
 * every `@FieldPermissions` rule on the route, deletes that field from the
 * response body (or every item, if the body is an array) when the caller's
 * resolved effective permissions don't include the rule's permission key.
 *
 * Deliberately shallow — only top-level DTO properties, no dot-paths into
 * nested objects/arrays. A fully generalized field-permission engine (deep
 * paths, wildcard fields, per-field ALLOW/DENY like the RBAC override
 * model) is real, open-ended scope of its own; this ships the reusable
 * decorator + interceptor mechanism plus the one concrete case Phase 004
 * needs (`GET /users/:id`'s `phone`/`email`, gated on
 * `identity.users.view_contact`) rather than speculatively building the
 * general version now. See identity/README.md.
 */
@Injectable()
export class FieldPermissionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly getEffectivePermissions: GetEffectivePermissionsUseCase,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rules = this.reflector.get<FieldPermissionRule[] | undefined>(
      FIELD_PERMISSIONS_KEY,
      context.getHandler(),
    );
    if (!rules || rules.length === 0) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return next.handle().pipe(
      switchMap(async (result: unknown) => {
        if (!request.user) {
          // Unreachable behind the global JwtAuthGuard, but fail closed
          // (strip everything gated) rather than leak fields if this
          // interceptor is ever reused on a route that isn't guarded.
          return stripAll(result, rules);
        }
        const effective = await this.getEffectivePermissions.execute(request.user.userId);
        return applyRules(result, rules, effective);
      }),
    );
  }
}

function applyRules(
  result: unknown,
  rules: FieldPermissionRule[],
  effective: ReadonlySet<string>,
): unknown {
  const deniedFields = rules.filter(
    (rule) => !PermissionResolver.has(effective, rule.permissionKey),
  );
  return stripFields(result, deniedFields);
}

function stripAll(result: unknown, rules: FieldPermissionRule[]): unknown {
  return stripFields(result, rules);
}

function stripFields(result: unknown, rules: FieldPermissionRule[]): unknown {
  if (rules.length === 0) {
    return result;
  }
  if (Array.isArray(result)) {
    return result.map((item) => stripOne(item, rules));
  }
  return stripOne(result, rules);
}

function stripOne(item: unknown, rules: FieldPermissionRule[]): unknown {
  if (typeof item !== 'object' || item === null) {
    return item;
  }
  const deniedFieldNames = new Set(rules.map((rule) => rule.field));
  const entries = Object.entries(item).filter(([key]) => !deniedFieldNames.has(key));
  return Object.fromEntries(entries);
}
