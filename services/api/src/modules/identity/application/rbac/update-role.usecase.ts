import type { RoleId } from '@iecp/types';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { Role } from '../../domain/entities/role.entity';
import { ROLE_REPOSITORY, type RoleRepositoryPort } from '../../domain/ports/role.repository.port';

/** The one place `wouldCreateCycle` gets checked — every other write path
 * (create-role) can only ever point a *new* role at an existing parent, so
 * a cycle through it is structurally impossible; only re-parenting an
 * existing role can introduce one. */
@Injectable()
export class UpdateRoleUseCase {
  constructor(@Inject(ROLE_REPOSITORY) private readonly roles: RoleRepositoryPort) {}

  async execute(
    id: RoleId,
    props: { name?: string; description?: string | null; parentId?: RoleId | null },
  ): Promise<Role> {
    const existing = await this.roles.findById(id);
    if (!existing) {
      throw new NotFoundException(`Role ${id} not found`);
    }

    if (props.parentId) {
      if (!(await this.roles.findById(props.parentId))) {
        throw new NotFoundException(`Parent role ${props.parentId} not found`);
      }
      if (await this.roles.wouldCreateCycle(id, props.parentId)) {
        throw new BadRequestException('That parent would create a cycle in the role hierarchy');
      }
    }

    return this.roles.update(id, props);
  }
}
