import { randomUUID } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { CheckoutActor } from '../../cart-checkout/application/checkout.service';
import { CheckoutService } from '../../cart-checkout/application/checkout.service';
import type { PaymentAttempt } from '../domain/entities/payment-attempt.entity';
import type { PaymentIntent } from '../domain/entities/payment-intent.entity';
import {
  PAYMENT_INTENT_REPOSITORY,
  type PaymentIntentRepositoryPort,
  type PaymentIntentWithDetail,
} from '../domain/ports/payment-intent.repository.port';
import {
  PAYMENT_PROVIDER_ADAPTER_REGISTRY,
  type PaymentProviderAdapterRegistry,
} from '../domain/ports/payment-provider-adapter.port';
import {
  PAYMENT_PROVIDER_REPOSITORY,
  type PaymentProviderRepositoryPort,
} from '../domain/ports/payment-provider.repository.port';
import { PaymentAttemptStateMachine } from '../domain/services/payment-attempt-state-machine';
import {
  InvalidPaymentIntentTransitionError,
  PaymentIntentStateMachine,
} from '../domain/services/payment-intent-state-machine';
import { VerificationMatcher } from '../domain/services/verification-matcher';

const DEFAULT_INTENT_TTL_MINUTES = 30;

export interface StartPaymentResult {
  intent: PaymentIntent;
  attempt: PaymentAttempt;
  redirectUrl: string;
}

/**
 * `CheckoutSession(READY_FOR_PAYMENT) -> PaymentIntent -> PaymentAttempt
 * -> (redirect) -> callback -> verifyPayment() -> PaymentTransaction ->
 * CheckoutSession(CONVERTED)` — the full ADR-008 flow. Every amount this
 * class writes to a `PaymentIntent` comes from the checkout session's own
 * frozen `grandTotal`, never a client-supplied value; every
 * `PaymentTransaction` this class writes comes from a real
 * `verifyPayment()` response matched against that same frozen amount
 * (ADR-008 decision 3) — never inferred from a redirect return.
 */
@Injectable()
export class PaymentIntentService {
  constructor(
    @Inject(PAYMENT_INTENT_REPOSITORY) private readonly intents: PaymentIntentRepositoryPort,
    @Inject(PAYMENT_PROVIDER_REPOSITORY) private readonly providers: PaymentProviderRepositoryPort,
    @Inject(PAYMENT_PROVIDER_ADAPTER_REGISTRY)
    private readonly adapters: PaymentProviderAdapterRegistry,
    private readonly checkout: CheckoutService,
  ) {}

  async get(paymentIntentId: string, actor: CheckoutActor): Promise<PaymentIntentWithDetail> {
    const detail = await this.intents.findById(paymentIntentId);
    if (!detail) throw new NotFoundException('Payment intent not found');
    this.assertOwnership(detail.intent, actor);
    return detail;
  }

  /** Same IDOR-protection shape as `CheckoutService.assertOwnership`. */
  private assertOwnership(intent: PaymentIntent, actor: CheckoutActor): void {
    if (intent.customerId) {
      if (intent.customerId !== actor.customerId) {
        throw new ForbiddenException('This payment intent does not belong to the current customer');
      }
      return;
    }
    if (intent.guestToken && intent.guestToken !== actor.guestToken) {
      throw new ForbiddenException(
        'This payment intent does not belong to the current guest session',
      );
    }
  }

