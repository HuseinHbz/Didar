import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { CurrentActor } from '../../../cart-checkout/presentation/decorators/current-actor.decorator';
import { ActorResolverGuard } from '../../../cart-checkout/presentation/guards/actor-resolver.guard';
import type { CartCheckoutActor } from '../../../cart-checkout/presentation/request-context';
import { PaymentIntentService } from '../../application/payment-intent.service';
import {
  CreatePaymentIntentDto,
  PaymentIntentResponseDto,
  StartPaymentResponseDto,
} from '../dto/payment-intent.dto';

/** Same `@Public()` + `ActorResolverGuard` shape `CheckoutController` uses
 * (reused directly, not reimplemented — a payment intent's owner is
 * exactly the checkout session's owner, customer or guest alike). */
@ApiTags('payments')
@Controller('payments/intents')
@Public()
@UseGuards(ActorResolverGuard)
export class PaymentIntentController {
  constructor(private readonly payments: PaymentIntentService) {}

  @Post()
  @ApiOkResponse({ type: PaymentIntentResponseDto })
  async create(
    @CurrentActor() actor: CartCheckoutActor,
    @Body() dto: CreatePaymentIntentDto,
  ): Promise<PaymentIntentResponseDto> {
    const intent = await this.payments.createIntent(
      dto.checkoutSessionId,
      dto.providerCode,
      actor,
      {
        idempotencyKey: dto.idempotencyKey,
      },
    );
    const detail = await this.payments.get(intent.id, actor);
    return PaymentIntentResponseDto.fromDomain(detail);
  }

  @Get(':id')
  @ApiOkResponse({ type: PaymentIntentResponseDto })
  async get(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<PaymentIntentResponseDto> {
    const detail = await this.payments.get(id, actor);
    return PaymentIntentResponseDto.fromDomain(detail);
  }

  @Post(':id/start')
  @ApiOkResponse({ type: StartPaymentResponseDto })
  async start(
    @CurrentActor() actor: CartCheckoutActor,
    @Param('id') id: string,
  ): Promise<StartPaymentResponseDto> {
    const result = await this.payments.startPayment(id, actor);
    const updated = await this.payments.get(id, actor);
    return {
      redirectUrl: result.redirectUrl,
      intent: PaymentIntentResponseDto.fromDomain(updated),
    };
  }
}
