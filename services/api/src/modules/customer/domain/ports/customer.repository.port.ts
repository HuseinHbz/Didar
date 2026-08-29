import type { CustomerId, UserId } from '@iecp/types';

import type { Customer } from '../entities/customer.entity';

export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY');

export interface CustomerRepositoryPort {
  findByUserId(userId: UserId): Promise<Customer | null>;
  findById(id: CustomerId): Promise<Customer | null>;
  updateProfile(
    id: CustomerId,
    props: {
      firstName?: string;
      lastName?: string;
      birthDate?: Date | null;
      gender?: 'MALE' | 'FEMALE' | 'OTHER' | null;
    },
  ): Promise<Customer>;
}
