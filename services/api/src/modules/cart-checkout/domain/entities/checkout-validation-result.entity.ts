import {
  asCheckoutSessionId,
  asCheckoutValidationResultId,
  type CheckoutSessionId,
  type CheckoutValidationIssueCode,
  type CheckoutValidationOutcome,
  type CheckoutValidationResultId,
} from '@iecp/types';

export interface CheckoutValidationIssue {
  code: CheckoutValidationIssueCode;
  message: string;
  productSkuId?: string;
}

/** Append-only — one row per `POST /checkout/:id/validate` call. */
export class CheckoutValidationResult {
  private constructor(
    public readonly id: CheckoutValidationResultId,
    public readonly checkoutSessionId: CheckoutSessionId,
    public readonly outcome: CheckoutValidationOutcome,
    public readonly issues: readonly CheckoutValidationIssue[],
    public readonly validatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    checkoutSessionId: string;
    outcome: CheckoutValidationOutcome;
    issues: readonly CheckoutValidationIssue[];
    validatedAt: Date;
  }): CheckoutValidationResult {
    return new CheckoutValidationResult(
      asCheckoutValidationResultId(props.id),
      asCheckoutSessionId(props.checkoutSessionId),
      props.outcome,
      props.issues,
      props.validatedAt,
    );
  }

  get passed(): boolean {
    return this.outcome === 'PASSED';
  }
}
