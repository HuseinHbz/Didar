import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

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
  type RefundRepositoryPort,
} from '../domain/ports/refund.repository.port';
import { RefundStateMachine } from '../domain/services/refund-state-machine';
import { RefundValidator } from '../domain/services/refund-validator';

/**
 * Foundation-only refunds against an immutable `VERIFIED`
 * `PaymentTransaction` (ADR-008 decision 6): `RefundValidator` guards the
 * amount before a `Refund` row ever exists, then `RefundStateMachine`'s
 * `PENDING -> PROCESSING -> {COMPLETED|FAILED|REJECTED}` drives the real
 * provider call. This class never restocks inventory or transitions an
 * `Order` — both are Phase 009+ concerns the ADR explicitly defers.
 */
@Injectable()
export class RefundService {
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
   * Phase 008 brief asking for one). Exactly one of the two filters must
   * be supplied; this never becomes an unfiltered "list every refund"
   * scan. */
  async list(filter: {
    paymentTransactionId?: string;
    returnRequestId?: string;
  }): Promise<Refund[]> {
    if (filter.returnRequestId) {
      return this.refunds.listByReturnRequestId(filter.returnRequestId);
    }
    if (filter.paymentTransactionId) {
      return this.refunds.listByTransactionId(filter.paymentTransactionId);
    }
    return [];
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
   * `paymentAttemptId`, never guessed. */
  async processRefund(refundId: string): Promise<Refund> {
    const refund = await this.refunds.findById(refundId);
    if (!refund) throw new NotFoundException('Refund not found');
    RefundStateMachine.assertTransition(refund.status, 'PROCESSING');
    await this.refunds.updateStatus(refund.id, 'PROCESSING');

    const transaction = await this.intents.findTransactionById(refund.paymentTransactionId);
    if (!transaction) throw new NotFoundException('Payment transaction not found');
    const intentDetail = await this.intents.findById(transaction.paymentIntentId);
    const attempt = intentDetail?.attempts.find((a) => a.id === transaction.paymentAttemptId);
    if (!attempt?.providerAuthority) {
      return this.refunds.updateStatus(refund.id, 'FAILED');
    }

    const provider = await this.providers.findById(transaction.providerId);
    if (!provider) throw new NotFoundException('Payment provider not found');
    const adapter = this.adapters.resolve(provider);

    const result = await adapter.refundPayment({
      providerReference: attempt.providerAuthority,
      amount: refund.amount,
      reason: refund.reason ?? undefined,
    });

    return this.refunds.updateStatus(refund.id, result.accepted ? 'COMPLETED' : 'REJECTED', {
      providerRefundReference: result.providerRefundReference,
    });
  }
}
