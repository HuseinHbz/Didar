import type { RoleId } from '@iecp/types';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { Role } from '../../domain/entities/role.entity';
import { ROLE_REPOSITORY, type RoleRepositoryPort } from '../../domain/ports/role.repository.port';

/** blueprint §53 — `parentId` is how a new role plugs into the inheritance
 * tree (e.g. the blueprint's own Admin → Commerce → Products example). */
@Injectable()
export class CreateRoleUseCase {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort) {}

  async execute(props: {
    name: string;
    description?: string | null;
    parentId?: RoleId | null;
  }): Promise<Role> {
    if (props.parentId && !(await this.roles.findById(props.parentId))) {
      throw new NotFoundException(`Parent role ${props.parentId} not found`);
    }
    if (await this.roles.findByName(props.name)) {
      throw new BadRequestException(`Role "${props.name}" already exists`);
    }
    return this.roles.create(props);
  }
}
