import type { CheckoutStatus } from '@iecp/types';

import type { CheckoutAddress } from '../entities/checkout-address.entity';
import type { CheckoutReservation } from '../entities/checkout-reservation.entity';
import type { CheckoutSession } from '../entities/checkout-session.entity';
import type { CheckoutTotals } from '../entities/checkout-totals.entity';
import type {
  CheckoutValidationIssue,
  CheckoutValidationResult,
} from '../entities/checkout-validation-result.entity';
import type { PriceLineBreakdown } from '../entities/price-breakdown.types';

export const CHECKOUT_SESSION_REPOSITORY = Symbol('CHECKOUT_SESSION_REPOSITORY');

export interface CheckoutSessionWithDetail {
  session: CheckoutSession;
  address: CheckoutAddress | null;
  latestTotals: CheckoutTotals | null;
  latestValidation: CheckoutValidationResult | null;
  reservations: CheckoutReservation[];
}

/**
 * `CheckoutSession` is the aggregate root for `CheckoutAddress`,
 * `CheckoutTotals`, `CheckoutValidationResult`, and `CheckoutReservation`
 * — same "child entities with no independent lifecycle" reasoning as
 * `CartRepositoryPort` (see that port's own doc comment).
 */
export interface CheckoutSessionRepositoryPort {
  findById(id: string): Promise<CheckoutSessionWithDetail | null>;
  findByIdempotencyKey(key: string): Promise<CheckoutSession | null>;
  /** Every non-terminal session whose `expiresAt` has already passed —
   * what the `checkout_expiration` BullMQ processor sweeps (ADR-007
   * decision 3). */
  listExpirable(now: Date): Promise<CheckoutSession[]>;

  /** Every `CONVERTED` session updated since `since` — reserved for
   * Phase 009's `order_conversion` sweep (ADR-009 decision 4), the
   * reliability backstop for a customer who never returns to trigger a
   * synchronous conversion after paying. */
  listConvertedSince(since: Date): Promise<CheckoutSession[]>;

  /** Idempotent on `idempotencyKey` — a retried call with the same key
   * returns the original session instead of creating a second one (the
   * brief's own explicit "do not create duplicate checkout session"). */
  create(props: {
    cartId: string;
    customerId?: string | null;
    guestToken?: string | null;
    currency: string;
    idempotencyKey: string;
    expiresAt?: Date | null;
  }): Promise<CheckoutSession>;

  updateStatus(
    id: string,
    status: CheckoutStatus,
    extra?: { cancelledAt?: Date; convertedAt?: Date },
  ): Promise<CheckoutSession>;

  /** Pushes `expiresAt` forward to `expiresAt` — **monotonic**: an earlier
   * value never replaces a later one, and a terminal session is left alone.
   * `POST /checkout/:id/refresh` (customer) and the payment module's
   * hold-while-paying (CP-031, gap P0-3) both go through here, so neither can
   * shorten the other's deadline. Implemented as one conditional `UPDATE`
   * (the same row `claimExpiry` conditions on), which is what makes the
   * hold-vs-expiry race decidable without a lock. Returns the row as it
   * stands afterwards — the caller inspects `status` to learn whether the
   * session was still alive. */
  extendExpiry(id: string, expiresAt: Date): Promise<CheckoutSession>;

  /** Atomically moves a non-terminal session to `EXPIRED` — a single
   * conditional `UPDATE … WHERE status IN (non-terminal) [AND expires_at <
   * dueBefore]`. Returns `false` when it lost: the session was extended
   * (hold-while-paying), converted, cancelled or already expired in the
   * meantime. `dueBefore: null` expires unconditionally (an explicit,
   * non-sweep call). */
  claimExpiry(id: string, dueBefore: Date | null): Promise<boolean>;

  setAddress(
    checkoutSessionId: string,
    props: {
      customerAddressId?: string | null;
      recipientName: string;
      phone: string;
      province: string;
      city: string;
      addressLine1: string;
      addressLine2?: string | null;
      postalCode?: string | null;
    },
  ): Promise<CheckoutAddress>;

  /** Recomputes and writes `subtotal`/`discountTotal`/`taxTotal`/
   * `shippingTotal`/`grandTotal` on the session row itself (fast-read
   * cache) AND appends a `CheckoutTotals` history row in the same call —
   * same cache-plus-ledger split as `InventoryItem`/`InventoryLedger`
   * (ADR-006 decision 2, reapplied per ADR-007 decision 2). */
  recordTotals(
    checkoutSessionId: string,
    props: {
      currency: string;
      subtotal: bigint;
      discountTotal: bigint;
      taxTotal: bigint;
      shippingTotal: bigint;
      grandTotal: bigint;
      breakdown: readonly PriceLineBreakdown[];
    },
  ): Promise<CheckoutTotals>;

  recordValidation(
    checkoutSessionId: string,
    props: { outcome: 'PASSED' | 'FAILED'; issues: readonly CheckoutValidationIssue[] },
  ): Promise<CheckoutValidationResult>;

  addReservation(
    checkoutSessionId: string,
    props: {
      productSkuId: string;
      warehouseId: string;
      inventoryReservationId: string;
      quantity: number;
    },
  ): Promise<CheckoutReservation>;

  /** Freezes the payment-ready snapshot fields (`pricingSnapshot`/
   * `shippingSnapshot`/`addressSnapshot`) at the moment `status` becomes
   * `READY_FOR_PAYMENT` — separate from `updateStatus` since not every
   * transition needs a snapshot write. */
  freezeSnapshots(
    checkoutSessionId: string,
    props: {
      pricingSnapshot: Record<string, unknown>;
      shippingSnapshot: Record<string, unknown> | null;
      addressSnapshot: Record<string, unknown>;
    },
  ): Promise<CheckoutSession>;
}
