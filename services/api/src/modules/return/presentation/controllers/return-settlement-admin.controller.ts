import { type UserId } from '@iecp/types';
import { Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { ReturnReconciliationService } from '../../application/return-reconciliation.service';
import { ReturnSettlementService } from '../../application/return-settlement.service';
import {
  ReconciliationReportResponseDto,
  ReturnSettlementResponseDto,
} from '../dto/return-settlement.dto';

/**
 * ADR-013 RBAC section — the minimum settlement/reconciliation admin
 * surface: three permissions (`return.settlement.read`/`.retry`/
 * `.reconcile`), no `.manual_review` permission (a `MANUAL_REVIEW`
 * settlement is resumed by the same `retry` action — see
 * `ReturnSettlementService.retry()`'s own doc comment). Every route
 * here is internal/worker-facing (attempts, lastError, job metadata) —
 * never exposed on a customer route, and never returns another
 * customer's data (settlement rows carry no customer-identifying
 * fields of their own beyond `returnRequestId`, already admin-only).
 *
 * No "force complete" route exists here, ever (absolute rule) — every
 * mutation below is either a real state-machine transition (real 409
 * on an illegal one) or a call into the same idempotent method the
 * synchronous path/sweeps already use.
 */
@ApiTags('admin/returns/settlements')
@Controller('admin/returns')
export class ReturnSettlementAdminController {
  constructor(
    private readonly settlements: ReturnSettlementService,
    private readonly reconciliation: ReturnReconciliationService,
  ) {}

  /** `GET /admin/returns/settlements?status=MANUAL_REVIEW` — the two
   * operationally useful views: everything still in flight (default),
   * or everything flagged for human attention. Not a generic
   * by-any-status list (nothing needs one — `COMPLETED`/
   * `FAILED_TERMINAL` settlements are reachable individually via
   * `GET .../:id/settlement`, not usefully browsed in bulk here). */
  @Get('settlements')
  @RequirePermission('return.settlement.read')
  @ApiOkResponse({ type: [ReturnSettlementResponseDto] })
  async list(@Query('status') status?: string) {
    const settlements =
      status === 'MANUAL_REVIEW'
        ? await this.settlements.listManualReview()
        : await this.settlements.listActive();
    return settlements.map((settlement) => ReturnSettlementResponseDto.fromDomain(settlement));
  }

  @Get(':id/settlement')
  @RequirePermission('return.settlement.read')
  @ApiOkResponse({ type: ReturnSettlementResponseDto })
  async get(@Param('id') id: string) {
    const settlement = await this.settlements.getForAdmin(id);
    return ReturnSettlementResponseDto.fromDomain(settlement);
  }

  @Post(':id/settlement/retry')
  @RequirePermission('return.settlement.retry')
  @ApiOkResponse({ type: ReturnSettlementResponseDto })
  async retry(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    const settlement = await this.settlements.retry(id, actorId);
    return ReturnSettlementResponseDto.fromDomain(settlement);
  }

  /** Runs the same global, idempotent `reconcileAll()` engine every
   * scheduled sweep tick runs (cheap and read-heavy — see
   * `ReturnReconciliationService`'s own doc comment), then returns only
   * the findings relevant to this return. `manualReviewCount` on the
   * response is the whole system's count, not just this return's — it
   * is genuinely global context, not scoped data leaking across
   * returns. 404s first if the return itself does not exist, so a
   * fabricated id cannot be used to probe whether reconciliation "did
   * something" globally. */
  @Post(':id/reconcile')
  @RequirePermission('return.settlement.reconcile')
  @ApiOkResponse({ type: ReconciliationReportResponseDto })
  async reconcile(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    const settlement = await this.settlements.get(id);
    if (!settlement) throw new NotFoundException('No settlement exists for this return');

    const report = await this.reconciliation.reconcileAll(actorId);
    const scoped = {
      findings: report.findings.filter((finding) => finding.returnRequestId === id),
      manualReviewCount: report.manualReviewCount,
    };
    return ReconciliationReportResponseDto.fromDomain(scoped);
  }
}
