import { prisma } from '@iecp/database';
import type { UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { User } from '../domain/user.entity';
import type { UserRepositoryPort } from '../domain/user.repository.port';

/**
 * Infrastructure layer: the only place in this module allowed to import
 * `@iecp/database` / talk Prisma. Maps the Prisma row shape to the domain entity.
 */
@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  async findById(id: UserId): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    if (!row) {
      return null;
    }
    return User.create({ id: row.id, phone: row.phone, createdAt: row.createdAt });
  }
}
