import { asProductSkuId, asWarehouseId } from '@iecp/types';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { LedgerService } from '../../application/ledger.service';
import { LedgerPageResponseDto } from '../dto/ledger.dto';
import { PaginationQueryDto } from '../dto/pagination.dto';

class LedgerQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() productSkuId?: string;
  @IsOptional() @IsUUID() warehouseId?: string;
  @IsOptional() @IsString() referenceType?: string;
  @IsOptional() @IsString() referenceId?: string;
}

/** `GET /admin/inventory/ledger` — the brief's own critical_rule: "every
 * stock mutation must create an inventory transaction/ledger record."
 * This is the read side proving it, filterable by SKU, warehouse, or an
 * exact reference (e.g. `?referenceType=STOCK_TRANSFER&referenceId=...`).
 * Permission-gated separately from general inventory read
 * (`inventory.ledger.read`, not just `@RequireModule`) — the brief's own
 * "inventory ledger access must be permission-controlled." */
@ApiTags('admin/inventory/ledger')
@Controller('admin/inventory/ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get()
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: LedgerPageResponseDto })
  async list(@Query() query: LedgerQueryDto): Promise<LedgerPageResponseDto> {
    if (query.referenceType && query.referenceId) {
      const entries = await this.ledger.listByReference(query.referenceType, query.referenceId);
      return LedgerPageResponseDto.fromResult({ items: entries, nextCursor: null });
    }
    const pagination = { cursor: query.cursor, limit: query.limit ?? 20 };
    if (query.productSkuId) {
      const result = await this.ledger.listBySku(asProductSkuId(query.productSkuId), pagination);
      return LedgerPageResponseDto.fromResult(result);
    }
    if (query.warehouseId) {
      const result = await this.ledger.listByWarehouse(
        asWarehouseId(query.warehouseId),
        pagination,
      );
      return LedgerPageResponseDto.fromResult(result);
    }
    return LedgerPageResponseDto.fromResult({ items: [], nextCursor: null });
  }
}
