import { ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import {
  AddressNotFoundError,
  AddressOwnershipError,
  CustomerNotFoundError,
  PrescriptionNotApprovedError,
  PrescriptionNotFoundError,
  PrescriptionOwnershipError,
  PrescriptionVersionConflictError,
} from '../../domain/services/customer-domain-errors';
import { InvalidPrescriptionMeasurementError } from '../../domain/services/eye-measurement-validator';
import { InvalidPrescriptionTransitionError } from '../../domain/services/prescription-state-machine';

/**
 * Maps this module's domain-layer errors to real HTTP statuses — same
 * `@Catch()`-scoped-filter convention `ReturnDomainExceptionFilter`
 * establishes. `*NotFoundError`/`*OwnershipError` are both 404
 * deliberately (see `AddressOwnershipError`'s own doc comment: probing
 * someone else's resource id must be indistinguishable from probing a
 * nonexistent one). Transition/version-conflict/not-approved errors are
 * 409 — real state conflicts, not malformed requests, the same
 * reasoning `InvalidReturnTransitionError` already gets.
 * `InvalidPrescriptionMeasurementError` is 400 — a well-formed but
 * out-of-bounds measurement value, caught before it ever reaches a
 * repository.
 */
@Catch(
  CustomerNotFoundError,
  AddressNotFoundError,
  AddressOwnershipError,
  PrescriptionNotFoundError,
  PrescriptionOwnershipError,
  InvalidPrescriptionTransitionError,
  PrescriptionVersionConflictError,
  PrescriptionNotApprovedError,
  InvalidPrescriptionMeasurementError,
)
export class CustomerDomainExceptionFilter implements ExceptionFilter {
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
      exception instanceof CustomerNotFoundError ||
      exception instanceof AddressNotFoundError ||
      exception instanceof AddressOwnershipError ||
      exception instanceof PrescriptionNotFoundError ||
      exception instanceof PrescriptionOwnershipError
    ) {
      return HttpStatus.NOT_FOUND;
    }
    if (
      exception instanceof InvalidPrescriptionTransitionError ||
      exception instanceof PrescriptionVersionConflictError ||
      exception instanceof PrescriptionNotApprovedError
    ) {
      return HttpStatus.CONFLICT;
    }
    return HttpStatus.BAD_REQUEST;
  }
}
