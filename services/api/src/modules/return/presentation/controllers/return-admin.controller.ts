import { type UserId } from '@iecp/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { ReturnService } from '../../application/return.service';
import type { ReturnListFilter } from '../../domain/ports/return.repository.port';
import {
  InspectReturnDto,
  ReceiveReturnDto,
  RejectReturnDto,
  ReturnResponseDto,
} from '../dto/return.dto';

/** Admin/warehouse return lifecycle — every route permission-gated
 * (`@RequirePermission`), no ownership check (ADR-012 RBAC section:
 * `return.read`/`.approve`/`.reject`/`.receive`/`.inspect`/`.refund`).
 * Global `JwtAuthGuard`/`AuthorizationGuard` already cover
 * authentication, same as every other `admin/*` route in this
 * service. */
@ApiTags('admin/returns')
@Controller('admin/returns')
export class ReturnAdminController {
  constructor(private readonly returns: ReturnService) {}

  @Get()
  @RequirePermission('return.read')
  @ApiOkResponse({ type: [ReturnResponseDto] })
  async list(
    @Query('status') status?: ReturnListFilter['status'],
    @Query('orderId') orderId?: string,
    @Query('requestedFrom') requestedFrom?: string,
    @Query('requestedTo') requestedTo?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw), 1), 100) : 20;
    const { items, nextCursor } = await this.returns.listForAdmin({
      status,
      orderId,
      requestedFrom: requestedFrom ? new Date(requestedFrom) : undefined,
      requestedTo: requestedTo ? new Date(requestedTo) : undefined,
      limit,
      cursor,
    });
    const detailed = await Promise.all(items.map((item) => this.returns.getForAdmin(item.id)));
    return { items: detailed.map((item) => ReturnResponseDto.fromDomain(item)), nextCursor };
  }

  @Get(':id')
  @RequirePermission('return.read')
  @ApiOkResponse({ type: ReturnResponseDto })
  async get(@Param('id') id: string) {
    const detail = await this.returns.getForAdmin(id);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/approve')
  @RequirePermission('return.approve')
  @ApiOkResponse({ type: ReturnResponseDto })
  async approve(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    await this.returns.approve(id, actorId);
    const detail = await this.returns.getForAdmin(id);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/reject')
  @RequirePermission('return.reject')
  @ApiOkResponse({ type: ReturnResponseDto })
  async reject(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: RejectReturnDto,
  ) {
    await this.returns.reject(id, actorId, dto.reason);
    const detail = await this.returns.getForAdmin(id);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/receive')
  @RequirePermission('return.receive')
  @ApiOkResponse({ type: ReturnResponseDto })
  async receive(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: ReceiveReturnDto,
  ) {
    await this.returns.receive(id, actorId, dto.warehouseId, dto.locationId);
    const detail = await this.returns.getForAdmin(id);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/inspect')
  @RequirePermission('return.inspect')
  @ApiOkResponse({ type: ReturnResponseDto })
  async inspect(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: InspectReturnDto,
  ) {
    await this.returns.inspect(id, actorId, dto.items);
    const detail = await this.returns.getForAdmin(id);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/approve-refund')
  @RequirePermission('return.refund')
  @ApiOkResponse({ type: ReturnResponseDto })
  async approveForRefund(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    await this.returns.approveForRefund(id, actorId);
    const detail = await this.returns.getForAdmin(id);
    return ReturnResponseDto.fromDomain(detail);
  }

  @Post(':id/refund')
  @RequirePermission('return.refund')
  @ApiOkResponse({ type: ReturnResponseDto })
  async refund(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    await this.returns.refund(id, actorId);
    const detail = await this.returns.getForAdmin(id);
    return ReturnResponseDto.fromDomain(detail);
  }
}
