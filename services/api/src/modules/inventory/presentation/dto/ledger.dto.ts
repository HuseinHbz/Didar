import type { InventoryMovementType } from '@iecp/types';
import { ApiProperty } from '@nestjs/swagger';

import type { InventoryLedgerEntry } from '../../domain/entities/inventory-ledger-entry.entity';

export class LedgerEntryResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) inventoryItemId!: string;
  @ApiProperty({ format: 'uuid' }) productSkuId!: string;
  @ApiProperty({ format: 'uuid' }) warehouseId!: string;
  @ApiProperty({ format: 'uuid' }) locationId!: string;
  @ApiProperty() movementType!: InventoryMovementType;
  @ApiProperty() quantity!: number;
  @ApiProperty() beforeOnHand!: number;
  @ApiProperty() afterOnHand!: number;
  @ApiProperty() beforeReserved!: number;
  @ApiProperty() afterReserved!: number;
  @ApiProperty({ nullable: true }) referenceType!: string | null;
  @ApiProperty({ nullable: true }) referenceId!: string | null;
  @ApiProperty({ nullable: true }) reason!: string | null;
  @ApiProperty({ nullable: true, format: 'uuid' }) actorUserId!: string | null;
  @ApiProperty() correlationId!: string;
  @ApiProperty() createdAt!: Date;

  static fromDomain(entry: InventoryLedgerEntry): LedgerEntryResponseDto {
    const dto = new LedgerEntryResponseDto();
    dto.id = entry.id;
    dto.inventoryItemId = entry.inventoryItemId;
    dto.productSkuId = entry.productSkuId;
    dto.warehouseId = entry.warehouseId;
    dto.locationId = entry.locationId;
    dto.movementType = entry.movementType;
    dto.quantity = entry.quantity;
    dto.beforeOnHand = entry.beforeOnHand;
    dto.afterOnHand = entry.afterOnHand;
    dto.beforeReserved = entry.beforeReserved;
    dto.afterReserved = entry.afterReserved;
    dto.referenceType = entry.referenceType;
    dto.referenceId = entry.referenceId;
    dto.reason = entry.reason;
    dto.actorUserId = entry.actorUserId;
    dto.correlationId = entry.correlationId;
    dto.createdAt = entry.createdAt;
    return dto;
  }
}

export class LedgerPageResponseDto {
  @ApiProperty({ type: [LedgerEntryResponseDto] }) items!: LedgerEntryResponseDto[];
  @ApiProperty({ nullable: true }) nextCursor!: string | null;

  static fromResult(result: {
    items: InventoryLedgerEntry[];
    nextCursor: string | null;
  }): LedgerPageResponseDto {
    const dto = new LedgerPageResponseDto();
    dto.items = result.items.map((item) => LedgerEntryResponseDto.fromDomain(item));
    dto.nextCursor = result.nextCursor;
    return dto;
  }
}
