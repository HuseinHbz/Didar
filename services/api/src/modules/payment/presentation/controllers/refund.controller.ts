import { type UserId } from '@iecp/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { RefundService } from '../../application/refund.service';
import { CreateRefundDto, RefundResponseDto } from '../dto/refund.dto';

/** Admin-only — refunding a `VERIFIED` transaction is a privileged
 * action (ADR-008 decision 6), same "permission-controlled and audited"
 * discipline `AdjustmentController` established for inventory
 * adjustments (`requestedBy` here plays the same role `createdBy` does
 * there). */
@ApiTags('admin/payments/refunds')
@Controller('admin/payments/refunds')
export class RefundController {
  constructor(private readonly refunds: RefundService) {}

  /** ADR-012's own reconnaissance flagged this as a pre-existing gap
   * (no list route existed despite the original Phase 008 brief asking
   * for one) — closed here, additively, not reworking anything else on
   * this controller. */
  @Get()
  @RequirePermission('payment.refund.read')
  @ApiOkResponse({ type: [RefundResponseDto] })
  async list(
    @Query('paymentTransactionId') paymentTransactionId?: string,
    @Query('returnRequestId') returnRequestId?: string,
  ): Promise<RefundResponseDto[]> {
    const refunds = await this.refunds.list({ paymentTransactionId, returnRequestId });
    return refunds.map((refund) => RefundResponseDto.fromDomain(refund));
  }

  @Get(':id')
  @RequirePermission('payment.refund.read')
  @ApiOkResponse({ type: RefundResponseDto })
  async get(@Param('id') id: string): Promise<RefundResponseDto> {
    const refund = await this.refunds.get(id);
    return RefundResponseDto.fromDomain(refund);
  }

  @Post()
  @RequirePermission('payment.refund.create')
  @ApiOkResponse({ type: RefundResponseDto })
  async create(
    @Body() dto: CreateRefundDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<RefundResponseDto> {
    const refund = await this.refunds.requestRefund({
      paymentTransactionId: dto.paymentTransactionId,
      amount: BigInt(dto.amount),
      reason: dto.reason,
      requestedBy: actorId,
      idempotencyKey: dto.idempotencyKey,
    });
    return RefundResponseDto.fromDomain(refund);
  }

  @Post(':id/process')
  @RequirePermission('payment.refund.process')
  @ApiOkResponse({ type: RefundResponseDto })
  async process(@Param('id') id: string): Promise<RefundResponseDto> {
    const refund = await this.refunds.processRefund(id);
    return RefundResponseDto.fromDomain(refund);
  }
}
