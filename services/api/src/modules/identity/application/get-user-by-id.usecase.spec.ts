import { asUserId } from '@iecp/types';
import { NotFoundException } from '@nestjs/common';

import { User } from '../domain/user.entity';
import type { UserRepositoryPort } from '../domain/user.repository.port';

import { GetUserByIdUseCase } from './get-user-by-id.usecase';

/**
 * This is the payoff of the clean-architecture split: the use case is tested
 * against a hand-rolled fake implementing `UserRepositoryPort` — no NestJS test
 * module, no database, no HTTP.
 */
describe('GetUserByIdUseCase', () => {
  const existingId = asUserId('11111111-1111-4111-8111-111111111111');
  const missingId = asUserId('22222222-2222-4222-8222-222222222222');
  const existingUser = User.create({
    id: existingId,
    phone: '+989121234567',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  });

  const fakeRepository: UserRepositoryPort = {
    findById: (id) => Promise.resolve(id === existingId ? existingUser : null),
  };

  it('returns the user when found', async () => {
    const useCase = new GetUserByIdUseCase(fakeRepository);

    await expect(useCase.execute(existingId)).resolves.toBe(existingUser);
  });

  it('throws NotFoundException when the user does not exist', async () => {
    const useCase = new GetUserByIdUseCase(fakeRepository);

    await expect(useCase.execute(missingId)).rejects.toBeInstanceOf(NotFoundException);
  });
});
