import { prisma, type Permission as PrismaPermission } from '@iecp/database';
import type { PermissionId, RoleId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Permission } from '../../domain/entities/permission.entity';
import type { PermissionRepositoryPort } from '../../domain/ports/permission.repository.port';

@Injectable()
export class PrismaPermissionRepository implements PermissionRepositoryPort {
  async findById(id: PermissionId): Promise<Permission | null> {
    const row = await prisma.permission.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByKey(key: string): Promise<Permission | null> {
    const row = await prisma.permission.findUnique({ where: { key } });
    return row ? toDomain(row) : null;
  }

  async list(): Promise<Permission[]> {
    const rows = await prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async listKeysForRoles(roleIds: RoleId[]): Promise<string[]> {
    if (roleIds.length === 0) {
      return [];
    }
    const rows = await prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      select: { permission: { select: { key: true } } },
    });
    return [...new Set(rows.map((row) => row.permission.key))];
  }

  async grantToRole(roleId: RoleId, permissionId: PermissionId): Promise<void> {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId } },
      update: {},
      create: { roleId, permissionId },
    });
  }

  async revokeFromRole(roleId: RoleId, permissionId: PermissionId): Promise<void> {
    await prisma.rolePermission.deleteMany({ where: { roleId, permissionId } });
  }
}

function toDomain(row: PrismaPermission): Permission {
  return Permission.create({
    id: row.id,
    module: row.module,
    action: row.action,
    key: row.key,
    description: row.description,
  });
}
