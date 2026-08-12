import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../../../common/decorators/public.decorator';
import { CatalogQueryService } from '../../application/catalog-query.service';
import { BrandResponseDto } from '../dto/brand.dto';
import { ProductDetailResponseDto } from '../dto/catalog-public.dto';
import { CategoryResponseDto } from '../dto/category.dto';
import { CollectionMembersResponseDto, CollectionResponseDto } from '../dto/collection.dto';
import { PaginationQueryDto } from '../dto/pagination.dto';
import { ListProductsQueryDto, ProductPageResponseDto } from '../dto/product.dto';

/**
 * Storefront read surface (Phase 005 `api_requirements.storefront`) — every
 * route is `@Public()`: catalog browsing needs no auth. Every method
 * behind it (`CatalogQueryService`) applies its own "actually publicly
 * visible" filter, so there's no risk of a draft/unpublished/inactive row
 * leaking here even if a filter param is omitted.
 */
@ApiTags('catalog')
@Controller('catalog')
@Public()
export class CatalogPublicController {
  constructor(private readonly query: CatalogQueryService) {}

  @Get('products')
  @ApiOkResponse({ type: ProductPageResponseDto })
  async listProducts(@Query() query: ListProductsQueryDto): Promise<ProductPageResponseDto> {
    const result = await this.query.listProducts({
      brandId: query.brandId,
      categoryId: query.categoryId,
      collectionId: query.collectionId,
      productType: query.productType,
      search: query.search,
      sortField: query.sortField,
      sortDir: query.sortDir,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return ProductPageResponseDto.fromResult(result);
  }

  @Get('products/:slug')
  @ApiOkResponse({ type: ProductDetailResponseDto })
  async getProduct(@Param('slug') slug: string): Promise<ProductDetailResponseDto> {
    const detail = await this.query.getProductDetail(slug);
    return ProductDetailResponseDto.fromDomain(detail);
  }

  @Get('categories')
  @ApiOkResponse({ type: [CategoryResponseDto] })
  async listCategories(@Query('parentId') parentId?: string): Promise<CategoryResponseDto[]> {
    const categories = await this.query.listCategories(parentId ?? null);
    return categories.map((item) => CategoryResponseDto.fromDomain(item));
  }

  @Get('categories/:slug')
  @ApiOkResponse({ type: CategoryResponseDto })
  async getCategory(@Param('slug') slug: string): Promise<CategoryResponseDto> {
    const category = await this.query.getCategoryBySlug(slug);
    return CategoryResponseDto.fromDomain(category);
  }

  @Get('brands')
  @ApiOkResponse({ type: [BrandResponseDto] })
  async listBrands(): Promise<BrandResponseDto[]> {
    const brands = await this.query.listBrands();
    return brands.map((item) => BrandResponseDto.fromDomain(item));
  }

  @Get('brands/:slug')
  @ApiOkResponse({ type: BrandResponseDto })
  async getBrand(@Param('slug') slug: string): Promise<BrandResponseDto> {
    const brand = await this.query.getBrandBySlug(slug);
    return BrandResponseDto.fromDomain(brand);
  }

  @Get('collections')
  @ApiOkResponse({ type: [CollectionResponseDto] })
  async listCollections(): Promise<CollectionResponseDto[]> {
    const collections = await this.query.listCollections();
    return collections.map((item) => CollectionResponseDto.fromDomain(item));
  }

  @Get('collections/:slug')
  @ApiOkResponse({ type: CollectionResponseDto })
  async getCollection(@Param('slug') slug: string): Promise<CollectionResponseDto> {
    const collection = await this.query.getCollectionBySlug(slug);
    return CollectionResponseDto.fromDomain(collection);
  }

  @Get('collections/:slug/products')
  @ApiOkResponse({ type: CollectionMembersResponseDto })
  async getCollectionMembers(
    @Param('slug') slug: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionMembersResponseDto> {
    return this.query.listCollectionMembers(slug, {
      cursor: query.cursor,
      limit: query.limit ?? 50,
    });
  }
}
