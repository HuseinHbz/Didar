import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import {
  CouponNotApplicableError,
  CouponUsageLimitExceededError,
  InvalidCouponTransitionError,
  InvalidPromotionTransitionError,
} from '../../domain/errors/promotion-domain.errors';

/**
 * Maps this module's own domain-layer error types to real HTTP status
 * codes — same `@Catch()`-scoped-filter convention `CatalogDomain
 * ExceptionFilter`/`InventoryDomainExceptionFilter` already established,
 * so `/admin/promotions`/`/admin/coupons` never surface a domain
 * rejection as an unhandled 500. `CouponNotApplicableError`/
 * `CouponUsageLimitExceededError` are also caught by
 * `CartCheckoutDomainExceptionFilter` for the customer-facing
 * `/cart/coupon`/`/checkout/:id/ready-for-payment` routes — this filter
 * covers the admin-only transition errors those routes never throw.
 */
@Catch(
  InvalidPromotionTransitionError,
  InvalidCouponTransitionError,
  CouponNotApplicableError,
  CouponUsageLimitExceededError,
)
export class PromotionDomainExceptionFilter implements ExceptionFilter {
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
    if (
      exception instanceof InvalidPromotionTransitionError ||
      exception instanceof InvalidCouponTransitionError
    ) {
      return HttpStatus.CONFLICT;
    }
    if (exception instanceof CouponUsageLimitExceededError) return HttpStatus.CONFLICT;
    return HttpStatus.BAD_REQUEST;
  }
}
