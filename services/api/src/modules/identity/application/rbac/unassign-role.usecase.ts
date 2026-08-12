import type { RoleId, UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import { ROLE_REPOSITORY, type RoleRepositoryPort } from '../../domain/ports/role.repository.port';

@Injectable()
export class UnassignRoleUseCase {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort) {}

  async execute(userId: UserId, roleId: RoleId): Promise<void> {
    await this.roles.unassignFromUser(userId, roleId);
  }
}
