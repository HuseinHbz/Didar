import { prisma } from '@iecp/database';
import type { CustomerId, UserId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import { Customer } from '../../domain/entities/customer.entity';
import type { CustomerRepositoryPort } from '../../domain/ports/customer.repository.port';

@Injectable()
export class PrismaCustomerRepository implements CustomerRepositoryPort {
  async findByUserId(userId: UserId): Promise<Customer | null> {
    const row = await prisma.customer.findUnique({ where: { userId } });
    return row ? this.toDomain(row) : null;
  }

  async findById(id: CustomerId): Promise<Customer | null> {
    const row = await prisma.customer.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async updateProfile(
    id: CustomerId,
    props: {
      firstName?: string;
      lastName?: string;
      birthDate?: Date | null;
      gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
    },
  ): Promise<Customer> {
    const row = await prisma.customer.update({
      where: { id },
      data: {
        firstName: props.firstName,
        lastName: props.lastName,
        birthDate: props.birthDate,
        gender: props.gender,
      },
    });
    return this.toDomain(row);
  }

  private toDomain(row: {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    nationalId: string | null;
    birthDate: Date | null;
    gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
    createdAt: Date;
    updatedAt: Date;
  }): Customer {
    return Customer.create(row);
  }
}
