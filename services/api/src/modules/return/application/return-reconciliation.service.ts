import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import {
  REFUND_REPOSITORY,
  type RefundRepositoryPort,
} from '../../payment/domain/ports/refund.repository.port';
import {
  CREDIT_NOTE_REPOSITORY,
  type CreditNoteRepositoryPort,
} from '../domain/ports/credit-note.repository.port';
import {
  RETURN_SETTLEMENT_REPOSITORY,
  type ReturnSettlementRepositoryPort,
} from '../domain/ports/return-settlement.repository.port';
import {
  RETURN_REPOSITORY,
  type ReturnRepositoryPort,
} from '../domain/ports/return.repository.port';

import { ReturnSettlementService } from './return-settlement.service';

/** A settlement's own `updatedAt` older than this, combined with
 * `attempts >= MANUAL_REVIEW_ATTEMPT_THRESHOLD`, means enough real
 * retries have already failed that a further automatic one is not
 * "safe" — ADR-013 §9 pattern 7. */
const STUCK_THRESHOLD_MS = 30 * 60_000;
const MANUAL_REVIEW_ATTEMPT_THRESHOLD = 3;

/** Bounded per-status page — same "not an unfiltered scan" discipline
 * `return_settlement_sync`'s own `SWEEP_PAGE_LIMIT` already established. */
const SCAN_PAGE_LIMIT = 200;

export type ReconciliationPattern =
  | 'MISSING_SETTLEMENT'
  | 'RE_DRIVEN'
  | 'STUCK_ESCALATED_TO_MANUAL_REVIEW'
  | 'DUPLICATE_REFUND_DETECTED'
  | 'DUPLICATE_CREDIT_NOTE_DETECTED';

export interface ReconciliationFinding {
  returnRequestId: string;
  settlementId: string | null;
  pattern: ReconciliationPattern;
  detail?: string;
}

export interface ReconciliationReport {
  findings: ReconciliationFinding[];
  manualReviewCount: number;
}

/**
 * ADR-013 decision 9 — read-heavy, deterministic, idempotent by
 * construction: every repair below is one of the same already-idempotent
 * calls `ReturnSettlementService`'s own synchronous/recovery paths use.
 * Running `reconcileAll()` any number of times converges to the same end
 * state, never duplicates a side effect (proven under real repeated runs,
 * § Testing). Never guesses at a financial amount — every repair here is
 * either pure bookkeeping (creating a missing settlement row, escalating
 * a genuinely stuck one to `MANUAL_REVIEW`) or a call into an
 * already-amount-computed, already-validated code path.
 */
@Injectable()
export class ReturnReconciliationService {
  private readonly logger = new Logger(ReturnReconciliationService.name);

  constructor(
    @Inject(RETURN_REPOSITORY) private readonly returns: ReturnRepositoryPort,
    @Inject(RETURN_SETTLEMENT_REPOSITORY)
    private readonly settlements: ReturnSettlementRepositoryPort,
    @Inject(REFUND_REPOSITORY) private readonly refunds: RefundRepositoryPort,
    @Inject(CREDIT_NOTE_REPOSITORY) private readonly creditNotes: CreditNoteRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
    private readonly settlementService: ReturnSettlementService,
  ) {}

  async reconcileAll(actorUserId: string | null): Promise<ReconciliationReport> {
    const findings: ReconciliationFinding[] = [];

    await this.checkMissingSettlements(findings);
    await this.reDriveActiveSettlements(actorUserId, findings);
    await this.escalateStuckSettlements(actorUserId, findings);
    await this.checkDuplicates(findings);

    if (findings.length > 0) {
      await this.auditLog.record({
        actorId: actorUserId,
        action: 'RETURN_SETTLEMENT_RECONCILED',
        entityType: 'ReturnReconciliation',
        entityId: 'reconcile-all',
        newValue: { findings },
      });
    }
    this.logger.log(
      `return_settlement_reconciliation findings=${findings.length} ` +
        `patterns=${JSON.stringify(this.countByPattern(findings))}`,
    );

    const manualReviewCount = (await this.settlements.listManualReview()).length;
    return { findings, manualReviewCount };
  }

  /** Pattern 1 — a return that reached `APPROVED_FOR_REFUND` (or moved
   * further) but has no `ReturnSettlement` row at all. Structurally
   * unreachable going forward (`ReturnService.approveForRefund()` now
   * creates the row in the same call as the transition), kept as a
   * defense-in-depth backstop, not a load-bearing recovery path. */
  private async checkMissingSettlements(findings: ReconciliationFinding[]): Promise<void> {
    for (const status of ['APPROVED_FOR_REFUND', 'REFUNDED', 'COMPLETED'] as const) {
      const { items } = await this.returns.list({ status, limit: SCAN_PAGE_LIMIT });
      for (const request of items) {
        const existing = await this.settlements.findByReturnRequestId(request.id);
        if (existing) continue;
        await this.settlementService.ensureSettlement(request.id);
        findings.push({
          returnRequestId: request.id,
          settlementId: null,
          pattern: 'MISSING_SETTLEMENT',
          detail: `return status ${status} had no settlement row`,
        });
      }
    }
  }

