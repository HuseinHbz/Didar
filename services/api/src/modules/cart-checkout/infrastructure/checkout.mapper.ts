import type {
  CheckoutAddress as PrismaCheckoutAddress,
  CheckoutReservation as PrismaCheckoutReservation,
  CheckoutSession as PrismaCheckoutSession,
  CheckoutTotals as PrismaCheckoutTotals,
  CheckoutValidationResult as PrismaCheckoutValidationResult,
} from '@iecp/database';

import { CheckoutAddress } from '../domain/entities/checkout-address.entity';
import { CheckoutReservation } from '../domain/entities/checkout-reservation.entity';
import { CheckoutSession } from '../domain/entities/checkout-session.entity';
import { CheckoutTotals } from '../domain/entities/checkout-totals.entity';
import {
  CheckoutValidationResult,
  type CheckoutValidationIssue,
} from '../domain/entities/checkout-validation-result.entity';

import { breakdownFromJson } from './cart.mapper';

export function checkoutSessionToDomain(row: PrismaCheckoutSession): CheckoutSession {
  return CheckoutSession.create({
    id: row.id,
    cartId: row.cartId,
    customerId: row.customerId,
    guestToken: row.guestToken,
    status: row.status,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    shippingTotal: row.shippingTotal,
    grandTotal: row.grandTotal,
    pricingSnapshot: (row.pricingSnapshot as Record<string, unknown> | null) ?? null,
    shippingSnapshot: (row.shippingSnapshot as Record<string, unknown> | null) ?? null,
    addressSnapshot: (row.addressSnapshot as Record<string, unknown> | null) ?? null,
    idempotencyKey: row.idempotencyKey,
    expiresAt: row.expiresAt,
    cancelledAt: row.cancelledAt,
    convertedAt: row.convertedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function checkoutAddressToDomain(row: PrismaCheckoutAddress): CheckoutAddress {
  return CheckoutAddress.create({
    id: row.id,
    checkoutSessionId: row.checkoutSessionId,
    customerAddressId: row.customerAddressId,
    recipientName: row.recipientName,
    phone: row.phone,
    province: row.province,
    city: row.city,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    postalCode: row.postalCode,
    createdAt: row.createdAt,
  });
}

export function checkoutTotalsToDomain(row: PrismaCheckoutTotals): CheckoutTotals {
  return CheckoutTotals.create({
    id: row.id,
    checkoutSessionId: row.checkoutSessionId,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    shippingTotal: row.shippingTotal,
    grandTotal: row.grandTotal,
    breakdown: breakdownFromJson(row.breakdown),
    calculatedAt: row.calculatedAt,
  });
}

export function checkoutValidationToDomain(
  row: PrismaCheckoutValidationResult,
): CheckoutValidationResult {
  return CheckoutValidationResult.create({
    id: row.id,
    checkoutSessionId: row.checkoutSessionId,
    outcome: row.outcome,
    issues: row.issues as unknown as CheckoutValidationIssue[],
    validatedAt: row.validatedAt,
  });
}

export function checkoutReservationToDomain(row: PrismaCheckoutReservation): CheckoutReservation {
  return CheckoutReservation.create({
    id: row.id,
    checkoutSessionId: row.checkoutSessionId,
    productSkuId: row.productSkuId,
    warehouseId: row.warehouseId,
    inventoryReservationId: row.inventoryReservationId,
    quantity: row.quantity,
    createdAt: row.createdAt,
  });
}
