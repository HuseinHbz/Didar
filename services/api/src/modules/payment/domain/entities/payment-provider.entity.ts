import { asPaymentProviderId, type PaymentProviderId } from '@iecp/types';

/** A registered gateway integration (ADR-008 decision 5) — `code` is the
 * key `PaymentProviderAdapterRegistry` resolves the real adapter
 * implementation on. `config` is non-secret operational settings only;
 * the actual merchant id/API key live in env vars, never here (ADR-008
 * decision 8). */
export class PaymentProvider {
  private constructor(
    public readonly id: PaymentProviderId,
    public readonly code: string,
    public readonly name: string,
    public readonly isActive: boolean,
    public readonly isSandbox: boolean,
    public readonly config: Record<string, unknown> | null,
    public readonly lastHealthCheckAt: Date | null,
    public readonly lastHealthCheckOk: boolean | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    code: string;
    name: string;
    isActive?: boolean;
    isSandbox?: boolean;
    config?: Record<string, unknown> | null;
    lastHealthCheckAt?: Date | null;
    lastHealthCheckOk?: boolean | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentProvider {
    return new PaymentProvider(
      asPaymentProviderId(props.id),
      props.code,
      props.name,
      props.isActive ?? true,
      props.isSandbox ?? true,
      props.config ?? null,
      props.lastHealthCheckAt ?? null,
      props.lastHealthCheckOk ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
