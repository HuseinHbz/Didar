import type {
  PaymentAttemptStatus,
  PaymentIntentStatus,
  PaymentTransactionStatus,
} from '@iecp/types';

import type { PaymentAttempt } from '../entities/payment-attempt.entity';
import type { PaymentCallback } from '../entities/payment-callback.entity';
import type { PaymentIntent } from '../entities/payment-intent.entity';
import type { PaymentTransaction } from '../entities/payment-transaction.entity';

export const PAYMENT_INTENT_REPOSITORY = Symbol('PAYMENT_INTENT_REPOSITORY');

export interface PaymentIntentWithDetail {
  intent: PaymentIntent;
  attempts: PaymentAttempt[];
  transactions: PaymentTransaction[];
  callbacks: PaymentCallback[];
}

/**
 * `PaymentIntent` is the aggregate root for `PaymentAttempt`,
 * `PaymentTransaction`, and `PaymentCallback` — same "child entities with
 * no independent lifecycle" reasoning `CheckoutSessionRepositoryPort`
 * uses for its own children.
 */
export interface PaymentIntentRepositoryPort {
  findById(id: string): Promise<PaymentIntentWithDetail | null>;
  findByCheckoutSessionId(checkoutSessionId: string): Promise<PaymentIntent | null>;
  findByIdempotencyKey(key: string): Promise<PaymentIntent | null>;
  /** Every non-terminal intent whose `expiresAt` has already passed —
   * what this module's own expiration sweep processes. */
  listExpirable(now: Date): Promise<PaymentIntent[]>;

  /** Every intent still `AWAITING_PAYMENT`/`PROCESSING` whose latest
   * attempt was redirected before `olderThan` and never returned — what
   * the `payment_verification_retry` sweep re-checks with a real
   * `verifyPayment()` call, catching a callback the provider never
   * delivered or this service missed. */
  listAwaitingVerification(olderThan: Date): Promise<PaymentIntent[]>;

  /** Every `VERIFIED` transaction created since `since` — what the
   * `reconciliation` sweep compares against the provider's own record. */
  listVerifiedTransactionsSince(since: Date): Promise<PaymentTransaction[]>;

  /** Idempotent on `checkoutSessionId` (`@unique`, ADR-008 decisions 1/9)
   * — a retried "start payment for this checkout" resolves to the same
   * intent instead of creating a second one. Implementations must handle
   * the real-concurrency race the same way `PrismaCheckoutSessionRepository
   * .create()` does (catch `P2002`, re-read, return the winner's row) —
   * `prisma.upsert()` alone is not atomic under true concurrent duplicate
   * submissions on Postgres. */
  create(props: {
    checkoutSessionId: string;
    customerId?: string | null;
    guestToken?: string | null;
    providerId: string;
    amount: bigint;
    currency: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<PaymentIntent>;

  updateStatus(id: string, status: PaymentIntentStatus): Promise<PaymentIntent>;

  addAttempt(
    paymentIntentId: string,
    props: {
      attemptNumber: number;
      providerAuthority?: string | null;
      redirectUrl?: string | null;
    },
  ): Promise<PaymentAttempt>;

  updateAttemptStatus(
    id: string,
    status: PaymentAttemptStatus,
    extra?: { returnedAt?: Date },
  ): Promise<PaymentAttempt>;

  findAttemptByProviderAuthority(providerAuthority: string): Promise<PaymentAttempt | null>;

  /** Idempotent on `(providerId, providerReference)` — a duplicate
   * verified callback for the same reference resolves to the existing row
   * instead of creating a second one (ADR-008 decision 9). Same
   * P2002-catch-and-reread race-safety pattern as `create()` above. */
  createTransaction(props: {
    paymentIntentId: string;
    paymentAttemptId?: string | null;
    providerId: string;
    providerReference: string;
    amount: bigint;
    currency: string;
    status: PaymentTransactionStatus;
    verifiedAt?: Date | null;
    rawVerificationResponse?: Record<string, unknown> | null;
  }): Promise<PaymentTransaction>;

  findTransactionById(id: string): Promise<PaymentTransaction | null>;
  findTransactionByProviderReference(
    providerId: string,
    providerReference: string,
  ): Promise<PaymentTransaction | null>;

  /** Idempotent on `dedupeKey` (ADR-008 decision 4) — a redelivered
   * callback upserts the same row rather than re-triggering processing.
   * Returns the existing row (with `wasNew: false`) when the key already
   * exists, same shape as `CartRepositoryPort.addItem()`'s existing-row
   * consolidation. */
  recordCallback(props: {
    paymentIntentId?: string | null;
    providerId: string;
    dedupeKey: string;
    rawPayload: Record<string, unknown>;
    signatureValid: boolean;
  }): Promise<{ callback: PaymentCallback; wasNew: boolean }>;

  markCallbackProcessed(id: string, processedAt: Date): Promise<PaymentCallback>;
}
