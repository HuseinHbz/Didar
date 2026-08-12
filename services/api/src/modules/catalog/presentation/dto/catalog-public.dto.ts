import { ApiProperty } from '@nestjs/swagger';

import type { ProductDetail, VariantWithCommerce } from '../../application/catalog-query.service';

import { BrandResponseDto } from './brand.dto';
import { CategoryResponseDto } from './category.dto';
import { MediaResponseDto } from './media.dto';
import { ProductPriceResponseDto } from './pricing.dto';
import { ProductResponseDto } from './product.dto';
import { SkuResponseDto } from './sku.dto';
import { VariantResponseDto } from './variant.dto';

export class VariantWithCommerceResponseDto {
  @ApiProperty({ type: VariantResponseDto }) variant!: VariantResponseDto;
  @ApiProperty({ type: SkuResponseDto, nullable: true }) sku!: SkuResponseDto | null;
  @ApiProperty({ type: ProductPriceResponseDto, nullable: true })
  price!: ProductPriceResponseDto | null;

  static fromDomain(vwc: VariantWithCommerce): VariantWithCommerceResponseDto {
    const dto = new VariantWithCommerceResponseDto();
    dto.variant = VariantResponseDto.fromDomain(vwc.variant);
    dto.sku = vwc.sku ? SkuResponseDto.fromDomain(vwc.sku) : null;
    dto.price = vwc.price ? ProductPriceResponseDto.fromDomain(vwc.price) : null;
    return dto;
  }
}

/** The storefront product detail page's full aggregate — everything a
 * product page needs in one response, no client-side N+1 fan-out. */
export class ProductDetailResponseDto {
  @ApiProperty({ type: ProductResponseDto }) product!: ProductResponseDto;
  @ApiProperty({ type: BrandResponseDto, nullable: true }) brand!: BrandResponseDto | null;
  @ApiProperty({ type: CategoryResponseDto, nullable: true }) category!: CategoryResponseDto | null;
  @ApiProperty({ type: [VariantWithCommerceResponseDto] })
  variants!: VariantWithCommerceResponseDto[];
  @ApiProperty({ type: [MediaResponseDto] }) media!: MediaResponseDto[];

  static fromDomain(detail: ProductDetail): ProductDetailResponseDto {
    const dto = new ProductDetailResponseDto();
    dto.product = ProductResponseDto.fromDomain(detail.product);
    dto.brand = detail.brand ? BrandResponseDto.fromDomain(detail.brand) : null;
    dto.category = detail.category ? CategoryResponseDto.fromDomain(detail.category) : null;
    dto.variants = detail.variants.map((item) => VariantWithCommerceResponseDto.fromDomain(item));
    dto.media = detail.media.map((item) => MediaResponseDto.fromDomain(item));
    return dto;
  }
}
