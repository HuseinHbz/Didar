import type { RefundStatus } from '@iecp/types';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import type { Refund } from '../domain/entities/refund.entity';
import {
  PAYMENT_INTENT_REPOSITORY,
  type PaymentIntentRepositoryPort,
} from '../domain/ports/payment-intent.repository.port';
import {
  PAYMENT_PROVIDER_ADAPTER_REGISTRY,
  type PaymentProviderAdapterRegistry,
} from '../domain/ports/payment-provider-adapter.port';
import {
  PAYMENT_PROVIDER_REPOSITORY,
  type PaymentProviderRepositoryPort,
} from '../domain/ports/payment-provider.repository.port';
import {
  REFUND_REPOSITORY,
  type RefundOutcome,
  type RefundRepositoryPort,
} from '../domain/ports/refund.repository.port';
import { RefundCapabilityPolicy } from '../domain/services/refund-capability-policy';
import {
  RefundAlreadyProcessingError,
  RefundStateMachine,
} from '../domain/services/refund-state-machine';
import { RefundValidator } from '../domain/services/refund-validator';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
const MAX_FAILURE_REASON_LENGTH = 300;

/**
 * Foundation-only refunds against an immutable `VERIFIED`
 * `PaymentTransaction` (ADR-008 decision 6): `RefundValidator` guards the
 * amount before a `Refund` row ever exists, then `RefundStateMachine`'s
 * `PENDING -> PROCESSING -> {COMPLETED|FAILED|REJECTED}` drives the real
 * provider call. This class never restocks inventory or transitions an
 * `Order` — both are Phase 009+ concerns the ADR explicitly defers.
 *
 * CP-031 (gap P0-6) added two guarantees to the send step: a refund is only
 * ever sent if the gateway can express it (`RefundCapabilityPolicy`), and a
 * refund is sent by exactly one caller, once (`claimForProcessing`).
 */
@Injectable()
export class RefundService {
  private readonly logger = new Logger(RefundService.name);

  constructor(
    @Inject(REFUND_REPOSITORY) private readonly refunds: RefundRepositoryPort,
    @Inject(PAYMENT_INTENT_REPOSITORY) private readonly intents: PaymentIntentRepositoryPort,
    @Inject(PAYMENT_PROVIDER_REPOSITORY) private readonly providers: PaymentProviderRepositoryPort,
    @Inject(PAYMENT_PROVIDER_ADAPTER_REGISTRY)
    private readonly adapters: PaymentProviderAdapterRegistry,
  ) {}

  async get(refundId: string): Promise<Refund> {
    const refund = await this.refunds.findById(refundId);
    if (!refund) throw new NotFoundException('Refund not found');
    return refund;
  }

  /** `GET /admin/payments/refunds` — closes a gap ADR-012's own
   * reconnaissance flagged (no list route existed despite the original
   * Phase 008 brief asking for one). At least one filter must be supplied; this
   * never becomes an unfiltered "list every refund" scan, and the result is
   * always bounded.
   *
   * CP-031 added the `status` filter and the bound: finance's work queue for
   * refunds the system could not settle by itself is
   * `?status=REJECTED` (see `failureReason` on each row). */
  async list(filter: {
    paymentTransactionId?: string;
    returnRequestId?: string;
    status?: RefundStatus;
    limit?: number;
  }): Promise<Refund[]> {
    if (!filter.paymentTransactionId && !filter.returnRequestId && !filter.status) return [];
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
    return this.refunds.search(
      {
        paymentTransactionId: filter.paymentTransactionId,
        returnRequestId: filter.returnRequestId,
        status: filter.status,
      },
      limit,
    );
  }

