import { ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { UnknownPaymentProviderError } from '../../domain/ports/payment-provider-adapter.port';
import { InvalidPaymentAttemptTransitionError } from '../../domain/services/payment-attempt-state-machine';
import { InvalidPaymentIntentTransitionError } from '../../domain/services/payment-intent-state-machine';
import { InvalidPaymentTransactionTransitionError } from '../../domain/services/payment-transaction-state-machine';
import { InvalidRefundTransitionError } from '../../domain/services/refund-state-machine';
import {
  NonPositiveRefundAmountError,
  RefundExceedsTransactionAmountError,
} from '../../domain/services/refund-validator';

/**
 * Maps this module's domain-layer error types to real HTTP status codes —
 * same `@Catch()`-scoped-filter convention `CartCheckoutDomainExceptionFilter`/
 * `InventoryDomainExceptionFilter` established, so a domain-layer
 * rejection never surfaces as an unhandled 500. A transition error is
 * always a genuine illegal move from the current state (409, not 400) —
 * every no-op case is handled by the application layer's own
 * `isNoOp`/`canTransition` checks before a transition error could ever
 * be thrown, same reasoning `CartCheckoutDomainExceptionFilter`'s own doc
 * comment gives for `InvalidCheckoutTransitionError`.
 */
@Catch(
  InvalidPaymentIntentTransitionError,
  InvalidPaymentAttemptTransitionError,
  InvalidPaymentTransactionTransitionError,
  InvalidRefundTransitionError,
  RefundExceedsTransactionAmountError,
  NonPositiveRefundAmountError,
  UnknownPaymentProviderError,
)
export class PaymentDomainExceptionFilter implements ExceptionFilter {
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
      exception instanceof InvalidPaymentIntentTransitionError ||
      exception instanceof InvalidPaymentAttemptTransitionError ||
      exception instanceof InvalidPaymentTransactionTransitionError ||
      exception instanceof InvalidRefundTransitionError
    ) {
      return HttpStatus.CONFLICT;
    }
    if (exception instanceof UnknownPaymentProviderError) return HttpStatus.NOT_FOUND;
    return HttpStatus.BAD_REQUEST;
  }
}
