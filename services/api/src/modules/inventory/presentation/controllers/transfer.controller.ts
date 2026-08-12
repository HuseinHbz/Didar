import { type UserId, asWarehouseId } from '@iecp/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { TransferService } from '../../application/transfer.service';
import {
  ApproveTransferDto,
  CreateTransferDto,
  DispatchTransferDto,
  ListTransfersQueryDto,
  ReceiveTransferDto,
  TransferPageResponseDto,
  TransferResponseDto,
} from '../dto/transfer.dto';

/** The brief's exact `POST/GET /admin/inventory/transfers` +
 * `/:id/{approve,dispatch,receive}` endpoint list — a real 9-state
 * machine underneath (`TransferStateMachine`), every dispatch/receive
 * audited (the brief's own critical_rule). */
@ApiTags('admin/inventory/transfers')
@Controller('admin/inventory/transfers')
export class TransferController {
  constructor(private readonly transfers: TransferService) {}

  @Get()
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: TransferPageResponseDto })
  async list(@Query() query: ListTransfersQueryDto): Promise<TransferPageResponseDto> {
    const result = await this.transfers.list({
      status: query.status,
      sourceWarehouseId: query.sourceWarehouseId
        ? asWarehouseId(query.sourceWarehouseId)
        : undefined,
      destinationWarehouseId: query.destinationWarehouseId
        ? asWarehouseId(query.destinationWarehouseId)
        : undefined,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return TransferPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequirePermission('inventory.ledger.read')
  @ApiOkResponse({ type: TransferResponseDto })
  async get(@Param('id') id: string): Promise<TransferResponseDto> {
    const result = await this.transfers.get(id);
    return TransferResponseDto.fromDomain(result);
  }

  @Post()
  @RequirePermission('inventory.transfer.create')
  @ApiOkResponse({ type: TransferResponseDto })
  async create(
    @Body() dto: CreateTransferDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<TransferResponseDto> {
    const result = await this.transfers.create({
      sourceWarehouseId: dto.sourceWarehouseId,
      destinationWarehouseId: dto.destinationWarehouseId,
      items: dto.items,
      requestedBy: actorId,
    });
    return TransferResponseDto.fromDomain(result);
  }

  @Post(':id/approve')
  @RequirePermission('inventory.transfer.approve')
  @ApiOkResponse({ type: TransferResponseDto })
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveTransferDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<TransferResponseDto> {
    const result = await this.transfers.approve(id, actorId, dto.items);
    return TransferResponseDto.fromDomain(result);
  }

  @Post(':id/dispatch')
  @RequirePermission('inventory.transfer.dispatch')
  @ApiOkResponse({ type: TransferResponseDto })
  async dispatch(
    @Param('id') id: string,
    @Body() dto: DispatchTransferDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<TransferResponseDto> {
    const result = await this.transfers.dispatch(id, actorId, dto.items);
    return TransferResponseDto.fromDomain(result);
  }

  @Post(':id/receive')
  @RequirePermission('inventory.transfer.receive')
  @ApiOkResponse({ type: TransferResponseDto })
  async receive(
    @Param('id') id: string,
    @Body() dto: ReceiveTransferDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<TransferResponseDto> {
    const result = await this.transfers.receive(id, actorId, dto.items);
    return TransferResponseDto.fromDomain(result);
  }
}
