import { ArgumentsHost, Catch, type ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { InvalidCreditNoteTransitionError } from '../../domain/services/credit-note-state-machine';
import {
  CreditNoteExceedsRefundableAmountError,
  CreditNoteGrandTotalMismatchError,
  CreditNoteLineSumMismatchError,
  NonPositiveCreditNoteAmountError,
} from '../../domain/services/credit-note-validator';
import { ReturnNotEligibleError } from '../../domain/services/return-eligibility-validator';
import {
  NonPositiveReturnQuantityError,
  OverReturnedError,
} from '../../domain/services/return-quantity-validator';
import {
  MissingImmutableSnapshotError,
  NonPositiveRestockQuantityError,
} from '../../domain/services/return-settlement-invariants';
import { InvalidReturnSettlementTransitionError } from '../../domain/services/return-settlement-state-machine';
import { InvalidReturnTransitionError } from '../../domain/services/return-state-machine';

/**
 * Maps this module's domain-layer error types to real HTTP status codes —
 * same `@Catch()`-scoped-filter convention `OrderDomainExceptionFilter`
 * established. A transition error is always a genuine illegal move from
 * the current state (409, not 400) — every no-op case is handled by the
 * application layer's own `isNoOp` checks before a transition error could
 * ever be thrown. `OverReturnedError` is 409 (a real state conflict —
 * the remaining returnable quantity has already changed under the
 * caller, same `OverFulfillmentError` reasoning); a malformed request
 * quantity is 400. `ReturnNotEligibleError` is 409 — the order/items
 * exist and the request is well-formed, they just aren't eligible right
 * now, the same "real conflict, not a validation error" shape
 * `OrderNotReadyToCompleteError` uses. The three `CreditNoteValidator`
 * errors are 500 — they only ever fire against server-computed values
 * (never client input), so if one ever throws it means a genuine
 * internal-consistency bug, not a bad request.
 *
 * ADR-013 additions: `InvalidReturnSettlementTransitionError` is 409 —
 * a premature settlement action (e.g. requesting the refund before
 * restock has completed), the same "real conflict, not a bad request"
 * shape every other transition error here already gets.
 * `MissingImmutableSnapshotError`/`NonPositiveRestockQuantityError` are
 * 500, same reasoning as the `CreditNoteValidator` errors: both only
 * ever fire against already-validated server data (a `ReturnItem`'s
 * own snapshot/quantity), never fresh client input.
 */
@Catch(
  InvalidReturnTransitionError,
  OverReturnedError,
  NonPositiveReturnQuantityError,
  ReturnNotEligibleError,
  InvalidCreditNoteTransitionError,
  CreditNoteLineSumMismatchError,
  CreditNoteGrandTotalMismatchError,
  CreditNoteExceedsRefundableAmountError,
  NonPositiveCreditNoteAmountError,
  InvalidReturnSettlementTransitionError,
  MissingImmutableSnapshotError,
  NonPositiveRestockQuantityError,
)
export class ReturnDomainExceptionFilter implements ExceptionFilter {
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
      exception instanceof InvalidReturnTransitionError ||
      exception instanceof OverReturnedError ||
      exception instanceof ReturnNotEligibleError ||
      exception instanceof InvalidCreditNoteTransitionError ||
      exception instanceof InvalidReturnSettlementTransitionError
    ) {
      return HttpStatus.CONFLICT;
    }
    if (
      exception instanceof CreditNoteLineSumMismatchError ||
      exception instanceof CreditNoteGrandTotalMismatchError ||
      exception instanceof CreditNoteExceedsRefundableAmountError ||
      exception instanceof NonPositiveCreditNoteAmountError ||
      exception instanceof MissingImmutableSnapshotError ||
      exception instanceof NonPositiveRestockQuantityError
    ) {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }
    return HttpStatus.BAD_REQUEST;
  }
}
