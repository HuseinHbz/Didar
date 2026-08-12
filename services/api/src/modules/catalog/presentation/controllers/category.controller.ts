import { asCategoryId } from '@iecp/types';
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
import { CategoriesService } from '../../application/categories.service';
import {
  CategoryPageResponseDto,
  CategoryResponseDto,
  CreateCategoryDto,
  ListCategoriesQueryDto,
  PublishCategoryDto,
  UpdateCategoryDto,
} from '../dto/category.dto';

/** Phase 005 `api_requirements.admin` — category CRUD, unlimited-depth
 * tree (blueprint §10). */
@ApiTags('admin/catalog/categories')
@Controller('admin/catalog/categories')
export class CategoryController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @RequireModule('catalog')
  @ApiOkResponse({ type: CategoryPageResponseDto })
  async list(@Query() query: ListCategoriesQueryDto): Promise<CategoryPageResponseDto> {
    const result = await this.categories.list({
      parentId: query.parentId,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return CategoryPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequireModule('catalog')
  @ApiOkResponse({ type: CategoryResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<CategoryResponseDto> {
    const category = await this.categories.get(asCategoryId(id));
    return CategoryResponseDto.fromDomain(category);
  }

  @Post()
  @RequirePermission('catalog.categories.create')
  @ApiOkResponse({ type: CategoryResponseDto })
  async create(@Body() dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const category = await this.categories.create(dto);
    return CategoryResponseDto.fromDomain(category);
  }

  @Patch(':id')
  @RequirePermission('catalog.categories.update')
  @ApiOkResponse({ type: CategoryResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categories.update(asCategoryId(id), dto);
    return CategoryResponseDto.fromDomain(category);
  }

  @Post(':id/publish')
  @RequirePermission('catalog.categories.update')
  @ApiOkResponse({ type: CategoryResponseDto })
  async setPublished(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishCategoryDto,
  ): Promise<CategoryResponseDto> {
    const category = await this.categories.update(asCategoryId(id), {
      publishedAt: dto.published ? new Date() : null,
    });
    return CategoryResponseDto.fromDomain(category);
  }

  @Delete(':id')
  @RequirePermission('catalog.categories.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.categories.delete(asCategoryId(id));
  }
}