  /** `POST /payments/refunds` — admin-only (see this module's RBAC
   * permissions). Validates against the transaction's real remaining
   * balance before writing anything; a rejection here never reaches the
   * repository (`RefundStateMachine`'s own doc comment explains why
   * there is no `PENDING -> REJECTED` edge for this case).
   *
   * `returnRequestId`/`lines`, added by ADR-012 decision 8, are both
   * optional and additive — `OrderService.cancel()`/
   * `.requestPartialRefund()` omit them and get an identical
   * direct/order-level refund to before. `ReturnService.refund()` is the
   * only caller that supplies them; this method still only ever
   * validates via `RefundValidator` and creates one row through the same
   * `RefundRepositoryPort.create()` path — no second refund pathway.
   *
   * ADR-013 — checks `idempotencyKey` *before* `RefundValidator`, not
   * only inside `create()`'s own P2002-catch-reread: a call that is
   * genuinely a duplicate of one that already completed must short-
   * circuit to the existing row without ever re-running
   * `assertRefundable()` against the *post*-refund balance — otherwise
   * the same idempotent retry looks, to the validator, like a second,
   * real refund stacked on top of the first one it already created, and
   * gets rejected as "would exceed the transaction amount". Found via
   * this phase's own 20-concurrent-`requestSettlement()` proof: `create()`'s
   * own idempotency guard is necessary but not sufficient when a
   * pre-flight balance check runs ahead of it. */
  async requestRefund(props: {
    paymentTransactionId: string;
    amount: bigint;
    reason?: string;
    requestedBy?: string;
    idempotencyKey: string;
    returnRequestId?: string | null;
    lines?: readonly { returnItemId: string; amount: bigint }[];
  }): Promise<Refund> {
    const existing = await this.refunds.findByIdempotencyKey(props.idempotencyKey);
    if (existing) return existing;

    try {
      const transaction = await this.intents.findTransactionById(props.paymentTransactionId);
      if (!transaction) throw new NotFoundException('Payment transaction not found');
      if (!transaction.isVerified) {
        throw new ForbiddenException('Only a VERIFIED payment transaction can be refunded');
      }

      const priorRefunds = await this.refunds.listByTransactionId(props.paymentTransactionId);
      RefundValidator.assertRefundable(
        props.amount,
        transaction.amount,
        priorRefunds.map((refund) => ({
          amount: refund.amount,
          countsAgainstBalance: refund.countsAgainstBalance,
        })),
      );
    } catch (error) {
      // The check above and this validation are two separate reads —
      // a concurrent caller with the *same* idempotencyKey can commit
      // its own real refund in the narrow window between them, making
      // `assertRefundable()` see that already-completed refund as
      // *additional* balance being consumed and reject this call. Give
      // the idempotency key the final word before surfacing any error:
      // if the winner has committed by now, this is a duplicate
      // delivery converging on the same row, not a real failure.
      const raced = await this.refunds.findByIdempotencyKey(props.idempotencyKey);
      if (raced) return raced;
      throw error;
    }

    return this.refunds.create({
      paymentTransactionId: props.paymentTransactionId,
      amount: props.amount,
      reason: props.reason,
      requestedBy: props.requestedBy,
      idempotencyKey: props.idempotencyKey,
      returnRequestId: props.returnRequestId,
      lines: props.lines,
    });
  }

