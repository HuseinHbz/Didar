import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';

import {
  SECURITY_EVENT_REPOSITORY,
  type SecurityEventRepositoryPort,
} from '../../domain/ports/security-event.repository.port';
import { USER_REPOSITORY, type UserRepositoryPort } from '../../domain/ports/user.repository.port';
import { PasswordHasherService } from '../../infrastructure/crypto/password-hasher.service';

import { CompleteLoginService } from './complete-login.service';
import type { LoginContext, LoginOutcome } from './login-types';

/** blueprint §56: "Password optional" — a user only reaches this path if
 * they (or an admin) set one via SetPasswordUseCase; OTP is always
 * available regardless. Error messages are deliberately identical whether
 * the email doesn't exist, has no password set, or the password is wrong —
 * distinguishing them would let a caller enumerate registered emails. */
@Injectable()
export class LoginWithPasswordUseCase {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepositoryPort,
    @Inject(SECURITY_EVENT_REPOSITORY) private readonly securityEvents: SecurityEventRepositoryPort,
    private readonly passwordHasher: PasswordHasherService,
    private readonly completeLogin: CompleteLoginService,
  ) {}

  async execute(props: { email: string; password: string } & LoginContext): Promise<LoginOutcome> {
    const user = await this.users.findByEmail(props.email);

    if (
      !user?.passwordHash ||
      !(await this.passwordHasher.verify(user.passwordHash, props.password))
    ) {
      await this.securityEvents.record({
        userId: user?.id,
        type: 'LOGIN_FAILURE',
        ipAddress: props.ipAddress,
        userAgent: props.userAgent,
        metadata: { email: props.email },
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.completeLogin.afterPrimaryFactor(user, props);
  }
}
