import { asUserId, type UserId } from '@iecp/types';

/**
 * Domain entity — framework- and Prisma-agnostic. This layer knows nothing about
 * HTTP, NestJS decorators, or SQL; it's plain TypeScript, which is the point of
 * keeping it separate from `infrastructure/`.
 *
 * `passwordHash` is deliberately part of the entity, not stripped out of it —
 * verifying a password is domain/application logic (PasswordHasherService is
 * the infra-layer detail of *how*), so the use case that checks it needs
 * access to the hash. What must never happen is a DTO exposing it — see
 * `presentation/dto/user-response.dto.ts`, which never reads this field.
 */
export class User {
  private constructor(
    public readonly id: UserId,
    public readonly phone: string,
    public readonly email: string | null,
    public readonly passwordHash: string | null,
    public readonly isActive: boolean,
    public readonly phoneVerifiedAt: Date | null,
    public readonly emailVerifiedAt: Date | null,
    public readonly lastLoginAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    phone: string;
    email?: string | null;
    passwordHash?: string | null;
    isActive?: boolean;
    phoneVerifiedAt?: Date | null;
    emailVerifiedAt?: Date | null;
    lastLoginAt?: Date | null;
    createdAt: Date;
  }): User {
    return new User(
      asUserId(props.id),
      props.phone,
      props.email ?? null,
      props.passwordHash ?? null,
      props.isActive ?? true,
      props.phoneVerifiedAt ?? null,
      props.emailVerifiedAt ?? null,
      props.lastLoginAt ?? null,
      props.createdAt,
    );
  }
}
