import { asProductId, type UserId } from '@iecp/types';
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
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { ProductsService } from '../../application/products.service';
import {
  BulkOperationResultDto,
  BulkProductsDto,
  CreateProductDto,
  ListProductsQueryDto,
  ProductPageResponseDto,
  ProductResponseDto,
  UpdateProductDto,
} from '../dto/product.dto';

/** Phase 005 `api_requirements.admin` — product CRUD + the full publishing
 * lifecycle (`admin_workflows.product_creation`) + bulk operations
 * (`admin_workflows.sensitive_operations`). */
@ApiTags('admin/catalog/products')
@Controller('admin/catalog/products')
export class ProductController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequireModule('catalog')
  @ApiOkResponse({ type: ProductPageResponseDto })
  async list(@Query() query: ListProductsQueryDto): Promise<ProductPageResponseDto> {
    const result = await this.products.list({
      brandId: query.brandId,
      categoryId: query.categoryId,
      collectionId: query.collectionId,
      status: query.status,
      productType: query.productType,
      search: query.search,
      sortField: query.sortField,
      sortDir: query.sortDir,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return ProductPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequireModule('catalog')
  @ApiOkResponse({ type: ProductResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<ProductResponseDto> {
    const product = await this.products.get(asProductId(id));
    return ProductResponseDto.fromDomain(product);
  }

  @Post()
  @RequirePermission('catalog.products.create')
  @ApiOkResponse({ type: ProductResponseDto })
  async create(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    const product = await this.products.create(dto);
    return ProductResponseDto.fromDomain(product);
  }

  @Patch(':id')
  @RequirePermission('catalog.products.update')
  @ApiOkResponse({ type: ProductResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    const product = await this.products.update(asProductId(id), dto);
    return ProductResponseDto.fromDomain(product);
  }

  @Delete(':id')
  @RequirePermission('catalog.products.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<void> {
    await this.products.delete(asProductId(id), actorId);
  }

  @Post(':id/submit-for-review')
  @RequirePermission('catalog.products.update')
  @ApiOkResponse({ type: ProductResponseDto })
  async submitForReview(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<ProductResponseDto> {
    const product = await this.products.submitForReview(asProductId(id), actorId);
    return ProductResponseDto.fromDomain(product);
  }

  @Post(':id/approve')
  @RequirePermission('catalog.products.approve')
  @ApiOkResponse({ type: ProductResponseDto })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<ProductResponseDto> {
    const product = await this.products.approve(asProductId(id), actorId);
    return ProductResponseDto.fromDomain(product);
  }

  @Post(':id/reject')
  @RequirePermission('catalog.products.approve')
  @ApiOkResponse({ type: ProductResponseDto })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<ProductResponseDto> {
    const product = await this.products.rejectToDraft(asProductId(id), actorId);
    return ProductResponseDto.fromDomain(product);
  }

  @Post(':id/publish')
  @RequirePermission('catalog.products.publish')
  @ApiOkResponse({ type: ProductResponseDto })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<ProductResponseDto> {
    const product = await this.products.publish(asProductId(id), actorId);
    return ProductResponseDto.fromDomain(product);
  }

  @Post(':id/unpublish')
  @RequirePermission('catalog.products.publish')
  @ApiOkResponse({ type: ProductResponseDto })
  async unpublish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<ProductResponseDto> {
    const product = await this.products.unpublish(asProductId(id), actorId);
    return ProductResponseDto.fromDomain(product);
  }

  @Post(':id/archive')
  @RequirePermission('catalog.products.archive')
  @ApiOkResponse({ type: ProductResponseDto })
  async archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUserId() actorId: UserId,
  ): Promise<ProductResponseDto> {
    const product = await this.products.archive(asProductId(id), actorId);
    return ProductResponseDto.fromDomain(product);
  }

  @Post('bulk')
  @RequirePermission('catalog.products.bulk')
  @ApiOkResponse({ type: BulkOperationResultDto })
  async bulk(
    @Body() dto: BulkProductsDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<BulkOperationResultDto> {
    const ids = dto.ids.map(asProductId);
    return dto.operation === 'publish'
      ? this.products.bulkPublish(ids, actorId)
      : this.products.bulkArchive(ids, actorId);
  }
}
