import type {
  CreditNote as PrismaCreditNote,
  CreditNoteLine as PrismaCreditNoteLine,
  ReturnItem as PrismaReturnItem,
  ReturnRequest as PrismaReturnRequest,
  ReturnStatusHistory as PrismaReturnStatusHistory,
} from '@iecp/database';

import { CreditNoteLine } from '../domain/entities/credit-note-line.entity';
import { CreditNote } from '../domain/entities/credit-note.entity';
import { ReturnItem } from '../domain/entities/return-item.entity';
import { ReturnRequest } from '../domain/entities/return-request.entity';
import { ReturnStatusHistory } from '../domain/entities/return-status-history.entity';

export function returnRequestToDomain(row: PrismaReturnRequest): ReturnRequest {
  return ReturnRequest.create({
    id: row.id,
    returnNumber: row.returnNumber,
    orderId: row.orderId,
    customerId: row.customerId,
    guestToken: row.guestToken,
    status: row.status,
    reason: row.reason,
    reasonNote: row.reasonNote,
    resolution: row.resolution,
    warehouseId: row.warehouseId,
    locationId: row.locationId,
    rejectionReason: row.rejectionReason,
    idempotencyKey: row.idempotencyKey,
    requestedAt: row.requestedAt,
    approvedAt: row.approvedAt,
    receivedAt: row.receivedAt,
    inspectedAt: row.inspectedAt,
    refundedAt: row.refundedAt,
    completedAt: row.completedAt,
    rejectedAt: row.rejectedAt,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function returnItemToDomain(row: PrismaReturnItem): ReturnItem {
  return ReturnItem.create({
    id: row.id,
    returnRequestId: row.returnRequestId,
    orderItemId: row.orderItemId,
    quantity: row.quantity,
    condition: row.condition,
    refundAmount: row.refundAmount,
    createdAt: row.createdAt,
  });
}

export function returnStatusHistoryToDomain(row: PrismaReturnStatusHistory): ReturnStatusHistory {
  return ReturnStatusHistory.create({
    id: row.id,
    returnRequestId: row.returnRequestId,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    changedBy: row.changedBy,
    note: row.note,
    createdAt: row.createdAt,
  });
}

export function creditNoteToDomain(row: PrismaCreditNote): CreditNote {
  return CreditNote.create({
    id: row.id,
    creditNoteNumber: row.creditNoteNumber,
    orderId: row.orderId,
    returnRequestId: row.returnRequestId,
    invoiceId: row.invoiceId,
    customerId: row.customerId,
    status: row.status,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    grandTotal: row.grandTotal,
    issuedAt: row.issuedAt,
    appliedAt: row.appliedAt,
    voidedAt: row.voidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function creditNoteLineToDomain(row: PrismaCreditNoteLine): CreditNoteLine {
  return CreditNoteLine.create({
    id: row.id,
    creditNoteId: row.creditNoteId,
    description: row.description,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    lineTotal: row.lineTotal,
  });
}
