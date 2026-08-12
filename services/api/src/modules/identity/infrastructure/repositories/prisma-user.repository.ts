import { prisma, type User as PrismaUser } from '@iecp/database';
import type { UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { User } from '../../domain/entities/user.entity';
import type { UserRepositoryPort } from '../../domain/ports/user.repository.port';

/**
 * Infrastructure layer: the only place in this module allowed to import
 * `@iecp/database` / talk Prisma. Maps the Prisma row shape to the domain entity.
 */
@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  async findById(id: UserId): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByPhone(phone: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { phone } });
    return row ? toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { email } });
    return row ? toDomain(row) : null;
  }

  async createFromVerifiedPhone(phone: string): Promise<User> {
    const row = await prisma.user.create({
      data: { phone, phoneVerifiedAt: new Date() },
    });
    return toDomain(row);
  }

  async setPasswordHash(id: UserId, passwordHash: string): Promise<void> {
    await prisma.user.update({ where: { id }, data: { passwordHash } });
  }

  async markLoggedIn(id: UserId, at: Date): Promise<void> {
    await prisma.user.update({ where: { id }, data: { lastLoginAt: at } });
  }
}

function toDomain(row: PrismaUser): User {
  return User.create({
    id: row.id,
    phone: row.phone,
    email: row.email,
    passwordHash: row.passwordHash,
    isActive: row.isActive,
    phoneVerifiedAt: row.phoneVerifiedAt,
    emailVerifiedAt: row.emailVerifiedAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  });
}
