import { ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import {
  NonPositiveFulfillmentQuantityError,
  OverFulfillmentError,
} from '../../domain/services/fulfillment-quantity-validator';
import { InvalidFulfillmentTransitionError } from '../../domain/services/fulfillment-state-machine';
import { InvalidInvoiceTransitionError } from '../../domain/services/invoice-state-machine';
import { InvalidOrderTransitionError } from '../../domain/services/order-state-machine';
import { InvalidShipmentTransitionError } from '../../domain/services/shipment-state-machine';

/**
 * Maps this module's domain-layer error types to real HTTP status codes —
 * same `@Catch()`-scoped-filter convention `PaymentDomainExceptionFilter`/
 * `CartCheckoutDomainExceptionFilter` established, so a domain-layer
 * rejection never surfaces as an unhandled 500. A transition error is
 * always a genuine illegal move from the current state (409, not 400) —
 * every no-op case is handled by the application layer's own
 * `isNoOp`/`canTransition` checks before a transition error could ever be
 * thrown. `OverFulfillmentError` is 409 (a real state conflict — the
 * remaining quantity has already changed under the caller); a malformed
 * request quantity is 400.
 */
@Catch(
  InvalidOrderTransitionError,
  InvalidFulfillmentTransitionError,
  InvalidInvoiceTransitionError,
  InvalidShipmentTransitionError,
  OverFulfillmentError,
  NonPositiveFulfillmentQuantityError,
)
export class OrderDomainExceptionFilter implements ExceptionFilter {
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
      exception instanceof InvalidOrderTransitionError ||
      exception instanceof InvalidFulfillmentTransitionError ||
      exception instanceof InvalidInvoiceTransitionError ||
      exception instanceof InvalidShipmentTransitionError ||
      exception instanceof OverFulfillmentError
    ) {
      return HttpStatus.CONFLICT;
    }
    return HttpStatus.BAD_REQUEST;
  }
}