  /** `POST /payments/refunds/:id/process` — submits the refund to the
   * real provider adapter. ZarinPal's reversal is keyed on the original
   * `Authority`, not the transaction's `RefID` (see `ZarinpalAdapter`'s
   * own doc comment) — resolved here via the transaction's
   * `paymentAttemptId`, never guessed.
   *
   * CP-031 (gap P0-6) — two guarantees before and around the send:
   *
   * 1. **Exactly one sender.** The refund is claimed `PENDING -> PROCESSING` by a
   *    single conditional UPDATE; every other caller (an admin double-click, the
   *    `refund_status_sync` sweep overlapping an admin request) gets
   *    `RefundAlreadyProcessingError` and sends nothing. The old
   *    read-check-then-write let two concurrent callers both reach the gateway,
   *    and the loser's answer (typically "already reversed") then overwrote a
   *    `COMPLETED` refund with `REJECTED`, freeing its balance after the money had
   *    left. Results are likewise written only from `PROCESSING`.
   * 2. **Only what the gateway can express.** After the claim,
   *    `RefundCapabilityPolicy` compares the amount with the gateway's declared
   *    capabilities; a partial refund to a whole-transaction-only gateway ends
   *    `REJECTED` with a `failureReason` and is **never sent**, so finance can
   *    settle it by hand against an accurate ledger.
   *
   * Everything the send needs (transaction, provider, adapter) is resolved
   * *before* the claim: a missing row is a configuration fault that must leave the
   * refund `PENDING` and retryable, not strand it in `PROCESSING`. */
  async processRefund(refundId: string): Promise<Refund> {
    const refund = await this.refunds.findById(refundId);
    if (!refund) throw new NotFoundException('Refund not found');
    if (refund.status === 'PROCESSING') {
      throw new RefundAlreadyProcessingError(refund.id, refund.status);
    }
    RefundStateMachine.assertTransition(refund.status, 'PROCESSING');

    const transaction = await this.intents.findTransactionById(refund.paymentTransactionId);
    if (!transaction) throw new NotFoundException('Payment transaction not found');
    const provider = await this.providers.findById(transaction.providerId);
    if (!provider) throw new NotFoundException('Payment provider not found');
    const adapter = this.adapters.resolve(provider);

    if (!(await this.refunds.claimForProcessing(refund.id))) {
      const current = await this.refunds.findById(refund.id);
      throw new RefundAlreadyProcessingError(refund.id, current?.status ?? 'UNKNOWN');
    }

    const decision = RefundCapabilityPolicy.evaluate({
      refundAmount: refund.amount,
      transactionAmount: transaction.amount,
      capabilities: adapter.capabilities,
    });
    if (!decision.allowed) {
      this.logger.warn(
        `refund_not_sent refundId=${refund.id} provider=${adapter.providerCode} reason="${decision.reason}"`,
      );
      return this.conclude(refund.id, { status: 'REJECTED', failureReason: decision.reason });
    }

    const intentDetail = await this.intents.findById(transaction.paymentIntentId);
    const attempt = intentDetail?.attempts.find((a) => a.id === transaction.paymentAttemptId);
    if (!attempt?.providerAuthority) {
      return this.conclude(refund.id, {
        status: 'FAILED',
        failureReason:
          'No provider authority is recorded for the payment attempt this transaction settled, ' +
          'so the refund cannot be sent.',
      });
    }

    const result = await adapter.refundPayment({
      providerReference: attempt.providerAuthority,
      amount: refund.amount,
      reason: refund.reason ?? undefined,
    });

    return this.conclude(
      refund.id,
      result.accepted
        ? { status: 'COMPLETED', providerRefundReference: result.providerRefundReference }
        : {
            status: 'REJECTED',
            providerRefundReference: result.providerRefundReference,
            failureReason: RefundService.describeDecline(result.raw),
          },
    );
  }

  /** Writes the outcome of a refund this caller holds in `PROCESSING`. The write
   * is conditional on `PROCESSING`; if it matches nothing, something moved the
   * row while this caller owned it — that must be loud, never reported as
   * success. */
  private async conclude(refundId: string, outcome: RefundOutcome): Promise<Refund> {
    const settled = await this.refunds.settleProcessing(refundId, outcome);
    if (!settled) {
      this.logger.error(
        `refund_outcome_not_recorded refundId=${refundId} outcome=${outcome.status}`,
      );
      throw new ConflictException(
        `Refund ${refundId} was no longer PROCESSING when its outcome (${outcome.status}) was recorded`,
      );
    }
    return settled;
  }

  /** A human-readable reason for a provider decline, from whatever the adapter
   * put in `raw` — a short string only, never the raw payload. */
  private static describeDecline(raw: Record<string, unknown>): string {
    const detail =
      typeof raw['message'] === 'string'
        ? raw['message']
        : typeof raw['error'] === 'string'
          ? raw['error']
          : null;
    const text = detail
      ? `The payment provider declined the refund: ${detail}`
      : 'The payment provider declined the refund.';
    return text.length > MAX_FAILURE_REASON_LENGTH
      ? `${text.slice(0, MAX_FAILURE_REASON_LENGTH - 1)}…`
      : text;
  }
}
