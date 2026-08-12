import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { InvalidAttributeValueError } from '../../domain/services/attribute-value-validator';
import { InvalidPriceError } from '../../domain/services/price-validator';
import { InvalidProductTransitionError } from '../../domain/services/product-lifecycle-state-machine';

/**
 * Maps the catalog domain layer's own error types to real HTTP status
 * codes. Without this, `ProductLifecycleStateMachine.assertTransition`
 * (etc.) throwing a plain `Error` subclass — deliberately not a NestJS
 * `HttpException`, since the domain layer must not depend on a web
 * framework — would fall through to Nest's default handler as an
 * unhandled exception (a bare 500), not the 409/400 a caller needs to
 * branch on. `docs/api/README.md` already flags that this project has no
 * general error-shape standardization yet ("Add a global ExceptionFilter
 * ... before the first real domain module ships error responses clients
 * need to branch on"); this is deliberately scoped to just the three
 * error types this module's domain layer actually throws, not an attempt
 * at that larger, still-open piece of work.
 */
@Catch(InvalidProductTransitionError, InvalidPriceError, InvalidAttributeValueError)
export class CatalogDomainExceptionFilter implements ExceptionFilter {
  catch(
    exception: InvalidProductTransitionError | InvalidPriceError | InvalidAttributeValueError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof InvalidProductTransitionError
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST;
    response.status(status).json({
      statusCode: status,
      message: exception.message,
      error: exception.name,
    });
  }
}