  /** Patterns 3-6 — every settlement still `PENDING_RESTOCK`/
   * `REFUND_REQUESTED` gets re-driven through the exact same idempotent
   * methods the synchronous admin path and the recovery sweep both use.
   * A settlement already past the relevant step is a safe no-op call —
   * "repaired" here just means "made progress it hadn't made yet",
   * never a distinct repair code path. */
  private async reDriveActiveSettlements(
    actorUserId: string | null,
    findings: ReconciliationFinding[],
  ): Promise<void> {
    const active = await this.settlements.listActive();
    for (const settlement of active) {
      try {
        if (settlement.status === 'PENDING_RESTOCK') {
          const before = settlement.status;
          const after = await this.settlementService.beginRestock(
            settlement.returnRequestId,
            actorUserId,
          );
          if (after.status !== before) {
            findings.push({
              returnRequestId: settlement.returnRequestId,
              settlementId: settlement.id,
              pattern: 'RE_DRIVEN',
              detail: `${before} -> ${after.status}`,
            });
          }
        } else if (settlement.status === 'REFUND_REQUESTED') {
          const before = settlement.status;
          const after = await this.settlementService.requestSettlement(
            settlement.returnRequestId,
            actorUserId,
          );
          if (after.status !== before) {
            findings.push({
              returnRequestId: settlement.returnRequestId,
              settlementId: settlement.id,
              pattern: 'RE_DRIVEN',
              detail: `${before} -> ${after.status}`,
            });
          }
        }
        // RESTOCKED is a legitimate waiting-for-an-admin state, not
        // stuck — never re-driven here (there is nothing to drive it
        // toward on its own; only an explicit refund() call moves it).
      } catch (error) {
        // Same "one bad row never blocks the rest of the sweep"
        // discipline `return_settlement_sync`/`refund_status_sync`
        // already established — the settlement's own failure state
        // was already recorded inside beginRestock()/
        // requestSettlement() itself.
        this.logger.warn(
          `reconciliation_redrive_failed returnRequestId=${settlement.returnRequestId} error=${String(error)}`,
        );
      }
    }
  }

  /** Pattern 7 — a settlement that has already failed
   * `MANUAL_REVIEW_ATTEMPT_THRESHOLD` real attempts and is still stale
   * is not "safe" to keep auto-retrying; escalated once, idempotently
   * (a settlement already `MANUAL_REVIEW` is excluded by `listActive()`
   * itself, so this never re-fires on the same row). */
  private async escalateStuckSettlements(
    actorUserId: string | null,
    findings: ReconciliationFinding[],
  ): Promise<void> {
    const staleSince = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuck = await this.settlements.listActive(staleSince);
    for (const settlement of stuck) {
      if (settlement.attempts < MANUAL_REVIEW_ATTEMPT_THRESHOLD) continue;
      const result = await this.settlements.updateStatus(settlement.id, 'MANUAL_REVIEW', {
        lastError: settlement.lastError,
      });
      if (result.transitioned) {
        await this.auditLog.record({
          actorId: actorUserId,
          action: 'RETURN_SETTLEMENT_MANUAL_REVIEW',
          entityType: 'ReturnSettlement',
          entityId: settlement.id,
          newValue: { attempts: settlement.attempts, lastError: settlement.lastError },
        });
        findings.push({
          returnRequestId: settlement.returnRequestId,
          settlementId: settlement.id,
          pattern: 'STUCK_ESCALATED_TO_MANUAL_REVIEW',
          detail: `${settlement.attempts} attempts, stale since ${staleSince.toISOString()}`,
        });
      }
    }
  }

  /** Pattern 8 — by construction (the real `Refund.idempotencyKey`/
   * `CreditNote.returnRequestId` unique constraints), a duplicate
   * cannot exist. Checked anyway as a pure detection pass, scoped to
   * returns already `REFUNDED`/`COMPLETED` (the population where a
   * settlement artifact should exist) — never auto-repaired; a genuine
   * duplicate would mean a bug or a manual database intervention, never
   * something safe to silently collapse. */
  private async checkDuplicates(findings: ReconciliationFinding[]): Promise<void> {
    for (const status of ['REFUNDED', 'COMPLETED'] as const) {
      const { items } = await this.returns.list({ status, limit: SCAN_PAGE_LIMIT });
      for (const request of items) {
        if (request.resolution === 'REFUND') {
          const matches = await this.refunds.listByReturnRequestId(request.id);
          const real = matches.filter(
            (refund) => refund.status !== 'REJECTED' && refund.status !== 'FAILED',
          );
          if (real.length > 1) {
            findings.push({
              returnRequestId: request.id,
              settlementId: null,
              pattern: 'DUPLICATE_REFUND_DETECTED',
              detail: `${real.length} non-terminal-failed refunds found`,
            });
          }
        } else {
          const notes = await this.creditNotes.listByReturnRequestId(request.id);
          const real = notes.filter((note) => note.status !== 'VOID');
          if (real.length > 1) {
            findings.push({
              returnRequestId: request.id,
              settlementId: null,
              pattern: 'DUPLICATE_CREDIT_NOTE_DETECTED',
              detail: `${real.length} non-VOID credit notes found`,
            });
          }
        }
      }
    }
  }

  private countByPattern(findings: readonly ReconciliationFinding[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const finding of findings) {
      counts[finding.pattern] = (counts[finding.pattern] ?? 0) + 1;
    }
    return counts;
  }
}
