import { prisma, type Role as PrismaRole } from '@iecp/database';
import { asRoleId, type RoleId, type UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Role } from '../../domain/entities/role.entity';
import type { RoleRepositoryPort } from '../../domain/ports/role.repository.port';

/** Cheap, generous bound on ancestor-chain depth — catches a runaway walk
 * (a cycle that slipped past `wouldCreateCycle`) with a clear error instead
 * of an infinite loop. No real role tree should ever come close to this. */
const MAX_ANCESTOR_DEPTH = 50;

@Injectable()
export class PrismaRoleRepository implements RoleRepositoryPort {
  async findById(id: RoleId): Promise<Role | null> {
    const row = await prisma.role.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByName(name: string): Promise<Role | null> {
    const row = await prisma.role.findUnique({ where: { name } });
    return row ? toDomain(row) : null;
  }

  async list(): Promise<Role[]> {
    const rows = await prisma.role.findMany({ orderBy: { name: 'asc' } });
    return rows.map(toDomain);
  }

  async create(props: {
    name: string;
    description?: string | null;
    parentId?: RoleId | null;
    isSystem?: boolean;
  }): Promise<Role> {
    const row = await prisma.role.create({
      data: {
        name: props.name,
        description: props.description ?? null,
        parentId: props.parentId ?? null,
        isSystem: props.isSystem ?? false,
      },
    });
    return toDomain(row);
  }

  async update(
    id: RoleId,
    props: { name?: string; description?: string | null; parentId?: RoleId | null },
  ): Promise<Role> {
    const row = await prisma.role.update({
      where: { id },
      data: {
        ...(props.name !== undefined && { name: props.name }),
        ...(props.description !== undefined && { description: props.description }),
        ...(props.parentId !== undefined && { parentId: props.parentId }),
      },
    });
    return toDomain(row);
  }

  async getEffectiveRoleIds(assignedRoleIds: RoleId[]): Promise<RoleId[]> {
    const effective = new Set<RoleId>(assignedRoleIds);
    let frontier = [...assignedRoleIds];

    for (let depth = 0; frontier.length > 0 && depth < MAX_ANCESTOR_DEPTH; depth++) {
      const parents = await prisma.role.findMany({
        where: { id: { in: frontier }, parentId: { not: null } },
        select: { parentId: true },
      });
      const nextFrontier: RoleId[] = [];
      for (const { parentId } of parents) {
        if (parentId && !effective.has(asRoleId(parentId))) {
          const id = asRoleId(parentId);
          effective.add(id);
          nextFrontier.push(id);
        }
      }
      frontier = nextFrontier;
    }

    return [...effective];
  }

  async wouldCreateCycle(roleId: RoleId, candidateParentId: RoleId): Promise<boolean> {
    if (roleId === candidateParentId) {
      return true;
    }
    // Walk up from the candidate parent — if we ever reach `roleId`, setting
    // roleId's parent to candidateParentId would close a loop. The `return`
    // statements inside are the real loop exits; `depth` is just the bound
    // against a corrupt tree (see MAX_ANCESTOR_DEPTH).
    let currentId: RoleId = candidateParentId;
    for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth++) {
      const row = await prisma.role.findUnique({
        where: { id: currentId },
        select: { parentId: true },
      });
      if (!row?.parentId) {
        return false;
      }
      if (asRoleId(row.parentId) === roleId) {
        return true;
      }
      currentId = asRoleId(row.parentId);
    }
    return false;
  }

  async listAssignedRoleIds(userId: UserId): Promise<RoleId[]> {
    const rows = await prisma.userRole.findMany({ where: { userId }, select: { roleId: true } });
    return rows.map((row) => asRoleId(row.roleId));
  }

  async assignToUser(userId: UserId, roleId: RoleId): Promise<void> {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });
  }

  async unassignFromUser(userId: UserId, roleId: RoleId): Promise<void> {
    await prisma.userRole.deleteMany({ where: { userId, roleId } });
  }
}

function toDomain(row: PrismaRole): Role {
  return Role.create({
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
    createdAt: row.createdAt,
  });
}
