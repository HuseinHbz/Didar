import { asProductSkuId, asWarehouseId } from '@iecp/types';
import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { LowStockService } from '../../application/low-stock.service';
import { StockQueryService } from '../../application/stock-query.service';
import { LowStockRowResponseDto, SetThresholdDto } from '../dto/low-stock.dto';
import { PaginationQueryDto } from '../dto/pagination.dto';
import {
  InventoryItemPageResponseDto,
  SkuAvailabilityResponseDto,
  SkuLookupResponseDto,
} from '../dto/stock.dto';

class StockQueryDto extends PaginationQueryDto {
  @IsUUID() warehouseId!: string;
}

class LowStockQueryDto {
  @IsOptional() @IsUUID() warehouseId?: string;
}

/** `GET /admin/inventory/stock`, `GET /admin/inventory/low-stock`, and the
 * barcode/SKU-code fast-lookup endpoints (the brief's own "barcode"
 * requirements — SKU barcode lookup, exact SKU resolution, fast lookup). */
@ApiTags('admin/inventory/stock')
@Controller('admin/inventory')
export class StockController {
  constructor(
    private readonly stock: StockQueryService,
    private readonly lowStock: LowStockService,
  ) {}

  @Get('stock')
  @RequireModule('inventory')
  @ApiOkResponse({ type: InventoryItemPageResponseDto })
  async listStock(@Query() query: StockQueryDto): Promise<InventoryItemPageResponseDto> {
    const result = await this.stock.listByWarehouse(asWarehouseId(query.warehouseId), {
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return InventoryItemPageResponseDto.fromResult(result);
  }

  @Get('stock/:skuId')
  @RequireModule('inventory')
  @ApiOkResponse({ type: SkuAvailabilityResponseDto })
  async getSkuStock(@Param('skuId') skuId: string): Promise<SkuAvailabilityResponseDto> {
    const availability = await this.stock.getAvailability(asProductSkuId(skuId));
    return SkuAvailabilityResponseDto.fromDomain(availability);
  }

  @Get('low-stock')
  @RequireModule('inventory')
  @ApiOkResponse({ type: [LowStockRowResponseDto] })
  async listLowStock(@Query() query: LowStockQueryDto): Promise<LowStockRowResponseDto[]> {
    const rows = await this.lowStock.listLowStock(
      query.warehouseId ? asWarehouseId(query.warehouseId) : undefined,
    );
    return rows.map((row) => LowStockRowResponseDto.fromDomain(row));
  }

  @Put('low-stock/threshold')
  @RequirePermission('inventory.update')
  @ApiOkResponse({ type: LowStockRowResponseDto })
  async setThreshold(
    @Body() dto: SetThresholdDto,
  ): Promise<{ productSkuId: string; warehouseId: string }> {
    const threshold = await this.lowStock.setThreshold({
      productSkuId: asProductSkuId(dto.productSkuId),
      warehouseId: asWarehouseId(dto.warehouseId),
      reorderPoint: dto.reorderPoint,
      safetyStock: dto.safetyStock,
      minStock: dto.minStock,
      maxStock: dto.maxStock,
    });
    return { productSkuId: threshold.productSkuId, warehouseId: threshold.warehouseId };
  }

  @Get('barcode/:code')
  @RequireModule('inventory')
  @ApiOkResponse({ type: SkuLookupResponseDto })
  async lookupByBarcode(@Param('code') code: string): Promise<SkuLookupResponseDto> {
    return this.stock.lookupByBarcode(code);
  }

  @Get('sku-code/:code')
  @RequireModule('inventory')
  @ApiOkResponse({ type: SkuLookupResponseDto })
  async lookupBySkuCode(@Param('code') code: string): Promise<SkuLookupResponseDto> {
    return this.stock.lookupBySkuCode(code);
  }
}
