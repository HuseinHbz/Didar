import { asProductSkuId, asWarehouseId } from '@iecp/types';
import { Injectable } from '@nestjs/common';

import type { InventoryReservation } from '../domain/entities/inventory-reservation.entity';
import { InsufficientStockError } from '../domain/services/available-quantity-calculator';
import {
  InvalidReservationOperationError,
  ReservationNotActiveError,
} from '../domain/services/reservation-rules';

import { AllocationService } from './allocation.service';
import { ReservationService } from './reservation.service';

/** What a sale attempt came to. A value, not an exception, because the
 * caller (the order module) has to tell three very different situations
 * apart that all used to look the same — a swallowed error:
 *
 * - `SOLD` — the units have left stock for this sale. Also returned when an
 *   earlier call, or a racing one, already sold them: selling is
 *   *exactly-once*, so "already done" is success.
 * - `NOT_HELD` — the reservation can no longer be sold (released, expired
 *   or gone); nothing was changed and the caller may re-acquire stock.
 * - `SHORT` — the stock is not there. A business outcome the caller must
 *   surface (an `OrderException`), never log-and-forget. */
export type StockSaleOutcome =
  { kind: 'SOLD' } | { kind: 'NOT_HELD'; status: string } | { kind: 'SHORT'; reason: string };

/** What `acquireAndSell` can return: there is no reservation of the caller's
 * to be "not held" — it either sold the units or the stock is short. */
export type StockAcquisitionOutcome = Extract<StockSaleOutcome, { kind: 'SOLD' | 'SHORT' }>;

export interface StockSaleReference {
  referenceType: string;
  referenceId: string;
}

/**
 * CP-031 (gap P0-5) — "take these units out of stock for this sale, exactly
 * once", built on the real reservation engine rather than beside it.
 *
 * An order is created from a verified payment, which can arrive after the
 * checkout that reserved the stock has lapsed and released it. The old
 * conversion loop converted only reservations that were still ACTIVE and
 * logged-and-ignored every other outcome, so such an order became PAID with
 * no stock ever sold. This service gives that code two honest operations:
 *
 * - `sellReserved` — sell what a reservation still holds;
 * - `acquireAndSell` — when the hold is gone, reserve afresh under a
 *   deterministic idempotency key (so any number of racing or retried
 *   callers converge on one reservation) and sell it.
 *
 * Both go through `ReservationService` — row-locked, ledger-writing,
 * never-negative — so no stock rule is re-implemented here; this class only
 * classifies the outcomes of those calls.
 */
@Injectable()
export class StockSaleService {
  constructor(
    private readonly reservations: ReservationService,
    private readonly allocation: AllocationService,
  ) {}

  /** Sells the units an existing reservation holds. */
  async sellReserved(
    reservationId: string,
    reference: StockSaleReference,
  ): Promise<StockSaleOutcome> {
    const held = await this.reservations.findById(reservationId);
    if (!held) return { kind: 'NOT_HELD', status: 'MISSING' };
    if (held.status === 'CONVERTED') return { kind: 'SOLD' };
    if (held.status !== 'ACTIVE') return { kind: 'NOT_HELD', status: held.status };

    try {
      await this.reservations.convert(reservationId, null, reference);
      return { kind: 'SOLD' };
    } catch (error) {
      if (error instanceof ReservationNotActiveError) {
        // Lost a race: a concurrent caller moved it out of ACTIVE first. If
        // that caller sold it, so is ours; if it was released, say so.
        const current = await this.reservations.findById(reservationId);
        if (current?.status === 'CONVERTED') return { kind: 'SOLD' };
        return { kind: 'NOT_HELD', status: current?.status ?? 'MISSING' };
      }
      if (
        error instanceof InsufficientStockError ||
        error instanceof InvalidReservationOperationError
      ) {
        return { kind: 'SHORT', reason: error.message };
      }
      throw error; // a genuine failure (database down…) — retried by the caller's sweep
    }
  }

  /**
   * Reserves `quantity` units under `idempotencyKey` and sells them. Safe to
   * call repeatedly and concurrently with the same key: the first call
   * creates the reservation, every other call finds and settles that one.
   */
  async acquireAndSell(input: {
    productSkuId: string;
    quantity: number;
    sourceType: string;
    sourceId: string;
    idempotencyKey: string;
    reference: StockSaleReference;
  }): Promise<StockAcquisitionOutcome> {
    // A previous attempt (crashed mid-way, or a racing caller) may already have
    // acquired — even sold — the stock; live availability says nothing then.
    const existing = await this.reservations.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.settle(existing, input.reference);

    const skuId = asProductSkuId(input.productSkuId);
    const choice = await this.allocation.allocate(skuId, { requestedQuantity: input.quantity });
    if (!choice.warehouseId) {
      return { kind: 'SHORT', reason: `no warehouse has ${input.quantity} unit(s) available` };
    }

    let reservation: InventoryReservation;
    try {
      reservation = await this.reservations.reserve({
        productSkuId: skuId,
        warehouseId: asWarehouseId(choice.warehouseId),
        quantity: input.quantity,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
      });
    } catch (error) {
      if (error instanceof InsufficientStockError) {
        return { kind: 'SHORT', reason: error.message };
      }
      throw error;
    }
    return this.settle(reservation, input.reference);
  }

  private async settle(
    reservation: InventoryReservation,
    reference: StockSaleReference,
  ): Promise<StockAcquisitionOutcome> {
    if (reservation.status === 'CONVERTED') return { kind: 'SOLD' };
    if (reservation.status !== 'ACTIVE') {
      return {
        kind: 'SHORT',
        reason: `reservation ${reservation.id} for this sale is ${reservation.status}`,
      };
    }
    const outcome = await this.sellReserved(reservation.id, reference);
    if (outcome.kind === 'NOT_HELD') {
      return { kind: 'SHORT', reason: `reservation ${reservation.id} is ${outcome.status}` };
    }
    return outcome;
  }
}
