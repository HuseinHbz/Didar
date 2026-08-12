import type { UserId } from '@iecp/types';
import { Inject, Injectable } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';
import { PasswordHasherService } from '../../infrastructure/crypto/password-hasher.service';

/** Sets or changes the caller's own password — the enrollment step every
 * OTP-first user needs before `LoginWithPasswordUseCase` can ever succeed
 * for them (blueprint §56's "Password optional"). Authorization (this is
 * the caller's own account) is enforced by the controller passing the JWT's
 * `sub` as `userId`, never a value taken from the request body. */
@Injectable()
export class SetPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    private readonly passwordHasher: PasswordHasherService,
  ) {}

  async execute(userId: UserId, newPassword: string): Promise<void> {
    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.users.setPasswordHash(userId, passwordHash);
    await this.securityEvents.record({ userId, type: 'PASSWORD_CHANGED' });
  }
}
