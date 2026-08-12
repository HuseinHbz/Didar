import type { PermissionEffect, PermissionId, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { PermissionOverride } from '../../domain/entities/permission-override.entity';
import {
  PERMISSION_OVERRIDE_REPOSITORY,
  type PermissionOverrideRepositoryPort,
} from '../../domain/ports/permission-override.repository.port';
import {
  PERMISSION_REPOSITORY,
  type PermissionRepositoryPort,
} from '../../domain/ports/permission.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';

/** blueprint §53's per-user exception ("Product.Publish = NO"). `createdBy`
 * is always the acting admin's own id, taken from their session — never a
 * value the request body can set. */
@Injectable()
export class SetPermissionOverrideUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepositoryPort,
    @Inject(PERMISSION_OVERRIDE_REPOSITORY)
    private readonly overrides: PermissionOverrideRepositoryPort,
  ) {}

  async execute(props: {
    userId: UserId;
    permissionId: PermissionId;
    effect: PermissionEffect;
    reason?: string | null;
    createdBy: UserId;
  }): Promise<PermissionOverride> {
    if (!(await this.users.findById(props.userId))) {
      throw new NotFoundException(`User ${props.userId} not found`);
    }
    if (!(await this.permissions.findById(props.permissionId))) {
      throw new NotFoundException(`Permission ${props.permissionId} not found`);
    }
    return this.overrides.set(props);
  }
}
