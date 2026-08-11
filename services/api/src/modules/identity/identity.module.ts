import { Module } from '@nestjs/common';

import { GetUserByIdUseCase } from './application/get-user-by-id.usecase';
import { USER_REPOSITORY } from './domain/user.repository.port';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';
import { IdentityController } from './presentation/identity.controller';

@Module({
  controllers: [IdentityController],
  providers: [
    GetUserByIdUseCase,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
  ],
})
export class IdentityModule {}
