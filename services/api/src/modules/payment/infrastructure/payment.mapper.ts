import type {
  PaymentAttempt as PrismaPaymentAttempt,
  PaymentCallback as PrismaPaymentCallback,
  PaymentIntent as PrismaPaymentIntent,
  PaymentProvider as PrismaPaymentProvider,
  PaymentTransaction as PrismaPaymentTransaction,
  ReconciliationRecord as PrismaReconciliationRecord,
  Refund as PrismaRefund,
  RefundLine as PrismaRefundLine,
} from '@iecp/database';

import { PaymentAttempt } from '../domain/entities/payment-attempt.entity';
import { PaymentCallback } from '../domain/entities/payment-callback.entity';
import { PaymentIntent } from '../domain/entities/payment-intent.entity';
import { PaymentProvider } from '../domain/entities/payment-provider.entity';
import { PaymentTransaction } from '../domain/entities/payment-transaction.entity';
import { ReconciliationRecord } from '../domain/entities/reconciliation-record.entity';
import { RefundLine } from '../domain/entities/refund-line.entity';
import { Refund } from '../domain/entities/refund.entity';

export function paymentProviderToDomain(row: PrismaPaymentProvider): PaymentProvider {
  return PaymentProvider.create({
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.isActive,
    isSandbox: row.isSandbox,
    config: (row.config as Record<string, unknown> | null) ?? null,
    lastHealthCheckAt: row.lastHealthCheckAt,
    lastHealthCheckOk: row.lastHealthCheckOk,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function paymentIntentToDomain(row: PrismaPaymentIntent): PaymentIntent {
  return PaymentIntent.create({
    id: row.id,
    checkoutSessionId: row.checkoutSessionId,
    customerId: row.customerId,
    guestToken: row.guestToken,
    providerId: row.providerId,
    status: row.status,
    amount: row.amount,
    currency: row.currency,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function paymentAttemptToDomain(row: PrismaPaymentAttempt): PaymentAttempt {
  return PaymentAttempt.create({
    id: row.id,
    paymentIntentId: row.paymentIntentId,
    attemptNumber: row.attemptNumber,
    providerAuthority: row.providerAuthority,
    redirectUrl: row.redirectUrl,
    status: row.status,
    startedAt: row.startedAt,
    returnedAt: row.returnedAt,
    createdAt: row.createdAt,
  });
}

export function paymentTransactionToDomain(row: PrismaPaymentTransaction): PaymentTransaction {
  return PaymentTransaction.create({
    id: row.id,
    paymentIntentId: row.paymentIntentId,
    paymentAttemptId: row.paymentAttemptId,
    providerId: row.providerId,
    providerReference: row.providerReference,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    verifiedAt: row.verifiedAt,
    rawVerificationResponse:
      (row.rawVerificationResponse as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function paymentCallbackToDomain(row: PrismaPaymentCallback): PaymentCallback {
  return PaymentCallback.create({
    id: row.id,
    paymentIntentId: row.paymentIntentId,
    providerId: row.providerId,
    dedupeKey: row.dedupeKey,
    rawPayload: row.rawPayload as Record<string, unknown>,
    signatureValid: row.signatureValid,
    processedAt: row.processedAt,
    receivedAt: row.receivedAt,
  });
}

export function refundToDomain(row: PrismaRefund): Refund {
  return Refund.create({
    id: row.id,
    paymentTransactionId: row.paymentTransactionId,
    amount: row.amount,
    reason: row.reason,
    status: row.status,
    requestedBy: row.requestedBy,
    providerRefundReference: row.providerRefundReference,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function refundLineToDomain(row: PrismaRefundLine): RefundLine {
  return RefundLine.create({
    id: row.id,
    refundId: row.refundId,
    returnItemId: row.returnItemId,
    amount: row.amount,
    createdAt: row.createdAt,
  });
}

export function reconciliationRecordToDomain(
  row: PrismaReconciliationRecord,
): ReconciliationRecord {
  return ReconciliationRecord.create({
    id: row.id,
    providerId: row.providerId,
    transactionDate: row.transactionDate,
    paymentTransactionId: row.paymentTransactionId,
    providerReference: row.providerReference,
    localAmount: row.localAmount,
    remoteAmount: row.remoteAmount,
    status: row.status,
    resolvedAt: row.resolvedAt,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
  });
}
