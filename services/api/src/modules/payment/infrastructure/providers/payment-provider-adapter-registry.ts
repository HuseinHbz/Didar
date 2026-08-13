import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../../../config/env';
import type {
  PaymentProviderAdapter,
  PaymentProviderAdapterRegistry,
} from '../../domain/ports/payment-provider-adapter.port';
import { UnknownPaymentProviderError } from '../../domain/ports/payment-provider-adapter.port';

import { ZarinpalAdapter } from './zarinpal.adapter';

/**
 * The concrete `PaymentProviderAdapterRegistry` (ADR-008 decision 5) —
 * one real adapter today (`zarinpal`), constructed fresh per `resolve()`
 * call so a provider row's `isSandbox` flag always picks the right base
 * URL, never cached across a flag flip. Adding a second gateway is
 * adding one more `case` here and implementing `PaymentProviderAdapter`
 * again — no other application-layer code changes.
 */
@Injectable()
export class PaymentProviderAdapterRegistryImpl implements PaymentProviderAdapterRegistry {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  resolve(provider: { code: string; isSandbox: boolean }): PaymentProviderAdapter {
    switch (provider.code) {
      case 'zarinpal':
        return new ZarinpalAdapter({
          merchantId: this.config.get('PAYMENT_ZARINPAL_MERCHANT_ID', { infer: true }),
          isSandbox: provider.isSandbox,
        });
      default:
        throw new UnknownPaymentProviderError(provider.code);
    }
  }
}
