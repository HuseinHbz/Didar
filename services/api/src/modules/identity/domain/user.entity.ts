import { asUserId, type UserId } from '@iecp/types';

/**
 * Domain entity — framework- and Prisma-agnostic. This layer knows nothing about
 * HTTP, NestJS decorators, or SQL; it's plain TypeScript, which is the point of
 * keeping it separate from `infrastructure/`.
 */
export class User {
  private constructor(
    public readonly id: UserId,
    public readonly phone: string,
    public readonly createdAt: Date,
  ) {}

  static create(props: { id: string; phone: string; createdAt: Date }): User {
    return new User(asUserId(props.id), props.phone, props.createdAt);
  }
}
