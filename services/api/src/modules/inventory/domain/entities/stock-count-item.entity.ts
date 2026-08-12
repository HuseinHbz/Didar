import {
  asProductSkuId,
  asStockCountId,
  asStockCountItemId,
  type ProductSkuId,
  type StockCountId,
  type StockCountItemId,
} from '@iecp/types';

export class StockCountItem {
  private constructor(
    public readonly id: StockCountItemId,
    public readonly stockCountId: StockCountId,
    public readonly productSkuId: ProductSkuId,
    public readonly expectedQuantity: number,
    public readonly countedQuantity: number | null,
    public readonly variance: number | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static create(props: {
    id: string;
    stockCountId: string;
    productSkuId: string;
    expectedQuantity: number;
    countedQuantity?: number | null;
    variance?: number | null;
    createdAt: Date;
    updatedAt: Date;
  }): StockCountItem {
    return new StockCountItem(
      asStockCountItemId(props.id),
      asStockCountId(props.stockCountId),
      asProductSkuId(props.productSkuId),
      props.expectedQuantity,
      props.countedQuantity ?? null,
      props.variance ?? null,
      props.createdAt,
      props.updatedAt,
    );
  }
}
