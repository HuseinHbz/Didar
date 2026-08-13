import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { ReconciliationService } from '../../application/reconciliation.service';
import {
  ReconciliationRecordResponseDto,
  ResolveReconciliationDto,
} from '../dto/reconciliation.dto';

/** Admin-only — reconciliation findings are never auto-corrected
 * (ADR-008 decision 7); resolving one is a real, permission-controlled
 * admin action, same discipline `RefundController` applies to refunds. */
@ApiTags('admin/payments/reconciliation')
@Controller('admin/payments/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Get()
  @RequirePermission('payment.reconciliation.read')
  @ApiOkResponse({ type: [ReconciliationRecordResponseDto] })
  async listUnresolved(): Promise<ReconciliationRecordResponseDto[]> {
    const records = await this.reconciliation.listUnresolved();
    return records.map((record) => ReconciliationRecordResponseDto.fromDomain(record));
  }

  /** Manual trigger — useful for support investigating one specific
   * transaction without waiting for the hourly sweep. */
  @Post('transactions/:paymentTransactionId/run')
  @RequirePermission('payment.reconciliation.read')
  @ApiOkResponse({ type: ReconciliationRecordResponseDto })
  async run(
    @Param('paymentTransactionId') paymentTransactionId: string,
  ): Promise<ReconciliationRecordResponseDto> {
    const record = await this.reconciliation.reconcileTransaction(paymentTransactionId);
    return ReconciliationRecordResponseDto.fromDomain(record);
  }

  @Post(':id/resolve')
  @RequirePermission('payment.reconciliation.resolve')
  @ApiOkResponse({ type: ReconciliationRecordResponseDto })
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveReconciliationDto,
  ): Promise<ReconciliationRecordResponseDto> {
    const record = await this.reconciliation.resolve(id, dto.resolutionNote);
    return ReconciliationRecordResponseDto.fromDomain(record);
  }
}
