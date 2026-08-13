import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { PaymentIntentService } from '../../application/payment-intent.service';
import { PaymentCallbackResponseDto } from '../dto/callback.dto';

/**
 * ZarinPal's redirect return — the customer's browser bouncing back to
 * `callback_url?Authority=...&Status=OK|NOK` (ADR-008 decision 3: this
 * request itself proves nothing, `PaymentIntentService.handleCallback()`
 * always re-derives the real outcome through a server-to-server
 * `verifyPayment()` call). `@Public()`: the gateway calling this endpoint
 * carries no Bearer token, and never could — receiving it is the whole
 * point of this route existing.
 */
@ApiTags('payments')
@Controller('payments/callback')
@Public()
export class PaymentCallbackController {
  constructor(private readonly payments: PaymentIntentService) {}

  @Get(':providerCode')
  @ApiOkResponse({ type: PaymentCallbackResponseDto })
  async handle(
    @Param('providerCode') providerCode: string,
    @Query() query: Record<string, unknown>,
  ): Promise<PaymentCallbackResponseDto> {
    const intent = await this.payments.handleCallback(providerCode, query);
    return { paymentIntentId: intent?.id ?? null, status: intent?.status ?? 'UNKNOWN' };
  }
}
