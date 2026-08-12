import { Inject, Injectable } from '@nestjs/common';

import type { Permission } from '../../domain/entities/permission.entity';
import {
  PERMISSION_REPOSITORY,
  type PermissionRepositoryPort,
} from '../../domain/ports/permission.repository.port';

/** blueprint's "permission matrix" — the full registry, so an admin UI can
 * render module × action rows without a separate discovery mechanism.
 * Read-only: permissions are registered by code (a migration seeding one
 * per real endpoint), not created ad hoc through this API. */
@Injectable()
export class ListPermissionsUseCase {
  constructor(
    @Inject(PERMISSION_REPOSITORY) private readonly permissions: PermissionRepositoryPort,
  ) {}

  async execute(): Promise<Permission[]> {
    return this.permissions.list();
  }
}
