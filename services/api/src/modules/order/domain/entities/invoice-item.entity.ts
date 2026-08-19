import { asInvoiceId, asInvoiceItemId, type InvoiceId, type InvoiceItemId } from '@iecp/types';

export class InvoiceItem {
  private constructor(
    public readonly id: InvoiceItemId,
    public readonly invoiceId: InvoiceId,
    public readonly description: string,
    public readonly quantity: number,
    public readonly unitPrice: bigint,
    public readonly lineTotal: bigint,
  ) {}

  static create(props: {
    id: string;
    invoiceId: string;
    description: string;
    quantity: number;
    unitPrice: bigint;
    lineTotal: bigint;
  }): InvoiceItem {
    return new InvoiceItem(
      asInvoiceItemId(props.id),
      asInvoiceId(props.invoiceId),
      props.description,
      props.quantity,
      props.unitPrice,
      props.lineTotal,
    );
  }
}
