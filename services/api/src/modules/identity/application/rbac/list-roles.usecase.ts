import { Inject, Injectable } from '@nestjs/common';

import type { Role } from '../../domain/entities/role.entity';
import { ROLE_REPOSITORY, type RoleRepositoryPort } from '../../domain/ports/role.repository.port';

@Injectable()
export class ListRolesUseCase {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort) {}

  async execute(): Promise<Role[]> {
    return this.roles.list();
  }
}
