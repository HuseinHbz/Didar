import { ApiProperty } from '@nestjs/swagger';

/** No frontend/storefront UI exists yet (same "backend-only this phase"
 * scope decision `docs/adr/ADR-005-catalog-architecture.md` made) — the
 * redirect return is answered with JSON describing the outcome rather
 * than a browser redirect to an order-confirmation page. */
export class PaymentCallbackResponseDto {
  @ApiProperty({ nullable: true, format: 'uuid' }) paymentIntentId!: string | null;
  @ApiProperty() status!: string;
}
