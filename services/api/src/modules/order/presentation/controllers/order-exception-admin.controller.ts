import { ORDER_EXCEPTION_STATUSES, type OrderExceptionStatus, type UserId } from '@iecp/types';
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { OrderExceptionService } from '../../application/order-exception.service';
import { OrderExceptionResponseDto } from '../dto/order-exception.dto';

/**
 * CP-031 — the operator work queue for paid orders that cannot proceed on
 * their own (today: no stock behind a payment). Permission-gated, no
 * ownership check — an admin/ops user acts on any order's exception. Two
 * distinct permissions, so a read-only auditor can watch the queue without
 * being able to act on it, and the warehouse-floor `fulfillment_clerk` has
 * neither.
 */
@ApiTags('admin/order-exceptions')
@Controller('admin/order-exceptions')
export class OrderExceptionAdminController {
  constructor(private readonly exceptions: OrderExceptionService) {}

  @Get()
  @RequirePermission('order.exception.read')
  @ApiOkResponse({ type: [OrderExceptionResponseDto] })
  async list(
    @Query('orderId') orderId?: string,
    @Query('status') status?: string,
    @Query('limit') limitRaw?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (
      status !== undefined &&
      !ORDER_EXCEPTION_STATUSES.includes(status as OrderExceptionStatus)
    ) {
      throw new BadRequestException(
        `status must be one of: ${ORDER_EXCEPTION_STATUSES.join(', ')}`,
      );
    }
    const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 20, 1), 100) : 20;
    const { items, nextCursor } = await this.exceptions.list({
      orderId,
      status: status as OrderExceptionStatus | undefined,
      limit,
      cursor,
    });
    return { items: items.map((item) => OrderExceptionResponseDto.fromDomain(item)), nextCursor };
  }

  @Get(':id')
  @RequirePermission('order.exception.read')
  @ApiOkResponse({ type: OrderExceptionResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return OrderExceptionResponseDto.fromDomain(await this.exceptions.get(id));
  }

  /** Tries again to take the line's stock out of the warehouse. 201 with the
   * resolved exception on success (also for an already-resolved one — a
   * harmless no-op); 409 while the stock is still short. */
  @Post(':id/retry-allocation')
  @RequirePermission('order.exception.resolve')
  @ApiOkResponse({ type: OrderExceptionResponseDto })
  async retryAllocation(@Param('id', ParseUUIDPipe) id: string, @CurrentUserId() actorId: UserId) {
    return OrderExceptionResponseDto.fromDomain(await this.exceptions.retryAllocation(id, actorId));
  }
}
