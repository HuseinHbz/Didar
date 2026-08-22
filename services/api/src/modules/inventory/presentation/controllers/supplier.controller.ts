import { type UserId, asSupplierId } from '@iecp/types';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { SupplierService } from '../../application/supplier.service';
import {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  SupplierPageResponseDto,
  SupplierResponseDto,
  UpdateSupplierDto,
} from '../dto/supplier.dto';

/** Vendor master data — `GET/POST /admin/inventory/suppliers`,
 * `PATCH /:id`. One permission gates every route (read and write alike),
 * the same shape `WarehouseController` already established for master
 * data: there's no separate read-only role split for master data the way
 * there is for a transactional entity's own state machine. */
@ApiTags('admin/inventory/suppliers')
@Controller('admin/inventory/suppliers')
export class SupplierController {
  constructor(private readonly suppliers: SupplierService) {}

  @Get()
  @RequirePermission('inventory.supplier.manage')
  @ApiOkResponse({ type: SupplierPageResponseDto })
  async list(@Query() query: ListSuppliersQueryDto): Promise<SupplierPageResponseDto> {
    const result = await this.suppliers.list({
      status: query.status,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return SupplierPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequirePermission('inventory.supplier.manage')
  @ApiOkResponse({ type: SupplierResponseDto })
  async get(@Param('id') id: string): Promise<SupplierResponseDto> {
    const supplier = await this.suppliers.get(asSupplierId(id));
    return SupplierResponseDto.fromDomain(supplier);
  }

  @Post()
  @RequirePermission('inventory.supplier.manage')
  @ApiOkResponse({ type: SupplierResponseDto })
  async create(
    @Body() dto: CreateSupplierDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<SupplierResponseDto> {
    const supplier = await this.suppliers.create(dto, actorId);
    return SupplierResponseDto.fromDomain(supplier);
  }

  @Patch(':id')
  @RequirePermission('inventory.supplier.manage')
  @ApiOkResponse({ type: SupplierResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<SupplierResponseDto> {
    const supplier = await this.suppliers.update(asSupplierId(id), dto, actorId);
    return SupplierResponseDto.fromDomain(supplier);
  }
}
