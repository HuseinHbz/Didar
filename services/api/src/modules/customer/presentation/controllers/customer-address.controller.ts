import { asCustomerAddressId, type UserId } from '@iecp/types';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { CustomerAddressService } from '../../application/addresses/customer-address.service';
import { CustomerAddressResponseDto, CreateCustomerAddressDto, UpdateCustomerAddressDto } from '../dto/customer-address.dto';

/** `/me/addresses[/:id]` — same `me/sessions` shape: authenticated-only,
 * no RBAC decorator, ownership enforced by `CustomerAddressService`
 * itself against the server-derived `customerId`. */
@ApiTags('customer')
@Controller('me/addresses')
export class CustomerAddressController {
  constructor(private readonly addresses: CustomerAddressService) {}

  @Get()
  @ApiOkResponse({ type: [CustomerAddressResponseDto] })
  async list(@CurrentUserId() userId: UserId): Promise<CustomerAddressResponseDto[]> {
    const items = await this.addresses.list(userId);
    return items.map((item) => CustomerAddressResponseDto.fromDomain(item));
  }

  @Post()
  @ApiOkResponse({ type: CustomerAddressResponseDto })
  async create(
    @CurrentUserId() userId: UserId,
    @Body() dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddressResponseDto> {
    const created = await this.addresses.create(userId, {
      label: dto.label ?? null,
      recipientName: dto.recipientName,
      phone: dto.phone,
      province: dto.province,
      city: dto.city,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2 ?? null,
      postalCode: dto.postalCode ?? null,
      isDefault: dto.isDefault ?? false,
    });
    return CustomerAddressResponseDto.fromDomain(created);
  }

  @Patch(':id')
  @ApiOkResponse({ type: CustomerAddressResponseDto })
  async update(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressResponseDto> {
    const updated = await this.addresses.update(userId, asCustomerAddressId(id), dto);
    return CustomerAddressResponseDto.fromDomain(updated);
  }

  @Post(':id/default')
  @ApiOkResponse({ type: CustomerAddressResponseDto })
  async setDefault(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerAddressResponseDto> {
    const updated = await this.addresses.setDefault(userId, asCustomerAddressId(id));
    return CustomerAddressResponseDto.fromDomain(updated);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUserId() userId: UserId, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.addresses.remove(userId, asCustomerAddressId(id));
  }
}
