import {
  asCreditNoteId,
  asCreditNoteLineId,
  type CreditNoteId,
  type CreditNoteLineId,
} from '@iecp/types';

export class CreditNoteLine {
  private constructor(
    public readonly id: CreditNoteLineId,
    public readonly creditNoteId: CreditNoteId,
    public readonly description: string,
    public readonly quantity: number,
    public readonly unitPrice: bigint,
    public readonly lineTotal: bigint,
  ) {}

  static create(props: {
    id: string;
    creditNoteId: string;
    description: string;
    quantity: number;
    unitPrice: bigint;
    lineTotal: bigint;
  }): CreditNoteLine {
    return new CreditNoteLine(
      asCreditNoteLineId(props.id),
      asCreditNoteId(props.creditNoteId),
      props.description,
      props.quantity,
      props.unitPrice,
      props.lineTotal,
    );
  }
}
