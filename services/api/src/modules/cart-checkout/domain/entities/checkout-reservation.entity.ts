import {
  asCheckoutReservationId,
  asCheckoutSessionId,
  asProductSkuId,
  asWarehouseId,
  type CheckoutReservationId,
  type CheckoutSessionId,
  type ProductSkuId,
  type WarehouseId,
} from '@iecp/types';

/** Preserves the reservation reference in the checkout session (the
 * brief's own explicit rule, ADR-007 decision 4) — one row per cart line
 * reserved. `inventoryReservationId` is an unenforced pointer to
 * `inventory.inventory_reservations.id`; the reservation state itself
 * lives entirely in Phase 006's ledger. */
export class CheckoutReservation {
  private constructor(
    public readonly id: CheckoutReservationId,
    public readonly checkoutSessionId: CheckoutSessionId,
    public readonly productSkuId: ProductSkuId,
    public readonly warehouseId: WarehouseId,
    public readonly inventoryReservationId: string,
    public readonly quantity: number,
    public readonly createdAt: Date,
  ) {}

  static create(props: {
    id: string;
    checkoutSessionId: string;
    productSkuId: string;
    warehouseId: string;
    inventoryReservationId: string;
    quantity: number;
    createdAt: Date;
  }): CheckoutReservation {
    return new CheckoutReservation(
      asCheckoutReservationId(props.id),
      asCheckoutSessionId(props.checkoutSessionId),
      asProductSkuId(props.productSkuId),
      asWarehouseId(props.warehouseId),
      props.inventoryReservationId,
      props.quantity,
      props.createdAt,
    );
  }
}
