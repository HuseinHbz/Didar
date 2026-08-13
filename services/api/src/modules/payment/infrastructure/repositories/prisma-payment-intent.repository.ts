import { randomUUID } from 'node:crypto';

import { Prisma, prisma } from '@iecp/database';
import type {
  PaymentAttemptStatus,
  PaymentIntentStatus,
  PaymentTransactionStatus,
} from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { PaymentAttempt } from '../../domain/entities/payment-attempt.entity';
import type { PaymentCallback } from '../../domain/entities/payment-callback.entity';
import type { PaymentIntent } from '../../domain/entities/payment-intent.entity';
import type { PaymentTransaction } from '../../domain/entities/payment-transaction.entity';
import type {
  PaymentIntentRepositoryPort,
  PaymentIntentWithDetail,
} from '../../domain/ports/payment-intent.repository.port';
import {
  paymentAttemptToDomain,
  paymentCallbackToDomain,
  paymentIntentToDomain,
  paymentTransactionToDomain,
} from '../payment.mapper';

function isUniqueViolationOn(error: unknown, column: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    (error.meta?.['target'] as string[] | undefined)?.includes(column) === true
  );
}

@Injectable()
export class PrismaPaymentIntentRepository implements PaymentIntentRepositoryPort {
  async findById(id: string): Promise<PaymentIntentWithDetail | null> {
    const row = await prisma.paymentIntent.findUnique({
      where: { id },
      include: { attempts: true, transactions: true, callbacks: true },
    });
    if (!row) return null;
    return {
      intent: paymentIntentToDomain(row),
      attempts: row.attempts.map(paymentAttemptToDomain),
      transactions: row.transactions.map(paymentTransactionToDomain),
      callbacks: row.callbacks.map(paymentCallbackToDomain),
    };
  }