  /**
   * `POST /payments/intents` — idempotent on `checkoutSessionId` (ADR-008
   * decisions 1/9): a retried call for the same checkout resolves to the
   * same intent, never a duplicate. Requires the checkout session to
   * already be `READY_FOR_PAYMENT` — `amount`/`currency` are read from
   * its frozen totals, never accepted from the caller.
   */
  async createIntent(
    checkoutSessionId: string,
    providerCode: string,
    actor: CheckoutActor,
    options: { idempotencyKey?: string } = {},
  ): Promise<PaymentIntent> {
    const checkoutDetail = await this.checkout.get(checkoutSessionId, actor);
    if (checkoutDetail.session.status !== 'READY_FOR_PAYMENT') {
      throw new ForbiddenException(
        'Checkout session must be READY_FOR_PAYMENT before a payment intent can be created',
      );
    }

    const provider = await this.providers.findByCode(providerCode);
    if (!provider?.isActive) {
      throw new NotFoundException(`No active payment provider for code "${providerCode}"`);
    }

    const existing = await this.intents.findByCheckoutSessionId(checkoutSessionId);
    if (existing) return existing;

    return this.intents.create({
      checkoutSessionId,
      customerId: checkoutDetail.session.customerId,
      guestToken: checkoutDetail.session.guestToken,
      providerId: provider.id,
      amount: checkoutDetail.session.grandTotal,
      currency: checkoutDetail.session.currency,
      idempotencyKey: options.idempotencyKey ?? randomUUID(),
      expiresAt: new Date(Date.now() + DEFAULT_INTENT_TTL_MINUTES * 60_000),
    });
  }

  /**
   * `POST /payments/intents/:id/start` — opens a new `PaymentAttempt`
   * against the real provider adapter and returns the redirect URL.
   * Legal from `CREATED` (first attempt) or `FAILED` (a retry — the
   * `FAILED -> AWAITING_PAYMENT` edge `PaymentIntentStateMachine` allows
   * specifically for this). Never legal from `SUCCEEDED`/`EXPIRED`/
   * `CANCELLED` — the state machine itself rejects those.
   */
  async startPayment(
    paymentIntentId: string,
    actor: CheckoutActor,
    callbackUrl: string,
  ): Promise<StartPaymentResult> {
    const detail = await this.get(paymentIntentId, actor);
    if (detail.intent.status !== 'CREATED' && detail.intent.status !== 'FAILED') {
      throw new InvalidPaymentIntentTransitionError(detail.intent.status, 'AWAITING_PAYMENT');
    }
    PaymentIntentStateMachine.assertTransition(detail.intent.status, 'AWAITING_PAYMENT');

    const provider = await this.providers.findById(detail.intent.providerId);
    if (!provider) throw new NotFoundException('Payment provider not found');
    const adapter = this.adapters.resolve(provider);

    const providerIntent = await adapter.createPaymentIntent({
      amount: detail.intent.amount,
      currency: detail.intent.currency,
      description: `Order payment for checkout ${detail.intent.checkoutSessionId}`,
      callbackUrl,
    });

    const attempt = await this.intents.addAttempt(detail.intent.id, {
      attemptNumber: detail.attempts.length + 1,
      providerAuthority: providerIntent.providerAuthority,
      redirectUrl: providerIntent.redirectUrl,
    });
    const redirectedAttempt = await this.intents.updateAttemptStatus(attempt.id, 'REDIRECTED');
    const intent = await this.intents.updateStatus(detail.intent.id, 'AWAITING_PAYMENT');

    return { intent, attempt: redirectedAttempt, redirectUrl: providerIntent.redirectUrl };
  }

  /**
   * `POST /payments/callback/:providerCode` — the redirect return. Never
   * itself proof of anything (ADR-008 decision 3): records the raw
   * callback (append-only, dedupe-keyed — ADR-008 decision 4), marks the
   * matching attempt `RETURNED`, and always re-derives the real outcome
   * through `verifyPayment()` below. A redelivered callback (`wasNew:
   * false`) is acknowledged without re-triggering verification —
   * `verifyPayment()` on an already-`SUCCEEDED`/`FAILED` intent is itself
   * a no-op read, so even a genuine race here can't double-process.
   */
  async handleCallback(
    providerCode: string,
    rawPayload: Record<string, unknown>,
  ): Promise<PaymentIntent | null> {
    const provider = await this.providers.findByCode(providerCode);
    if (!provider) throw new NotFoundException(`Unknown payment provider "${providerCode}"`);
    const adapter = this.adapters.resolve(provider);
    const parsed = adapter.parseCallback(rawPayload);

    const attempt = parsed.providerAuthority
      ? await this.intents.findAttemptByProviderAuthority(parsed.providerAuthority)
      : null;

    const { wasNew } = await this.intents.recordCallback({
      paymentIntentId: attempt?.paymentIntentId ?? null,
      providerId: provider.id,
      dedupeKey: parsed.dedupeKey,
      rawPayload,
      signatureValid: parsed.providerAuthority !== null,
    });

    if (!attempt) return null;
    if (PaymentAttemptStateMachine.canTransition(attempt.status, 'RETURNED')) {
      await this.intents.updateAttemptStatus(attempt.id, 'RETURNED', { returnedAt: new Date() });
    }
    if (!wasNew) {
      const current = await this.intents.findById(attempt.paymentIntentId);
      return current?.intent ?? null;
    }

    return this.verifyPayment(attempt.paymentIntentId);
  }

