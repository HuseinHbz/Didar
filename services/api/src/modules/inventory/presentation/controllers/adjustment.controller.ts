import { type UserId, asProductSkuId, asWarehouseId } from '@iecp/types';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { AdjustmentService } from '../../application/adjustment.service';
import {
  AdjustmentPageResponseDto,
  AdjustmentResponseDto,
  CreateAdjustmentDto,
} from '../dto/adjustment.dto';
import { PaginationQueryDto } from '../dto/pagination.dto';

class AdjustmentQueryDto extends PaginationQueryDto {
  @IsUUID() warehouseId!: string;
}

/** `POST /admin/inventory/adjustments` — the brief's own critical_rule:
 * "manual adjustments must be permission-controlled and audited." Both
 * halves are enforced here: `@RequirePermission('inventory.adjust')` and
 * an unconditional `system.AuditLog` write (see `AdjustmentService`). */
@ApiTags('admin/inventory/adjustments')
@Controller('admin/inventory/adjustments')
export class AdjustmentController {
  constructor(private readonly adjustments: AdjustmentService) {}

  @Get()
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: AdjustmentPageResponseDto })
  async list(@Query() query: AdjustmentQueryDto): Promise<AdjustmentPageResponseDto> {
    const result = await this.adjustments.listByWarehouse(asWarehouseId(query.warehouseId), {
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return AdjustmentPageResponseDto.fromResult(result);
  }

  @Post()
  @RequirePermission('inventory.adjust')
  @ApiOkResponse({ type: AdjustmentResponseDto })
  async create(
    @Body() dto: CreateAdjustmentDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<AdjustmentResponseDto> {
    const adjustment = await this.adjustments.create({
      warehouseId: asWarehouseId(dto.warehouseId),
      locationId: dto.locationId,
      productSkuId: asProductSkuId(dto.productSkuId),
      adjustmentType: dto.adjustmentType,
      quantity: dto.quantity,
      reason: dto.reason,
      approvedBy: dto.approvedBy as UserId | undefined,
      createdBy: actorId,
    });
    return AdjustmentResponseDto.fromDomain(adjustment);
  }
}
