import { randomUUID } from 'node:crypto';

import { asProductSkuId, asWarehouseId } from '@iecp/types';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import { ProductsService } from '../../catalog/application/products.service';
import { SkusService } from '../../catalog/application/skus.service';
import { AllocationService } from '../../inventory/application/allocation.service';
import { ReservationService } from '../../inventory/application/reservation.service';
import { StockQueryService } from '../../inventory/application/stock-query.service';
import type { CheckoutValidationIssue } from '../domain/entities/checkout-validation-result.entity';
import {
  CART_REPOSITORY,
  type CartRepositoryPort,
  type CartWithItems,
} from '../domain/ports/cart.repository.port';
import {
  CHECKOUT_SESSION_REPOSITORY,
  type CheckoutSessionRepositoryPort,
  type CheckoutSessionWithDetail,
} from '../domain/ports/checkout-session.repository.port';
import {
  CUSTOMER_LOOKUP_PORT,
  type CustomerLookupPort,
} from '../domain/ports/customer-lookup.port';
import {
  CheckoutStateMachine,
  InvalidCheckoutTransitionError,
} from '../domain/services/checkout-state-machine';
import { PrescriptionReferenceValidator } from '../domain/services/prescription-reference-validator';

import { CartPricingService } from './cart-pricing.service';

const DEFAULT_CHECKOUT_TTL_MINUTES = 20;

export interface CheckoutActor {
  customerId: string | null;
  guestToken: string | null;
}

export interface CheckoutAddressInput {
  customerAddressId?: string | null;
  recipientName: string;
  phone: string;
  province: string;
  city: string;
  addressLine1: string;
  addressLine2?: string | null;
  postalCode?: string | null;
}

