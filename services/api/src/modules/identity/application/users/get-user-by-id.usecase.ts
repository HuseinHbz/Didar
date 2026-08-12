import type { UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { User } from '../../domain/entities/user.entity';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';

/**
 * Application layer: one use case per file. Orchestrates the domain/ports;
 * contains no framework-specific HTTP concerns (those live in presentation/) and
 * no persistence details (those live in infrastructure/).
 */
@Injectable()
export class GetUserByIdUseCase {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort) {}

  async execute(id: UserId): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