  /**
   * The only method allowed to produce a `PaymentTransaction` (ADR-008
   * decision 3) — a real server-to-server call, matched against the
   * intent's own frozen `amount`/`currency` via `VerificationMatcher`,
   * never the callback's claimed amount. Idempotent: an intent already
   * `SUCCEEDED`/`FAILED` is returned unchanged rather than re-verified.
   */
  async verifyPayment(paymentIntentId: string): Promise<PaymentIntent> {
    const detail = await this.intents.findById(paymentIntentId);
    if (!detail) throw new NotFoundException('Payment intent not found');
    if (detail.intent.isTerminal) return detail.intent;

    const latestAttempt = detail.attempts.at(-1);
    if (!latestAttempt?.providerAuthority) {
      throw new ForbiddenException('Payment intent has no attempt to verify');
    }

    if (PaymentIntentStateMachine.canTransition(detail.intent.status, 'PROCESSING')) {
      await this.intents.updateStatus(detail.intent.id, 'PROCESSING');
    }

    const provider = await this.providers.findById(detail.intent.providerId);
    if (!provider) throw new NotFoundException('Payment provider not found');
    const adapter = this.adapters.resolve(provider);

    const result = await adapter.verifyPayment({
      providerAuthority: latestAttempt.providerAuthority,
      amount: detail.intent.amount,
      currency: detail.intent.currency,
    });
    const outcome = VerificationMatcher.evaluate(
      { amount: detail.intent.amount, currency: detail.intent.currency },
      result,
    );

    if (result.providerReference) {
      await this.intents.createTransaction({
        paymentIntentId: detail.intent.id,
        paymentAttemptId: latestAttempt.id,
        providerId: provider.id,
        providerReference: result.providerReference,
        amount: BigInt(result.amount),
        currency: result.currency,
        status: outcome.matched ? 'VERIFIED' : 'FAILED',
        verifiedAt: outcome.matched ? new Date() : null,
        rawVerificationResponse: result.raw,
      });
    }

    const intent = await this.intents.updateStatus(
      detail.intent.id,
      outcome.matched ? 'SUCCEEDED' : 'FAILED',
    );
    if (outcome.matched) {
      await this.checkout.markConverted(detail.intent.checkoutSessionId);
    }
    return intent;
  }

  /** Consumer side of the `payment_verification_retry` sweep's
   * verification-retry half — every intent whose latest attempt was
   * redirected before `olderThan` and never returned. Never invoked by
   * an HTTP controller. */
  async listAwaitingVerification(olderThan: Date): Promise<PaymentIntent[]> {
    return this.intents.listAwaitingVerification(olderThan);
  }

  /** Consumer side of the `payment_verification_retry` sweep's
   * expiration half — never invoked by an HTTP controller. Same "expire
   * whatever is eligible, skip whatever the state machine says is no
   * longer legal to expire" shape as `CheckoutService.expire()`'s sweep
   * counterpart. */
  async expireIntents(now: Date): Promise<number> {
    const expirable = await this.intents.listExpirable(now);
    let expiredCount = 0;
    for (const intent of expirable) {
      if (PaymentIntentStateMachine.canTransition(intent.status, 'EXPIRED')) {
        await this.intents.updateStatus(intent.id, 'EXPIRED');
        expiredCount += 1;
      }
    }
    return expiredCount;
  }
}
