import { ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import {
  CouponNotApplicableError,
  CouponUsageLimitExceededError,
} from '../../../promotion/domain/errors/promotion-domain.errors';
import { InvalidQuantityError } from '../../domain/services/cart-quantity-rules';
import { InvalidCheckoutTransitionError } from '../../domain/services/checkout-state-machine';
import { NegativeTotalError } from '../../domain/services/pricing-resolver';
import { ShippingMethodUnavailableError } from '../../domain/services/shipping-calculator';

/**
 * Maps this module's domain-layer error types to real HTTP status codes —
 * same `@Catch()`-scoped-filter convention `InventoryDomainExceptionFilter`/
 * `CatalogDomainExceptionFilter` already established, so a domain-layer
 * rejection never surfaces as an unhandled 500.
 *
 * `InvalidCheckoutTransitionError` gets special handling: a same-status
 * no-op (`CheckoutStateMachine.isNoOp`) is never actually thrown by the
 * application layer (it returns early instead — see `CheckoutService`),
 * so every instance that reaches this filter is a genuine illegal
 * transition, mapped to 409, not 400 — the resource exists and the
 * request is well-formed, it's just not a legal move from its current
 * state (the same distinction the brief's own checkout_session.statuses
 * state machine implies).
 */
@Catch(
  InvalidQuantityError,
  CouponNotApplicableError,
  CouponUsageLimitExceededError,
  ShippingMethodUnavailableError,
  InvalidCheckoutTransitionError,
  NegativeTotalError,
)
export class CartCheckoutDomainExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = this.statusFor(exception);
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error: exception.name,
    });
  }

  private statusFor(exception: Error): number {
    if (exception instanceof InvalidCheckoutTransitionError) return HttpStatus.CONFLICT;
    if (exception instanceof CouponUsageLimitExceededError) return HttpStatus.CONFLICT;
    if (exception instanceof NegativeTotalError) return HttpStatus.INTERNAL_SERVER_ERROR;
    return HttpStatus.BAD_REQUEST;
  }
}
