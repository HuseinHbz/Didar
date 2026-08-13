import type { PaymentProvider } from '../entities/payment-provider.entity';

export const PAYMENT_PROVIDER_REPOSITORY = Symbol('PAYMENT_PROVIDER_REPOSITORY');

export interface PaymentProviderRepositoryPort {
  findById(id: string): Promise<PaymentProvider | null>;
  findByCode(code: string): Promise<PaymentProvider | null>;
  listActive(): Promise<PaymentProvider[]>;

  /** Backs `PaymentProviderAdapter.healthCheck()` results (ADR-008
   * decision 5) — written by the `payment_health_check` sweep, never by
   * request-path code. */
  recordHealthCheck(id: string, props: { ok: boolean; checkedAt: Date }): Promise<PaymentProvider>;
}
