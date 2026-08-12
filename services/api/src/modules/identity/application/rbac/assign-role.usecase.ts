import type { RoleId, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ROLE_REPOSITORY, type RoleRepositoryPort } from '../../domain/ports/role.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';

@Injectable()
export class AssignRoleUseCase {
  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort,
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
  ) {}

  async execute(userId: UserId, roleId: RoleId): Promise<void> {
    if (!(await this.users.findById(userId))) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    if (!(await this.roles.findById(roleId))) {
      throw new NotFoundException(`Role ${roleId} not found`);
    }
    await this.roles.assignToUser(userId, roleId);
  }
}
