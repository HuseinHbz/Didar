import type {
  ReturnItemCondition,
  ReturnReason,
  ReturnResolution,
  ReturnStatus,
} from '@iecp/types';

import type { ReturnItem } from '../entities/return-item.entity';
import type { ReturnRequest } from '../entities/return-request.entity';
import type { ReturnStatusHistory } from '../entities/return-status-history.entity';

export const RETURN_REPOSITORY = Symbol('RETURN_REPOSITORY');

export interface ReturnRequestWithDetail {
  request: ReturnRequest;
  items: ReturnItem[];
  history: ReturnStatusHistory[];
}

export interface ReturnListFilter {
  customerId?: string;
  guestToken?: string;
  orderId?: string;
  status?: ReturnStatus;
  requestedFrom?: Date;
  requestedTo?: Date;
  limit: number;
  /** Opaque cursor from a previous page's `nextCursor` — same shape
   * `OrderRepositoryPort.list()`/`AuditLogRepositoryPort.list()` already
   * established. */
  cursor?: string | null;
}

/** `transitioned: false` means the locked, authoritative check found the
 * row already at the target status (a race-resolved no-op) — same
 * `StatusUpdateResult` shape `FulfillmentRepositoryPort` already
 * established for the identical reason. */
export interface StatusUpdateResult<T> {
  entity: T;
  transitioned: boolean;
}

/**
 * `ReturnRequest` is the aggregate root for `ReturnItem` and
 * `ReturnStatusHistory` — same "child entities with no independent
 * lifecycle" reasoning `Order`/`Fulfillment` already use for their own
 * children.
 */
export interface ReturnRepositoryPort {
  findById(id: string): Promise<ReturnRequestWithDetail | null>;
  findByReturnNumber(returnNumber: string): Promise<ReturnRequest | null>;
  findByIdempotencyKey(key: string): Promise<ReturnRequest | null>;
  list(filter: ReturnListFilter): Promise<{ items: ReturnRequest[]; nextCursor: string | null }>;

  /** Every quantity named across every non-`REJECTED`/non-`CANCELLED`
   * `ReturnRequest`'s `ReturnItem` rows for `orderItemId` — read-only
   * visibility into the invariant `create()` enforces transactionally.
   * "Previously returned" and "currently active" are deliberately
   * collapsed into one figure (ADR-012 decision 5): both consume the
   * same remaining balance. */
  sumReturnedQuantity(orderItemId: string): Promise<number>;

  /**
   * Generates the next return number from `commerce.return_number_seq`
   * and, in one transaction, row-locks every referenced `OrderItem`
   * (`SELECT ... FOR UPDATE`, the same technique
   * `FulfillmentRepositoryPort.create()` already uses), re-sums
   * already-returned quantity inside that same lock, and asserts via
   * `ReturnQuantityValidator` before writing the `ReturnRequest` + its
   * `ReturnItem` rows — the real concurrency-safety guarantee for the
   * "never return more than ordered minus already-returned" invariant,
   * not just a declared one (ADR-012 decision 5).
   *
   * `idempotencyKey`, when supplied, is P2002-catch-and-reread safe — a
   * retried "create this return" request reusing the same key resolves
   * to the original row rather than creating a second, real duplicate.
   */
  create(props: {
    orderId: string;
    customerId?: string | null;
    guestToken?: string | null;
    reason: ReturnReason;
    reasonNote?: string | null;
    resolution?: ReturnResolution;
    items: readonly { orderItemId: string; quantity: number }[];
    idempotencyKey?: string | null;
  }): Promise<ReturnRequest>;

  /**
   * Row-locks `commerce.return_requests` (`SELECT ... FOR UPDATE`) and
   * re-checks `ReturnStateMachine` against the *locked* status before
   * writing, the same technique `PrismaOrderRepository.updateStatus()`/
   * `PrismaFulfillmentRepository.updateStatus()` already proved.
   * Appends a `ReturnStatusHistory` row in the same call — same
   * cache-plus-append-only-history split every prior status-bearing
   * aggregate in this repo uses. `transitioned: false` means a
   * concurrent caller already made this exact transition first — the
   * caller must skip audit-logging/side-effects it would otherwise
   * perform.
   */
  updateStatus(
    id: string,
    status: ReturnStatus,
    changedBy: string | null,
    note?: string | null,
    extra?: {
      warehouseId?: string | null;
      locationId?: string | null;
      rejectionReason?: string | null;
      approvedAt?: Date;
      receivedAt?: Date;
      inspectedAt?: Date;
      refundedAt?: Date;
      completedAt?: Date;
      rejectedAt?: Date;
      cancelledAt?: Date;
    },
  ): Promise<StatusUpdateResult<ReturnRequest>>;

  /** Records each `ReturnItem`'s physical inspection outcome
   * (`condition`) and its server-computed `refundAmount` — written once,
   * at `INSPECTING -> APPROVED_FOR_REFUND` (ADR-012 decision 4), never
   * client-supplied. */
  recordInspection(
    returnRequestId: string,
    items: readonly {
      returnItemId: string;
      condition: ReturnItemCondition;
      refundAmount: bigint;
    }[],
  ): Promise<ReturnItem[]>;

  /** ADR-013 decision 6 — marks one `ReturnItem` as restocked
   * (`restocked_at = COALESCE(restocked_at, NOW())`, a single-row
   * atomic `UPDATE`, idempotent by construction: a redundant call never
   * overwrites the original timestamp). This is the fast-path
   * "already done" check `ReturnSettlementService.beginRestock()` reads
   * before ever attempting `receiveStock()` again — the real
   * correctness guarantee is `InventoryLedger.idempotencyKey`
   * (decision 6), not this column; a crash between the ledger write
   * and this call is safe because retrying `receiveStock()` with the
   * same key is itself a harmless no-op. */
  markItemRestocked(returnItemId: string): Promise<void>;
}
