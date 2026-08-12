import { asProductSkuId } from '@iecp/types';
import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { StockQueryService } from '../../application/stock-query.service';
import { SkuAvailabilityResponseDto } from '../dto/stock.dto';

/** `GET /internal/inventory/availability/:skuId` — the exact seam this
 * phase's "next_phase.dependencies_created_by_this_phase" promises Phase
 * 007 (cart/checkout/pricing resolution). Reads only `InventoryItem`'s
 * cached quantity columns — PostgreSQL is the single source of truth on
 * every call, never Redis/OpenSearch (root `CLAUDE.md`). */
@ApiTags('internal/inventory/availability')
@Controller('internal/inventory/availability')
export class AvailabilityController {
  constructor(private readonly stock: StockQueryService) {}

  @Get(':skuId')
  @RequireModule('inventory')
  @ApiOkResponse({ type: SkuAvailabilityResponseDto })
  async get(@Param('skuId') skuId: string): Promise<SkuAvailabilityResponseDto> {
    const availability = await this.stock.getAvailability(asProductSkuId(skuId));
    return SkuAvailabilityResponseDto.fromDomain(availability);
  }
}
