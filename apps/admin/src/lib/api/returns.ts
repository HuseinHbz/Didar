import type { ReturnStatus, ReturnSettlementStatus } from '@iecp/types';

import type { Page } from './catalog';
import { apiRequest } from './client';

export type { ReturnStatus };

export interface ReturnItem {
  id: string;
  orderItemId: string;
  quantity: number;
  condition: string | null;
  refundAmount: string | null;
}

export interface ReturnRequest {
  id: string;
  returnNumber: string;
  orderId: string;
  customerId: string | null;
  status: ReturnStatus;
  reason: string;
  reasonNote: string | null;
  resolution: string;
  warehouseId: string | null;
  locationId: string | null;
  rejectionReason: string | null;
  requestedAt: string;
  items: ReturnItem[];
}

export async function listReturns(params: {
  status?: ReturnStatus;
  cursor?: string;
  limit?: number;
}): Promise<Page<ReturnRequest>> {
  return apiRequest<Page<ReturnRequest>>('/admin/returns', { query: params });
}

export async function getReturn(id: string): Promise<ReturnRequest> {
  return apiRequest<ReturnRequest>(`/admin/returns/${id}`);
}

export async function approveReturn(id: string): Promise<ReturnRequest> {
  return apiRequest<ReturnRequest>(`/admin/returns/${id}/approve`, { method: 'POST' });
}

export async function rejectReturn(id: string, reason: string): Promise<ReturnRequest> {
  return apiRequest<ReturnRequest>(`/admin/returns/${id}/reject`, {
    method: 'POST',
    body: { reason },
  });
}

export async function receiveReturn(
  id: string,
  warehouseId: string,
  locationId: string,
): Promise<ReturnRequest> {
  return apiRequest<ReturnRequest>(`/admin/returns/${id}/receive`, {
    method: 'POST',
    body: { warehouseId, locationId },
  });
}

export async function inspectReturn(
  id: string,
  items: { returnItemId: string; condition: string; quantity: number }[],
): Promise<ReturnRequest> {
  return apiRequest<ReturnRequest>(`/admin/returns/${id}/inspect`, {
    method: 'POST',
    body: { items },
  });
}

export async function approveReturnForRefund(id: string): Promise<ReturnRequest> {
  return apiRequest<ReturnRequest>(`/admin/returns/${id}/approve-refund`, { method: 'POST' });
}

export async function refundReturn(id: string): Promise<ReturnRequest> {
  return apiRequest<ReturnRequest>(`/admin/returns/${id}/refund`, { method: 'POST' });
}

export type SettlementStatus = ReturnSettlementStatus;

export interface ReturnSettlement {
  id: string;
  returnRequestId: string;
  status: SettlementStatus;
  restockCompletedAt: string | null;
  refundRequestedAt: string | null;
  refundRecordedAt: string | null;
  settledAt: string | null;
  completedAt: string | null;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: string | null;
}

/** No settlement row exists until CP-013's async recovery sweep creates
 * one — `GET .../:id/settlement` 404s until then, which the return
 * detail page treats as "no settlement yet," not an error. */
export async function getReturnSettlement(returnId: string): Promise<ReturnSettlement | null> {
  try {
    return await apiRequest<ReturnSettlement>(`/admin/returns/${returnId}/settlement`);
  } catch (error) {
    if (
      error instanceof Error &&
      'isNotFound' in error &&
      (error as { isNotFound: boolean }).isNotFound
    ) {
      return null;
    }
    throw error;
  }
}

export async function retrySettlement(returnId: string): Promise<ReturnSettlement> {
  return apiRequest<ReturnSettlement>(`/admin/returns/${returnId}/settlement/retry`, {
    method: 'POST',
  });
}

export interface ReconciliationFinding {
  returnRequestId: string;
  settlementId: string | null;
  pattern: string;
  detail?: string;
}

export async function reconcileReturn(
  returnId: string,
): Promise<{ findings: ReconciliationFinding[]; manualReviewCount: number }> {
  return apiRequest(`/admin/returns/${returnId}/reconcile`, { method: 'POST' });
}