  async findByCheckoutSessionId(checkoutSessionId: string): Promise<PaymentIntent | null> {
    const row = await prisma.paymentIntent.findUnique({ where: { checkoutSessionId } });
    return row ? paymentIntentToDomain(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<PaymentIntent | null> {
    const row = await prisma.paymentIntent.findUnique({ where: { idempotencyKey: key } });
    return row ? paymentIntentToDomain(row) : null;
  }

  async listExpirable(now: Date): Promise<PaymentIntent[]> {
    const rows = await prisma.paymentIntent.findMany({
      where: {
        status: { in: ['CREATED', 'AWAITING_PAYMENT', 'PROCESSING'] },
        expiresAt: { lt: now },
      },
    });
    return rows.map(paymentIntentToDomain);
  }

  async listAwaitingVerification(olderThan: Date): Promise<PaymentIntent[]> {
    const rows = await prisma.paymentIntent.findMany({
      where: {
        status: { in: ['AWAITING_PAYMENT', 'PROCESSING'] },
        attempts: { some: { status: 'REDIRECTED', startedAt: { lt: olderThan } } },
      },
    });
    return rows.map(paymentIntentToDomain);
  }

  async listVerifiedTransactionsSince(since: Date): Promise<PaymentTransaction[]> {
    const rows = await prisma.paymentTransaction.findMany({
      where: { status: 'VERIFIED', createdAt: { gte: since } },
    });
    return rows.map(paymentTransactionToDomain);
  }

  /**
   * Idempotent on `checkoutSessionId` under real concurrency, not just
   * sequential retries — same `P2002`-catch-and-reread race-safety
   * pattern `PrismaCheckoutSessionRepository.create()` established and
   * this port's own doc comment reuses directly (ADR-008 decision 9).
   * `idempotencyKey` is also unique; a collision there (a client reusing
   * an idempotency key across two different checkout sessions — a client
   * bug, not a legitimate race) is re-read by that key instead.
   */
  async create(props: {
    checkoutSessionId: string;
    customerId?: string | null;
    guestToken?: string | null;
    providerId: string;
    amount: bigint;
    currency: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<PaymentIntent> {
    try {
      const row = await prisma.paymentIntent.upsert({
        where: { checkoutSessionId: props.checkoutSessionId },
        create: {
          id: randomUUID(),
          checkoutSessionId: props.checkoutSessionId,
          customerId: props.customerId ?? null,
          guestToken: props.guestToken ?? null,
          providerId: props.providerId,
          amount: props.amount,
          currency: props.currency,
          idempotencyKey: props.idempotencyKey,
          expiresAt: props.expiresAt ?? null,
          metadata: (props.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        update: {},
      });
      return paymentIntentToDomain(row);
    } catch (error) {
      if (isUniqueViolationOn(error, 'checkout_session_id')) {
        const existing = await prisma.paymentIntent.findUnique({
          where: { checkoutSessionId: props.checkoutSessionId },
        });
        if (existing) return paymentIntentToDomain(existing);
      }
      if (isUniqueViolationOn(error, 'idempotency_key')) {
        const existing = await prisma.paymentIntent.findUnique({
          where: { idempotencyKey: props.idempotencyKey },
        });
        if (existing) return paymentIntentToDomain(existing);
      }
      throw error;
    }
  }

  async updateStatus(id: string, status: PaymentIntentStatus): Promise<PaymentIntent> {
    const row = await prisma.paymentIntent.update({ where: { id }, data: { status } });
    return paymentIntentToDomain(row);
  }

  async addAttempt(
    paymentIntentId: string,
    props: {
      attemptNumber: number;
      providerAuthority?: string | null;
      redirectUrl?: string | null;
    },
  ): Promise<PaymentAttempt> {
    const row = await prisma.paymentAttempt.create({
      data: {
        id: randomUUID(),
        paymentIntentId,
        attemptNumber: props.attemptNumber,
        providerAuthority: props.providerAuthority ?? null,
        redirectUrl: props.redirectUrl ?? null,
      },
    });
    return paymentAttemptToDomain(row);
  }

  async updateAttemptStatus(
    id: string,
    status: PaymentAttemptStatus,
    extra?: { returnedAt?: Date },
  ): Promise<PaymentAttempt> {
    const row = await prisma.paymentAttempt.update({
      where: { id },
      data: { status, returnedAt: extra?.returnedAt },
    });
    return paymentAttemptToDomain(row);
  }

  async findAttemptByProviderAuthority(providerAuthority: string): Promise<PaymentAttempt | null> {
    const row = await prisma.paymentAttempt.findFirst({
      where: { providerAuthority },
      orderBy: { createdAt: 'desc' },
    });
    return row ? paymentAttemptToDomain(row) : null;
  }

  /**
   * Idempotent on `(providerId, providerReference)` (ADR-008 decision 9)
   * — same race-safety pattern as `create()` above, needed here for the
   * same real reason: a duplicate verified callback and a
   * verification-retry job racing each other can both observe "no
   * transaction yet" before either commits.
   */
  async createTransaction(props: {
    paymentIntentId: string;
    paymentAttemptId?: string | null;
    providerId: string;
    providerReference: string;
    amount: bigint;
    currency: string;
    status: PaymentTransactionStatus;
    verifiedAt?: Date | null;
    rawVerificationResponse?: Record<string, unknown> | null;
  }): Promise<PaymentTransaction> {
    try {
      const row = await prisma.paymentTransaction.upsert({
        where: {
          providerId_providerReference: {
            providerId: props.providerId,
            providerReference: props.providerReference,
          },
        },
        create: {
          id: randomUUID(),
          paymentIntentId: props.paymentIntentId,
          paymentAttemptId: props.paymentAttemptId ?? null,
          providerId: props.providerId,
          providerReference: props.providerReference,
          amount: props.amount,
          currency: props.currency,
          status: props.status,
          verifiedAt: props.verifiedAt ?? null,
          rawVerificationResponse: (props.rawVerificationResponse ?? undefined) as
            Prisma.InputJsonValue | undefined,
        },
        update: {},
      });
      return paymentTransactionToDomain(row);
    } catch (error) {
      if (isUniqueViolationOn(error, 'provider_reference')) {
        const existing = await prisma.paymentTransaction.findUnique({
          where: {
            providerId_providerReference: {
              providerId: props.providerId,
              providerReference: props.providerReference,
            },
          },
        });
        if (existing) return paymentTransactionToDomain(existing);
      }
      throw error;
    }
  }

  async findTransactionById(id: string): Promise<PaymentTransaction | null> {
    const row = await prisma.paymentTransaction.findUnique({ where: { id } });
    return row ? paymentTransactionToDomain(row) : null;
  }

  async findTransactionByProviderReference(
    providerId: string,
    providerReference: string,
  ): Promise<PaymentTransaction | null> {
    const row = await prisma.paymentTransaction.findUnique({
      where: { providerId_providerReference: { providerId, providerReference } },
    });
    return row ? paymentTransactionToDomain(row) : null;
  }

  /**
   * Idempotent on `dedupeKey` (ADR-008 decision 4) — a redelivered
   * callback resolves to the existing row (`wasNew: false`) instead of
   * re-triggering processing. Uses the same create-then-catch-P2002
   * shape as `create()`, not `upsert()`, specifically because the
   * `wasNew` signal the caller needs to decide "process this or skip"
   * has to come from whether the `create` branch actually ran, not from
   * comparing before/after field values.
   */
  async recordCallback(props: {
    paymentIntentId?: string | null;
    providerId: string;
    dedupeKey: string;
    rawPayload: Record<string, unknown>;
    signatureValid: boolean;
  }): Promise<{ callback: PaymentCallback; wasNew: boolean }> {
    try {
      const row = await prisma.paymentCallback.create({
        data: {
          id: randomUUID(),
          paymentIntentId: props.paymentIntentId ?? null,
          providerId: props.providerId,
          dedupeKey: props.dedupeKey,
          rawPayload: props.rawPayload as Prisma.InputJsonValue,
          signatureValid: props.signatureValid,
        },
      });
      return { callback: paymentCallbackToDomain(row), wasNew: true };
    } catch (error) {
      if (isUniqueViolationOn(error, 'dedupe_key')) {
        const existing = await prisma.paymentCallback.findUnique({
          where: { dedupeKey: props.dedupeKey },
        });
        if (existing) return { callback: paymentCallbackToDomain(existing), wasNew: false };
      }
      throw error;
    }
  }

  async markCallbackProcessed(id: string, processedAt: Date): Promise<PaymentCallback> {
    const row = await prisma.paymentCallback.update({ where: { id }, data: { processedAt } });
    return paymentCallbackToDomain(row);
  }
}
