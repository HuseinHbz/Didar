import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { InvalidAdjustmentError } from '../../domain/services/adjustment-validator';
import { InsufficientStockError } from '../../domain/services/available-quantity-calculator';
import { InvalidReservationOperationError } from '../../domain/services/reservation-rules';
import { InvalidTransferTransitionError } from '../../domain/services/transfer-state-machine';

/**
 * Maps the inventory domain layer's own error types to real HTTP status
 * codes — same pattern as `modules/catalog`'s
 * `CatalogDomainExceptionFilter` (its own doc comment explains why this
 * project doesn't yet have a general error-shape standardization, and why
 * that's an accepted, documented gap rather than this filter's job to
 * close). `InsufficientStockError` is the concurrency-safety net's actual
 * failure mode (ADR-006 decisions 3-4) — a 409, not a 500, is what proves
 * the never-negative invariant is enforced rather than crashing.
 */
@Catch(
  InsufficientStockError,
  InvalidReservationOperationError,
  InvalidTransferTransitionError,
  InvalidAdjustmentError,
)
export class InventoryDomainExceptionFilter implements ExceptionFilter {
  catch(
    exception:
      | InsufficientStockError
      | InvalidReservationOperationError
      | InvalidTransferTransitionError
      | InvalidAdjustmentError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof InsufficientStockError ||
      exception instanceof InvalidTransferTransitionError
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST;
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error: exception.name,
    });
  }
}
