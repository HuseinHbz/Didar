import { type UserId, asSupplierId, asWarehouseId } from '@iecp/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { PurchaseOrderService } from '../../application/purchase-order.service';
import {
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  PurchaseOrderPageResponseDto,
  PurchaseOrderResponseDto,
  ReceivePurchaseOrderDto,
} from '../dto/purchase-order.dto';

/** `POST/GET /admin/inventory/purchase-orders` + `/:id/{approve,receive,
 * cancel}` — a real 6-state machine underneath (`PurchaseOrderStateMachine`),
 * every approve/receive/cancel audited. Read routes reuse
 * `inventory.ledger.read` — the same choice `TransferController`/
 * `AdjustmentController` already made for their own read routes (a
 * purchase order's history is, structurally, ledger-adjacent). */
@ApiTags('admin/inventory/purchase-orders')
@Controller('admin/inventory/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly purchaseOrders: PurchaseOrderService) {}

  @Get()
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: PurchaseOrderPageResponseDto })
  async list(@Query() query: ListPurchaseOrdersQueryDto): Promise<PurchaseOrderPageResponseDto> {
    const result = await this.purchaseOrders.list({
      status: query.status,
      supplierId: query.supplierId ? asSupplierId(query.supplierId) : undefined,
      warehouseId: query.warehouseId ? asWarehouseId(query.warehouseId) : undefined,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return PurchaseOrderPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  async get(@Param('id') id: string): Promise<PurchaseOrderResponseDto> {
    const result = await this.purchaseOrders.get(id);
    return PurchaseOrderResponseDto.fromDomain(result);
  }

  @Post()
  @RequirePermission('inventory.purchase_order.create')
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  async create(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<PurchaseOrderResponseDto> {
    const result = await this.purchaseOrders.create({
      supplierId: dto.supplierId,
      warehouseId: dto.warehouseId,
      notes: dto.notes,
      createdBy: actorId,
      items: dto.items.map((item) => ({
        productSkuId: item.productSkuId,
        orderedQuantity: item.orderedQuantity,
        unitCost: BigInt(item.unitCost),
      })),
    });
    return PurchaseOrderResponseDto.fromDomain(result);
  }

  @Post(':id/approve')
  @RequirePermission('inventory.purchase_order.approve')
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  async approve(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<PurchaseOrderResponseDto> {
    const result = await this.purchaseOrders.approve(id, actorId);
    return PurchaseOrderResponseDto.fromDomain(result);
  }

  @Post(':id/receive')
  @RequirePermission('inventory.purchase_order.receive')
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  async receive(
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<PurchaseOrderResponseDto> {
    const result = await this.purchaseOrders.receive(id, actorId, dto.items, dto.idempotencyKey);
    return PurchaseOrderResponseDto.fromDomain(result);
  }

  @Post(':id/cancel')
  @RequirePermission('inventory.purchase_order.create')
  @ApiOkResponse({ type: PurchaseOrderResponseDto })
  async cancel(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<PurchaseOrderResponseDto> {
    const result = await this.purchaseOrders.cancel(id, actorId);
    return PurchaseOrderResponseDto.fromDomain(result);
  }
}
