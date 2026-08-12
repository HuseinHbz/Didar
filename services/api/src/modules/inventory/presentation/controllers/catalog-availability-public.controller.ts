import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { StockQueryService } from '../../application/stock-query.service';
import { SkuAvailabilityResponseDto, StoreAvailabilityResponseDto } from '../dto/stock.dto';

/** `GET /catalog/products/:slug/availability` + `/stores` — the brief's
 * exact public endpoint list. `@Public()`: storefront browsing needs no
 * auth, same convention `modules/catalog`'s own public controller uses.
 * Coexists with `modules/catalog`'s `CatalogPublicController` under the
 * same `/catalog/products/:slug` prefix — distinct sub-paths
 * (`/availability`, `/stores` vs. the bare product read), no route
 * collision. */
@ApiTags('catalog/products/availability')
@Controller('catalog/products')
@Public()
export class CatalogAvailabilityPublicController {
  constructor(private readonly stock: StockQueryService) {}

  @Get(':slug/availability')
  @ApiOkResponse({ type: [SkuAvailabilityResponseDto] })
  async getAvailability(@Param('slug') slug: string): Promise<SkuAvailabilityResponseDto[]> {
    const results = await this.stock.getProductAvailability(slug);
    return results.map((result) => SkuAvailabilityResponseDto.fromDomain(result));
  }

  @Get(':slug/stores')
  @ApiOkResponse({ type: [StoreAvailabilityResponseDto] })
  getStores(
    @Param('slug') slug: string,
  ): Promise<{ warehouseId: string; availableQuantity: number }[]> {
    return this.stock.getProductStoreAvailability(slug);
  }
}
