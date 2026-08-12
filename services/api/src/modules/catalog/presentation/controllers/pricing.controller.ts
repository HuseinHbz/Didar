import { asProductSkuId, type UserId } from '@iecp/types';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { PricingService } from '../../application/pricing.service';
import {
  ListPriceHistoryQueryDto,
  PriceHistoryPageResponseDto,
  ProductPriceResponseDto,
  SetPriceDto,
} from '../dto/pricing.dto';

/** blueprint §12/§13 — pricing foundation + audit trail. */
@ApiTags('admin/catalog/pricing')
@Controller('admin/catalog/skus/:skuId/price')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  @RequireModule('catalog')
  @ApiOkResponse({ type: ProductPriceResponseDto })
  async get(@Param('skuId', ParseUUIDPipe) skuId: string): Promise<ProductPriceResponseDto> {
    const price = await this.pricing.get(asProductSkuId(skuId));
    return ProductPriceResponseDto.fromDomain(price);
  }

  @Put()
  @RequirePermission('catalog.pricing.manage')
  @ApiOkResponse({ type: ProductPriceResponseDto })
  async set(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Body() dto: SetPriceDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<ProductPriceResponseDto> {
    const price = await this.pricing.setPrice(
      asProductSkuId(skuId),
      {
        basePrice: BigInt(dto.basePrice),
        compareAtPrice:
          dto.compareAtPrice === undefined
            ? undefined
            : dto.compareAtPrice === null
              ? null
              : BigInt(dto.compareAtPrice),
        costPrice:
          dto.costPrice === undefined
            ? undefined
            : dto.costPrice === null
              ? null
              : BigInt(dto.costPrice),
        currency: dto.currency,
        validFrom: dto.validFrom
          ? new Date(dto.validFrom)
          : dto.validFrom === null
            ? null
            : undefined,
        validTo: dto.validTo ? new Date(dto.validTo) : dto.validTo === null ? null : undefined,
        reason: dto.reason,
      },
      actorId,
    );
    return ProductPriceResponseDto.fromDomain(price);
  }

  @Get('history')
  @RequireModule('catalog')
  @ApiOkResponse({ type: PriceHistoryPageResponseDto })
  async history(
    @Param('skuId', ParseUUIDPipe) skuId: string,
    @Query() query: ListPriceHistoryQueryDto,
  ): Promise<PriceHistoryPageResponseDto> {
    const result = await this.pricing.listHistory(asProductSkuId(skuId), {
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return PriceHistoryPageResponseDto.fromResult(result);
  }
}
