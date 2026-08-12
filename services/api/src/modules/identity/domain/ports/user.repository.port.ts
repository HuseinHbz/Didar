import type { UserId } from '@iecp/types';

import type { User } from '../entities/user.entity';

/**
 * Repository port (interface). The domain/application layers depend on this
 * abstraction, never on `@iecp/database`/Prisma directly — that dependency is
 * confined to `infrastructure/`. This is what makes the domain layer testable
 * without a real database and swappable without touching application logic.
 */
export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepositoryPort {
  findById(id: UserId): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  /** Creates a user with just a verified phone (mobile-OTP-first signup — blueprint §56). */
  createFromVerifiedPhone(phone: string): Promise<User>;
  setPasswordHash(id: UserId, passwordHash: string): Promise<void>;
  markLoggedIn(id: UserId, at: Date): Promise<void>;
}
