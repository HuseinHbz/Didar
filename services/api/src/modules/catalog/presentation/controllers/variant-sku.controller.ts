import { asProductId, asProductSkuId, asProductVariantId } from '@iecp/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { SkusService } from '../../application/skus.service';
import { VariantsService } from '../../application/variants.service';
import { CreateSkuDto, SkuResponseDto, UpdateSkuDto } from '../dto/sku.dto';
import { CreateVariantDto, UpdateVariantDto, VariantResponseDto } from '../dto/variant.dto';

/** Phase 005 — variant (merchandising) + SKU (sellable unit) admin
 * surface. See ADR-005 decision 1 for why they're two resources. Real,
 * tested CRUD sufficient to drive the create->publish workflow; see
 * services/api/src/modules/catalog/README.md's "Presentation layer scope"
 * for what's deliberately not exposed as a full standalone resource this
 * pass (e.g. a dedicated variant-listing endpoint beyond by-product). */
@ApiTags('admin/catalog/variants-skus')
@Controller('admin/catalog')
export class VariantSkuController {
  constructor(
    private readonly variants: VariantsService,
    private readonly skus: SkusService,
  ) {}

  @Get('products/:productId/variants')
  @RequireModule('catalog')
  @ApiOkResponse({ type: [VariantResponseDto] })
  async listVariants(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<VariantResponseDto[]> {
    const variants = await this.variants.listByProduct(asProductId(productId));
    return variants.map((item) => VariantResponseDto.fromDomain(item));
  }

  @Post('variants')
  @RequirePermission('catalog.variants.manage')
  @ApiOkResponse({ type: VariantResponseDto })
  async createVariant(@Body() dto: CreateVariantDto): Promise<VariantResponseDto> {
    const variant = await this.variants.create(dto);
    return VariantResponseDto.fromDomain(variant);
  }

  @Patch('variants/:id')
  @RequirePermission('catalog.variants.manage')
  @ApiOkResponse({ type: VariantResponseDto })
  async updateVariant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVariantDto,
  ): Promise<VariantResponseDto> {
    const variant = await this.variants.update(asProductVariantId(id), dto);
    return VariantResponseDto.fromDomain(variant);
  }

  @Delete('variants/:id')
  @RequirePermission('catalog.variants.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVariant(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.variants.delete(asProductVariantId(id));
  }

  @Get('products/:productId/skus')
  @RequireModule('catalog')
  @ApiOkResponse({ type: [SkuResponseDto] })
  async listSkus(@Param('productId', ParseUUIDPipe) productId: string): Promise<SkuResponseDto[]> {
    const skus = await this.skus.listByProduct(asProductId(productId));
    return skus.map((item) => SkuResponseDto.fromDomain(item));
  }

  @Post('skus')
  @RequirePermission('catalog.skus.manage')
  @ApiOkResponse({ type: SkuResponseDto })
  async createSku(@Body() dto: CreateSkuDto): Promise<SkuResponseDto> {
    const sku = await this.skus.create(dto);
    return SkuResponseDto.fromDomain(sku);
  }

  @Patch('skus/:id')
  @RequirePermission('catalog.skus.manage')
  @ApiOkResponse({ type: SkuResponseDto })
  async updateSku(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkuDto,
  ): Promise<SkuResponseDto> {
    const sku = await this.skus.update(asProductSkuId(id), dto);
    return SkuResponseDto.fromDomain(sku);
  }

  @Delete('skus/:id')
  @RequirePermission('catalog.skus.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSku(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.skus.delete(asProductSkuId(id));
  }
}
