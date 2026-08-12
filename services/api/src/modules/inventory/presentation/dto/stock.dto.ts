import { ApiProperty } from '@nestjs/swagger';

import type { SkuAvailability } from '../../application/stock-query.service';
import type { InventoryItem } from '../../domain/entities/inventory-item.entity';
import type { StockBySkuRow } from '../../domain/ports/inventory-item.repository.port';

export class InventoryItemResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty() onHandQuantity!: number;
  @ApiProperty() reservedQuantity!: number;
  @ApiProperty() availableQuantity!: number;
  @ApiProperty() inTransitQuantity!: number;
  @ApiProperty() damagedQuantity!: number;
  @ApiProperty() quarantinedQuantity!: number;
  @ApiProperty() blockedQuantity!: number;
  @ApiProperty() version!: number;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromDomain(item: InventoryItem): InventoryItemResponseDto {
    const dto = new InventoryItemResponseDto();
    dto.id = item.id;
    dto.productSkuId = item.productSkuId;
    dto.warehouseId = item.warehouseId;
    dto.locationId = item.locationId;
    dto.onHandQuantity = item.onHandQuantity;
    dto.reservedQuantity = item.reservedQuantity;
    dto.availableQuantity = item.availableQuantity;
    dto.inTransitQuantity = item.inTransitQuantity;
    dto.damagedQuantity = item.damagedQuantity;
    dto.quarantinedQuantity = item.quarantinedQuantity;
    dto.blockedQuantity = item.blockedQuantity;
    dto.version = item.version;
    dto.createdAt = item.createdAt;
    dto.updatedAt = item.updatedAt;
    return dto;
  }
}

export class InventoryItemPageResponseDto {
  @ApiProperty({ type: [InventoryItemResponseDto] }) items!: InventoryItemResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: InventoryItem[];
    nextCursor: string | null;
  }): InventoryItemPageResponseDto {
    const dto = new InventoryItemPageResponseDto();
    dto.items = result.items.map((item) => InventoryItemResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}

export class StockBySkuRowDto {
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty() onHandQuantity!: number;
  @ApiProperty() reservedQuantity!: number;
  @ApiProperty() availableQuantity!: number;
  @ApiProperty() inTransitQuantity!: number;
  @ApiProperty() damagedQuantity!: number;
  @ApiProperty() quarantinedQuantity!: number;
  @ApiProperty() blockedQuantity!: number;
}

export class SkuAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty() totalAvailableQuantity!: number;
  @ApiProperty({ type: [StockBySkuRowDto] }) byWarehouse!: StockBySkuRowDto[];

  static fromDomain(result: SkuAvailability): SkuAvailabilityResponseDto {
    const dto = new SkuAvailabilityResponseDto();
    dto.productSkuId = result.productSkuId;
    dto.totalAvailableQuantity = result.totalAvailableQuantity;
    dto.byWarehouse = result.byWarehouse.map((row: StockBySkuRow) => ({ ...row }));
    return dto;
  }
}

export class StoreAvailabilityResponseDto {
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty() availableQuantity!: number;
}

export class SkuLookupResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() skuCode!: string;
  @ApiProperty({ nullable: true }) barcode!: string | null;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty() productSlug!: string;
}
