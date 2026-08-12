import {
  asProductSkuId,
  asStockTransferId,
  asStockTransferItemId,
  type ProductSkuId,
  type StockTransferId,
  type StockTransferItemId,
} from '@iecp/types';

export class StockTransferItem {
  private constructor(
    public readonly id: StockTransferItemId,
    public readonly transferId: StockTransferId,
    public readonly productSkuId: ProductSkuId,
    public readonly requestedQuantity: number,
    public readonly approvedQuantity: number | null,
    public readonly dispatchedQuantity: number | null,
    public readonly receivedQuantity: number | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    transferId: string;
    productSkuId: string;
    requestedQuantity: number;
    approvedQuantity?: number | null;
    dispatchedQuantity?: number | null;
    receivedQuantity?: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): StockTransferItem {
    return new StockTransferItem(
      asStockTransferItemId(props.id),
      asStockTransferId(props.transferId),
      asProductSkuId(props.productSkuId),
      props.requestedQuantity,
      props.approvedQuantity ?? null,
      props.dispatchedQuantity ?? null,
      props.receivedQuantity ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }

  /** Still awaiting receipt — the outstanding quantity a
   * `PARTIALLY_RECEIVED` transfer still owes this line. */
  get outstandingQuantity(): number {
    const dispatched = this.dispatchedQuantity ?? this.approvedQuantity ?? this.requestedQuantity;
    return Math.max(dispatched - (this.receivedQuantity ?? 0), 0);
  }
}
