import { type UserId, asWarehouseId } from '@iecp/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { StockCountService } from '../../application/stock-count.service';
import {
  CreateStockCountDto,
  ListStockCountsQueryDto,
  StockCountPageResponseDto,
  StockCountResponseDto,
  SubmitStockCountDto,
} from '../dto/stock-count.dto';

/** The brief's exact `POST /admin/inventory/counts` +
 * `/:id/{submit,approve}` endpoint list. Approving reconciles every
 * non-zero-variance line into the ledger (`COUNT_ADJUSTMENT`), always
 * audited (see `StockCountService`). */
@ApiTags('admin/inventory/counts')
@Controller('admin/inventory/counts')
export class StockCountController {
  constructor(private readonly counts: StockCountService) {}

  @Get()
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: StockCountPageResponseDto })
  async list(@Query() query: ListStockCountsQueryDto): Promise<StockCountPageResponseDto> {
    const result = await this.counts.list({
      warehouseId: query.warehouseId ? asWarehouseId(query.warehouseId) : undefined,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return StockCountPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: StockCountResponseDto })
  async get(@Param('id') id: string): Promise<StockCountResponseDto> {
    const result = await this.counts.get(id);
    return StockCountResponseDto.fromDomain(result);
  }

  @Post()
  @RequirePermission('inventory.count.create')
  @ApiOkResponse({ type: StockCountResponseDto })
  async create(@Body() dto: CreateStockCountDto): Promise<StockCountResponseDto> {
    const result = await this.counts.create(dto);
    return StockCountResponseDto.fromDomain(result);
  }

  @Post(':id/submit')
  @RequirePermission('inventory.count.create')
  @ApiOkResponse({ type: StockCountResponseDto })
  async submit(
    @Param('id') id: string,
    @Body() dto: SubmitStockCountDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<StockCountResponseDto> {
    const result = await this.counts.submit(id, actorId, dto.items);
    return StockCountResponseDto.fromDomain(result);
  }

  @Post(':id/approve')
  @RequirePermission('inventory.count.approve')
  @ApiOkResponse({ type: StockCountResponseDto })
  async approve(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<StockCountResponseDto> {
    const result = await this.counts.approve(id, actorId);
    return StockCountResponseDto.fromDomain(result);
  }

  @Post(':id/reject')
  @RequirePermission('inventory.count.approve')
  @ApiOkResponse({ type: StockCountResponseDto })
  async reject(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<StockCountResponseDto> {
    const result = await this.counts.reject(id, actorId);
    return StockCountResponseDto.fromDomain(result);
  }
}