/**
 * Orchestrates `Cart -> Checkout Start -> Validate -> Calculate Final
 * Price -> Reserve Inventory -> READY_FOR_PAYMENT` (the brief's own
 * `inventory_integration.workflow`, reinterpreted against the literal
 * `api.checkout` endpoint list — see this class's `reserve()` doc comment
 * for the one place those two descriptions genuinely diverge). Every
 * mutation here funnels through Phase 006's real `ReservationService`/
 * `AllocationService` (ADR-007 decision 4) — this class never mutates
 * inventory state itself.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @Inject(CHECKOUT_SESSION_REPOSITORY) private readonly sessions: CheckoutSessionRepositoryPort,
    @Inject(CART_REPOSITORY) private readonly carts: CartRepositoryPort,
    @Inject(CUSTOMER_LOOKUP_PORT) private readonly customers: CustomerLookupPort,
    private readonly products: ProductsService,
    private readonly skus: SkusService,
    private readonly stock: StockQueryService,
    private readonly allocation: AllocationService,
    private readonly reservations: ReservationService,
    private readonly pricing: CartPricingService,
  ) {}

  async get(checkoutId: string, actor: CheckoutActor): Promise<CheckoutSessionWithDetail> {
    const detail = await this.sessions.findById(checkoutId);
    if (!detail) throw new NotFoundException('Checkout session not found');
    this.assertOwnership(detail.session, actor);
    return detail;
  }

  /** IDOR protection, same shape as `CartService.assertOwnership`. */
  private assertOwnership(
    session: CheckoutSessionWithDetail['session'],
    actor: CheckoutActor,
  ): void {
    if (session.customerId) {
      if (session.customerId !== actor.customerId) {
        throw new ForbiddenException(
          'This checkout session does not belong to the current customer',
        );
      }
      return;
    }
    if (session.guestToken && session.guestToken !== actor.guestToken) {
      throw new ForbiddenException(
        'This checkout session does not belong to the current guest session',
      );
    }
  }

  /**
   * `POST /checkout` — idempotent on `idempotencyKey` (a client-supplied
   * key, or a fresh one per call when omitted — a retried call *with* the
   * same key resolves to the same session, never a duplicate, satisfying
   * the brief's explicit "do not create duplicate checkout session").
   * Moves the source cart to `CHECKOUT_STARTED` so a second concurrent
   * `POST /checkout` against the same cart is visible, not silently
   * allowed to spawn a second in-flight checkout for the same basket.
   */
  async start(
    cartId: string,
    actor: CheckoutActor,
    options: { idempotencyKey?: string; address?: CheckoutAddressInput } = {},
  ): Promise<CheckoutSessionWithDetail> {
    const cart = await this.carts.findById(cartId);
    if (!cart) throw new NotFoundException('Cart not found');
    this.assertCartOwnership(cart, actor);
    if (cart.items.length === 0) {
      throw new ForbiddenException('Cannot start checkout on an empty cart');
    }

    const idempotencyKey = options.idempotencyKey ?? randomUUID();
    const expiresAt = new Date(Date.now() + DEFAULT_CHECKOUT_TTL_MINUTES * 60_000);
    const session = await this.sessions.create({
      cartId: cart.cart.id,
      customerId: cart.cart.customerId,
      guestToken: cart.cart.guestToken,
      currency: cart.cart.currency,
      idempotencyKey,
      expiresAt,
    });

    if (cart.cart.status === 'ACTIVE') {
      await this.carts.updateStatus(cart.cart.id, 'CHECKOUT_STARTED');
    }
    if (options.address) {
      await this.sessions.setAddress(session.id, options.address);
    }

    const detail = await this.sessions.findById(session.id);
    if (!detail) throw new NotFoundException('Checkout session not found');
    return detail;
  }

  private assertCartOwnership(cart: CartWithItems, actor: CheckoutActor): void {
    if (cart.cart.customerId) {
      if (cart.cart.customerId !== actor.customerId) {
        throw new ForbiddenException('This cart does not belong to the current customer');
      }
      return;
    }
    if (cart.cart.guestToken && cart.cart.guestToken !== actor.guestToken) {
      throw new ForbiddenException('This cart does not belong to the current guest session');
    }
  }

  async setAddress(
    checkoutId: string,
    actor: CheckoutActor,
    address: CheckoutAddressInput,
  ): Promise<CheckoutSessionWithDetail> {
    const detail = await this.get(checkoutId, actor);
    this.assertNotTerminal(detail.session);
    await this.sessions.setAddress(detail.session.id, address);
    return this.get(checkoutId, actor);
  }

  private assertNotTerminal(session: CheckoutSessionWithDetail['session']): void {
    if (session.isTerminal) {
      throw new InvalidCheckoutTransitionError(session.status, session.status);
    }
  }

  /**
   * `POST /checkout/:id/validate` — runs every check in the brief's
   * `checkout_validation` list, records an append-only
   * `CheckoutValidationResult`, and transitions `OPEN -> VALIDATING`.
   * Never throws on a validation *failure* (that's a normal, expected
   * outcome the caller inspects via `outcome`/`issues`) — only on a
   * structural problem (session not found, wrong owner, already
   * terminal).
   */
  async validate(checkoutId: string, actor: CheckoutActor): Promise<CheckoutSessionWithDetail> {
    const detail = await this.get(checkoutId, actor);
    this.assertNotTerminal(detail.session);

    const issues: CheckoutValidationIssue[] = [];
    const cart = await this.carts.findById(detail.session.cartId);
    if (!cart) {
      issues.push({ code: 'CART_NOT_ACTIVE', message: 'Source cart no longer exists' });
    } else {
      if (cart.items.length === 0) {
        issues.push({ code: 'QUANTITY_INVALID', message: 'Cart has no items' });
      }
      for (const item of cart.items) {
        const skuId = asProductSkuId(item.productSkuId);
        const sku = await this.skus.get(skuId).catch(() => null);
        if (sku?.status !== 'ACTIVE') {
          issues.push({
            code: 'SKU_NOT_ACTIVE',
            message: 'SKU is not active',
            productSkuId: item.productSkuId,
          });
          continue;
        }
        const product = await this.products.get(sku.productId).catch(() => null);
        if (product?.status !== 'PUBLISHED') {
          issues.push({
            code: 'PRODUCT_NOT_PUBLISHED',
            message: 'Product is not published',
            productSkuId: item.productSkuId,
          });
        }
        const availability = await this.stock.getAvailability(skuId);
        if (availability.totalAvailableQuantity < item.quantity) {
          issues.push({
            code: 'INVENTORY_UNAVAILABLE',
            message: 'Insufficient available stock',
            productSkuId: item.productSkuId,
          });
        }
        for (const option of item.options) {
          if (option.optionType === 'PRESCRIPTION_REFERENCE') {
            const status = PrescriptionReferenceValidator.validate(option.optionKey);
            if (status === 'invalid_shape') {
              issues.push({
                code: 'PRESCRIPTION_REFERENCE_UNVERIFIED',
                message: 'Malformed prescription reference',
                productSkuId: item.productSkuId,
              });
            }
          }
        }
      }
    }

    if (!detail.address) {
      issues.push({
        code: 'ADDRESS_INVALID',
        message: 'No shipping/billing address set on this checkout',
      });
    }

    const outcome = issues.length === 0 ? 'PASSED' : 'FAILED';
    await this.sessions.recordValidation(detail.session.id, { outcome, issues });
    if (detail.session.status === 'OPEN') {
      await this.sessions.updateStatus(detail.session.id, 'VALIDATING');
    }
    return this.get(checkoutId, actor);
  }

  /** `POST /checkout/:id/price` — server-side recalculation, always;
   * never trusts any client-supplied total (the brief's own absolute
   * rule). Persists an append-only `CheckoutTotals` row plus the fast-read
   * cache columns on the session itself. */
  async price(checkoutId: string, actor: CheckoutActor) {
    const detail = await this.get(checkoutId, actor);
    this.assertNotTerminal(detail.session);
    const cart = await this.carts.findById(detail.session.cartId);
    if (!cart) throw new NotFoundException('Source cart no longer exists');

    const couponRule = cart.coupon
      ? ((
          await this.pricing
            .resolveCouponRule(cart.coupon.code, detail.session.customerId)
            .catch(() => null)
        )?.rule ?? null)
      : null;

    let shippingCost = cart.shippingSelection?.estimatedCost ?? 0n;
    if (cart.shippingSelection && detail.address) {
      const subtotal = cart.items.reduce((sum, item) => sum + item.lineSubtotal, 0n);
      shippingCost = await this.pricing
        .resolveShippingCost(cart.shippingSelection.shippingMethodId, detail.address, subtotal)
        .catch(() => cart.shippingSelection?.estimatedCost ?? 0n);
    }

    const resolution = await this.pricing.resolve(cart.items, couponRule, shippingCost);
    await this.sessions.recordTotals(detail.session.id, {
      currency: cart.cart.currency,
      subtotal: resolution.subtotal,
      discountTotal: resolution.discountTotal,
      taxTotal: resolution.taxTotal,
      shippingTotal: resolution.shippingTotal,
      grandTotal: resolution.grandTotal,
      breakdown: resolution.lines,
    });
    return resolution;
  }

  /**
   * `POST /checkout/:id/reserve` — the one place this class touches
   * inventory. For each cart line: `AllocationService.allocate()` picks a
   * warehouse (config-driven, explainable — never reimplemented here),
   * then `ReservationService.reserve()` with `sourceType: 'CHECKOUT'`,
   * `sourceId: checkoutId` and a deterministic idempotency key
   * (`checkout:<checkoutId>:<productSkuId>`, joined with `__` — BullMQ's
   * own `:` restriction taught this repo that lesson in Phase 006, so this
   * key avoids the character even though it isn't a BullMQ job id itself,
   * for consistency). Calling `reserve()` twice for the same checkout is
   * safe: the second call resolves to the exact same
   * `InventoryReservation` and the resulting `CheckoutReservation` upsert
   * is a no-op update, not a duplicate row (the brief's explicit "do not
   * create duplicate reservation").
   *
   * Note on the brief's textual workflow diagram ("Cart, Checkout Start,
   * Validate, Calculate Final Price, Reserve Inventory, Create Checkout
   * Session, READY_FOR_PAYMENT") versus the literal `api.checkout`
   * endpoint list (`POST /checkout` first, `POST /checkout/:id/reserve`
   * addressed by an id that must already exist): this implementation
   * follows the endpoint list as authoritative — the session is created
   * by `start()` *before* validate/price/reserve, since every one of
   * those calls is itself scoped to `:id`. The diagram is read as the
   * conceptual business sequence, not literal call order.
   */
  async reserve(checkoutId: string, actor: CheckoutActor): Promise<CheckoutSessionWithDetail> {
    const detail = await this.get(checkoutId, actor);
    this.assertNotTerminal(detail.session);
    const cart = await this.carts.findById(detail.session.cartId);
    if (!cart) throw new NotFoundException('Source cart no longer exists');

    for (const item of cart.items) {
      const skuId = asProductSkuId(item.productSkuId);
      const allocation = await this.allocation.allocate(skuId, {
        requestedQuantity: item.quantity,
      });
      if (!allocation.warehouseId) {
        throw new ForbiddenException(`No warehouse has enough stock for SKU ${item.productSkuId}`);
      }
      const idempotencyKey = `checkout__${checkoutId}__${item.productSkuId}`;
      const reservation = await this.reservations.reserve({
        productSkuId: skuId,
        warehouseId: asWarehouseId(allocation.warehouseId),
        quantity: item.quantity,
        sourceType: 'CHECKOUT',
        sourceId: checkoutId,
        idempotencyKey,
      });
      await this.sessions.addReservation(detail.session.id, {
        productSkuId: item.productSkuId,
        warehouseId: allocation.warehouseId,
        inventoryReservationId: reservation.id,
        quantity: item.quantity,
      });
    }

    return this.get(checkoutId, actor);
  }

  /** `POST /checkout/:id/refresh` — extends the checkout's own expiry
   * window (idempotent: calling it repeatedly just keeps pushing
   * `expiresAt` forward, never creates anything new). The held inventory
   * reservations are never given their own TTL by `reserve()` above
   * (`expiresAt` omitted) — this checkout session's own expiry is what
   * governs their lifetime; `cancel()`/the expiration sweep release them
   * explicitly rather than relying on Phase 006's own reservation-expiry
   * mechanism, which this module deliberately does not invoke. */
  async refresh(checkoutId: string, actor: CheckoutActor): Promise<CheckoutSessionWithDetail> {
    const detail = await this.get(checkoutId, actor);
    this.assertNotTerminal(detail.session);
    const expiresAt = new Date(Date.now() + DEFAULT_CHECKOUT_TTL_MINUTES * 60_000);
    await this.sessions.extendExpiry(detail.session.id, expiresAt);
    return this.get(checkoutId, actor);
  }

  /** `POST /checkout/:id/cancel` — idempotent by construction via the
   * state machine (`CheckoutStateMachine.isNoOp`): cancelling an already-
   * `CANCELLED` session returns it unchanged rather than erroring. Every
   * reservation this checkout holds is released through
   * `ReservationService.release()` (never reimplemented). */
  async cancel(checkoutId: string, actor: CheckoutActor): Promise<CheckoutSessionWithDetail> {
    const detail = await this.get(checkoutId, actor);
    if (CheckoutStateMachine.isNoOp(detail.session.status, 'CANCELLED')) return detail;
    CheckoutStateMachine.assertTransition(detail.session.status, 'CANCELLED');

    for (const reservation of detail.reservations) {
      await this.reservations.release(reservation.inventoryReservationId).catch(() => undefined);
    }
    await this.sessions.updateStatus(detail.session.id, 'CANCELLED', { cancelledAt: new Date() });
    return this.get(checkoutId, actor);
  }

  /** Consumer-side counterpart to `cancel()` — invoked by the
   * `checkout_expiration` BullMQ processor (ADR-007 decision 3), never by
   * an HTTP controller. Same idempotent-by-construction shape: expiring
   * an already-terminal session is a no-op. Releases every held
   * reservation through `ReservationService.release()` exactly like
   * `cancel()` does, since an expired checkout must give its held stock
   * back just as surely as a cancelled one. */
  async expire(checkoutId: string): Promise<CheckoutSessionWithDetail> {
    const detail = await this.sessions.findById(checkoutId);
    if (!detail) throw new NotFoundException('Checkout session not found');
    if (CheckoutStateMachine.isNoOp(detail.session.status, 'EXPIRED')) return detail;
    if (!CheckoutStateMachine.canTransition(detail.session.status, 'EXPIRED')) return detail;

    for (const reservation of detail.reservations) {
      await this.reservations.release(reservation.inventoryReservationId).catch(() => undefined);
    }
    await this.sessions.updateStatus(detail.session.id, 'EXPIRED');
    const updated = await this.sessions.findById(checkoutId);
    if (!updated) throw new NotFoundException('Checkout session not found');
    return updated;
  }

  /** `POST /checkout/:id/ready-for-payment` — requires the latest
   * validation to have `PASSED`, a real address, and every cart line
   * reserved; freezes `pricingSnapshot`/`shippingSnapshot`/
   * `addressSnapshot` at this exact moment (ADR-007 decision 1) so a
   * later price/shipping-method change can never retroactively alter what
   * the customer is about to pay. This is the furthest this phase goes —
   * no payment provider call, no `Order` row (Phase 008/009). */
  async readyForPayment(
    checkoutId: string,
    actor: CheckoutActor,
  ): Promise<CheckoutSessionWithDetail> {
    const detail = await this.get(checkoutId, actor);
    if (CheckoutStateMachine.isNoOp(detail.session.status, 'READY_FOR_PAYMENT')) return detail;
    CheckoutStateMachine.assertTransition(detail.session.status, 'READY_FOR_PAYMENT');

    if (!detail.latestValidation?.passed) {
      throw new ForbiddenException(
        'Checkout must pass validation before it can be marked ready for payment',
      );
    }
    if (!detail.address) {
      throw new ForbiddenException(
        'Checkout requires an address before it can be marked ready for payment',
      );
    }
    const cart = await this.carts.findById(detail.session.cartId);
    if (!cart || detail.reservations.length < cart.items.length) {
      throw new ForbiddenException(
        'Every cart line must be reserved before checkout can be marked ready for payment',
      );
    }

    const pricingSnapshot = detail.latestTotals
      ? {
          currency: detail.latestTotals.currency,
          subtotal: detail.latestTotals.subtotal.toString(),
          discountTotal: detail.latestTotals.discountTotal.toString(),
          taxTotal: detail.latestTotals.taxTotal.toString(),
          shippingTotal: detail.latestTotals.shippingTotal.toString(),
          grandTotal: detail.latestTotals.grandTotal.toString(),
        }
      : { currency: detail.session.currency, grandTotal: detail.session.grandTotal.toString() };
    const shippingSnapshot = cart.shippingSelection
      ? {
          shippingMethodId: cart.shippingSelection.shippingMethodId,
          estimatedCost: cart.shippingSelection.estimatedCost.toString(),
        }
      : null;
    const addressSnapshot = {
      recipientName: detail.address.recipientName,
      phone: detail.address.phone,
      province: detail.address.province,
      city: detail.address.city,
      addressLine1: detail.address.addressLine1,
      addressLine2: detail.address.addressLine2,
      postalCode: detail.address.postalCode,
    };

    await this.sessions.freezeSnapshots(detail.session.id, {
      pricingSnapshot,
      shippingSnapshot,
      addressSnapshot,
    });
    await this.sessions.updateStatus(detail.session.id, 'READY_FOR_PAYMENT');
    return this.get(checkoutId, actor);
  }

  /** Resolves the caller's `customer.customers` row from their JWT
   * `userId` — used by the presentation layer to build a `CheckoutActor`/
   * `CartActor` for an authenticated request (ADR-007 decision 11). */
  async resolveCustomerId(userId: string): Promise<string | null> {
    const customer = await this.customers.findByUserId(userId);
    return customer?.id ?? null;
  }

  /**
   * ADR-007 explicitly reserved `CheckoutSession.status = CONVERTED` for
   * "once that checkout reaches `READY_FOR_PAYMENT` and payment
   * orchestration takes over (Phase 008)." Called by the payment
   * module's `PaymentModule` — via this real service, never a raw Prisma
   * write against `commerce.checkout_sessions` — the moment a
   * `PaymentTransaction` verifies successfully (ADR-008 decision 10).
   * Same idempotent-by-construction shape as `expire()`: converting an
   * already-`CONVERTED` session is a no-op, and a session that isn't in
   * `READY_FOR_PAYMENT` at all (already `CANCELLED`/`EXPIRED`) is left
   * alone rather than forced — a verified payment against a session that
   * expired out from under it is the payment module's own inconsistency
   * to surface, not something this method silently overrides.
   */
  async markConverted(checkoutId: string): Promise<CheckoutSessionWithDetail> {
    const detail = await this.sessions.findById(checkoutId);
    if (!detail) throw new NotFoundException('Checkout session not found');
    if (CheckoutStateMachine.isNoOp(detail.session.status, 'CONVERTED')) return detail;
    if (!CheckoutStateMachine.canTransition(detail.session.status, 'CONVERTED')) return detail;

    await this.sessions.updateStatus(detail.session.id, 'CONVERTED', { convertedAt: new Date() });
    const updated = await this.sessions.findById(checkoutId);
    if (!updated) throw new NotFoundException('Checkout session not found');
    return updated;
  }
}
