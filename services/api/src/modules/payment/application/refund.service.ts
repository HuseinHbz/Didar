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

  /** `POST /payments/refunds` — admin-only (see this module's RBAC
   * permissions). Validates against the transaction's real remaining
   * balance before writing anything; a rejection here never reaches the
   * repository (`RefundStateMachine`'s own doc comment explains why
   * there is no `PENDING -> REJECTED` edge for this case). */
  async requestRefund(props: {
    paymentTransactionId: string;
    amount: bigint;
    reason?: string;
    requestedBy?: string;
    idempotencyKey: string;
  }): Promise<Refund> {
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

    return this.refunds.create({
      paymentTransactionId: props.paymentTransactionId,
      amount: props.amount,
      reason: props.reason,
      requestedBy: props.requestedBy,
      idempotencyKey: props.idempotencyKey,
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
