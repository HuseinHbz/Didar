import type { PermissionId, UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import {
  PERMISSION_OVERRIDE_REPOSITORY,
  type PermissionOverrideRepositoryPort,
} from '../../domain/ports/permission-override.repository.port';

@Injectable()
export class ClearPermissionOverrideUseCase {
  constructor(
    @Inject(PERMISSION_OVERRIDE_REPOSITORY)
    private readonly overrides: PermissionOverrideRepositoryPort,
  ) {}

  async execute(userId: UserId, permissionId: PermissionId): Promise<void> {
    await this.overrides.clear(userId, permissionId);
  }
}
