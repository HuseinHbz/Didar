import { ApiProperty } from '@nestjs/swagger';

import type { User } from '../../domain/entities/user.entity';

/** `phone`/`email` are field-permission-gated — see identity.controller.ts's
 * `@FieldPermissions` on `GET /users/:id` and
 * presentation/interceptors/field-permission.interceptor.ts. A caller
 * without `identity.users.view_contact` still gets a 200 with `id`/
 * `createdAt`, just without the two contact fields — not a 403, since the
 * user's *existence* isn't the thing being gated. */
export class UserResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '+989121234567', required: false })
  phone?: string;

  @ApiProperty({ required: false, nullable: true })
  email?: string | null;

  @ApiProperty()
  createdAt!: Date;

  static fromDomain(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.phone = user.phone;
    dto.email = user.email;
    dto.createdAt = user.createdAt;
    return dto;
  }
}
