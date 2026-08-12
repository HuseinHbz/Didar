import type { ProductSkuId, UserId } from '@iecp/types';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepositoryPort,
} from '../../identity/domain/ports/audit-log.repository.port';
import { PriceHistoryEntry } from '../domain/entities/price-history-entry.entity';
import { ProductPrice } from '../domain/entities/product-price.entity';
import {
  PRICING_REPOSITORY,
  type PricingRepositoryPort,
} from '../domain/ports/pricing.repository.port';
import { PriceValidator } from '../domain/services/price-validator';

import type { BulkOperationResult } from './products.service';

export interface SetPriceInput {
  basePrice: bigint;
  compareAtPrice?: bigint | null;
  costPrice?: bigint | null;
  currency?: string;
  validFrom?: Date | null;
  validTo?: Date | null;
  reason?: string | null;
}

/** blueprint §12/§13 — pricing foundation + audit trail. Every write goes
 * through PriceValidator first and writes a `system.AuditLog` row
 * (`PRODUCT_PRICE_CHANGED` — the exact action name identity's
 * `AuditLogEntry` doc comment uses as its own worked example) on top of the
 * dedicated `finance.PriceHistory` row PricingRepositoryPort already
 * appends — the two serve different audiences: PriceHistory is the
 * pricing-domain's own ledger, AuditLog is the cross-domain "who changed
 * what, when" record blueprint §54 asks for. */
@Injectable()
export class PricingService {
  constructor(
    @Inject(PRICING_REPOSITORY) private readonly pricing: PricingRepositoryPort,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepositoryPort,
  ) {}

  async get(skuId: ProductSkuId): Promise<ProductPrice> {
    const price = await this.pricing.findBySkuId(skuId);
    if (!price) throw new NotFoundException('No price set for this SKU yet');
    return price;
  }

  async setPrice(
    skuId: ProductSkuId,
    input: SetPriceInput,
    actorId: UserId,
  ): Promise<ProductPrice> {
    PriceValidator.validate(input);

    const previous = await this.pricing.findBySkuId(skuId);
    const price = await this.pricing.setPrice({
      productSkuId: skuId,
      ...input,
      changedBy: actorId,
    });

    await this.auditLog.record({
      actorId,
      action: 'PRODUCT_PRICE_CHANGED',
      entityType: 'ProductSku',
      entityId: skuId,
      oldValue: previous ? { basePrice: previous.basePrice.toString() } : null,
      newValue: { basePrice: price.basePrice.toString() },
    });

    return price;
  }

  async bulkSetPrice(
    items: { skuId: ProductSkuId; input: SetPriceInput }[],
    actorId: UserId,
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = { succeeded: [], failed: [] };
    for (const item of items) {
      try {
        await this.setPrice(item.skuId, item.input, actorId);
        result.succeeded.push(item.skuId);
      } catch (error) {
        result.failed.push({
          id: item.skuId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    return result;
  }

  listHistory(
    skuId: ProductSkuId,
    pagination: { cursor?: string; limit: number },
  ): Promise<{ items: PriceHistoryEntry[]; nextCursor: string | null }> {
    return this.pricing.listHistory(skuId, pagination);
  }
}
