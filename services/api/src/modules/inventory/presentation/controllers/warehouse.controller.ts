import { asWarehouseId } from '@iecp/types';
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { LocationsService } from '../../application/locations.service';
import { WarehousesService } from '../../application/warehouses.service';
import {
  CreateLocationDto,
  CreateWarehouseDto,
  ListWarehousesQueryDto,
  UpdateWarehouseDto,
  WarehouseLocationResponseDto,
  WarehousePageResponseDto,
  WarehouseResponseDto,
} from '../dto/warehouse.dto';

/** `POST/GET/PATCH /admin/inventory/warehouses` + `POST /admin/inventory/locations`
 * — the brief's exact admin endpoint list for warehouse/location management. */
@ApiTags('admin/inventory/warehouses')
@Controller('admin/inventory')
export class WarehouseController {
  constructor(
    private readonly warehouses: WarehousesService,
    private readonly locations: LocationsService,
  ) {}

  @Get('warehouses')
  @RequireModule('inventory')
  @ApiOkResponse({ type: WarehousePageResponseDto })
  async list(@Query() query: ListWarehousesQueryDto): Promise<WarehousePageResponseDto> {
    const result = await this.warehouses.list({
      type: query.type,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return WarehousePageResponseDto.fromResult(result);
  }

  @Get('warehouses/:id')
  @RequireModule('inventory')
  @ApiOkResponse({ type: WarehouseResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<WarehouseResponseDto> {
    const warehouse = await this.warehouses.get(asWarehouseId(id));
    return WarehouseResponseDto.fromDomain(warehouse);
  }

  @Post('warehouses')
  @RequirePermission('inventory.warehouse.manage')
  @ApiOkResponse({ type: WarehouseResponseDto })
  async create(@Body() dto: CreateWarehouseDto): Promise<WarehouseResponseDto> {
    const warehouse = await this.warehouses.create(dto);
    return WarehouseResponseDto.fromDomain(warehouse);
  }

  @Patch('warehouses/:id')
  @RequirePermission('inventory.warehouse.manage')
  @ApiOkResponse({ type: WarehouseResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWarehouseDto,
  ): Promise<WarehouseResponseDto> {
    const warehouse = await this.warehouses.update(asWarehouseId(id), dto);
    return WarehouseResponseDto.fromDomain(warehouse);
  }

  @Get('warehouses/:id/locations')
  @RequireModule('inventory')
  @ApiOkResponse({ type: [WarehouseLocationResponseDto] })
  async listLocations(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WarehouseLocationResponseDto[]> {
    const locations = await this.locations.listByWarehouse(asWarehouseId(id));
    return locations.map((location) => WarehouseLocationResponseDto.fromDomain(location));
  }

  @Post('locations')
  @RequirePermission('inventory.warehouse.manage')
  @ApiOkResponse({ type: WarehouseLocationResponseDto })
  async createLocation(@Body() dto: CreateLocationDto): Promise<WarehouseLocationResponseDto> {
    const location = await this.locations.create(dto);
    return WarehouseLocationResponseDto.fromDomain(location);
  }
}
