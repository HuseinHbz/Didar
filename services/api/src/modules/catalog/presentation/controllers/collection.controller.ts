import { asCollectionId } from '@iecp/types';
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

import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { CollectionsService } from '../../application/collections.service';
import {
  AddCollectionProductDto,
  CollectionMembersResponseDto,
  CollectionPageResponseDto,
  CollectionResponseDto,
  CreateCollectionDto,
  ListCollectionsQueryDto,
  ReorderCollectionProductsDto,
  UpdateCollectionDto,
} from '../dto/collection.dto';
import { PaginationQueryDto } from '../dto/pagination.dto';

/** Phase 005 `api_requirements.admin` — collection CRUD + MANUAL membership. */
@ApiTags('admin/catalog/collections')
@Controller('admin/catalog/collections')
export class CollectionController {
  constructor(private readonly collections: CollectionsService) {}

  @Get()
  @RequireModule('catalog')
  @ApiOkResponse({ type: CollectionPageResponseDto })
  async list(@Query() query: ListCollectionsQueryDto): Promise<CollectionPageResponseDto> {
    const result = await this.collections.list({
      status: query.status,
      type: query.type,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return CollectionPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequireModule('catalog')
  @ApiOkResponse({ type: CollectionResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CollectionResponseDto> {
    const collection = await this.collections.get(asCollectionId(id));
    return CollectionResponseDto.fromDomain(collection);
  }

  @Get(':id/products')
  @RequireModule('catalog')
  @ApiOkResponse({ type: CollectionMembersResponseDto })
  async listMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaginationQueryDto,
  ): Promise<CollectionMembersResponseDto> {
    return this.collections.listMembers(asCollectionId(id), {
      cursor: query.cursor,
      limit: query.limit ?? 50,
    });
  }

  @Post()
  @RequirePermission('catalog.collections.create')
  @ApiOkResponse({ type: CollectionResponseDto })
  async create(@Body() dto: CreateCollectionDto): Promise<CollectionResponseDto> {
    const collection = await this.collections.create({
      name: dto.name,
      slug: dto.slug,
      localizedName: dto.localizedName,
      description: dto.description,
      type: dto.type,
      rules: dto.rules,
      priority: dto.priority,
      startAt: dto.startAt ? new Date(dto.startAt) : undefined,
      endAt: dto.endAt ? new Date(dto.endAt) : undefined,
      imageMediaId: dto.imageMediaId,
      seo: dto.seo,
    });
    return CollectionResponseDto.fromDomain(collection);
  }

  @Patch(':id')
  @RequirePermission('catalog.collections.update')
  @ApiOkResponse({ type: CollectionResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCollectionDto,
  ): Promise<CollectionResponseDto> {
    const collection = await this.collections.update(asCollectionId(id), {
      name: dto.name,
      slug: dto.slug,
      localizedName: dto.localizedName,
      description: dto.description,
      type: dto.type,
      rules: dto.rules,
      priority: dto.priority,
      startAt: dto.startAt === undefined ? undefined : dto.startAt ? new Date(dto.startAt) : null,
      endAt: dto.endAt === undefined ? undefined : dto.endAt ? new Date(dto.endAt) : null,
      status: dto.status,
      imageMediaId: dto.imageMediaId,
      seo: dto.seo,
    });
    return CollectionResponseDto.fromDomain(collection);
  }

  @Delete(':id')
  @RequirePermission('catalog.collections.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.collections.delete(asCollectionId(id));
  }

  @Post(':id/products')
  @RequirePermission('catalog.collections.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async addProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCollectionProductDto,
  ): Promise<void> {
    await this.collections.addProduct(asCollectionId(id), dto.productId, dto.sortOrder);
  }

  @Delete(':id/products/:productId')
  @RequirePermission('catalog.collections.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    await this.collections.removeProduct(asCollectionId(id), productId);
  }

  @Post(':id/products/reorder')
  @RequirePermission('catalog.collections.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorderProducts(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderCollectionProductsDto,
  ): Promise<void> {
    await this.collections.reorderProducts(asCollectionId(id), dto.productIds);
  }
}
