import { asBrandId } from '@iecp/types';
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
import { BrandsService } from '../../application/brands.service';
import {
  BrandPageResponseDto,
  BrandResponseDto,
  CreateBrandDto,
  ListBrandsQueryDto,
  UpdateBrandDto,
} from '../dto/brand.dto';

/** Phase 005 `api_requirements.admin` — brand CRUD. */
@ApiTags('admin/catalog/brands')
@Controller('admin/catalog/brands')
export class BrandController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequireModule('catalog')
  @ApiOkResponse({ type: BrandPageResponseDto })
  async list(@Query() query: ListBrandsQueryDto): Promise<BrandPageResponseDto> {
    const result = await this.brands.list({
      status: query.status,
      search: query.search,
      cursor: query.cursor,
      limit: query.limit ?? 20,
    });
    return BrandPageResponseDto.fromResult(result);
  }

  @Get(':id')
  @RequireModule('catalog')
  @ApiOkResponse({ type: BrandResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<BrandResponseDto> {
    const brand = await this.brands.get(asBrandId(id));
    return BrandResponseDto.fromDomain(brand);
  }

  @Post()
  @RequirePermission('catalog.brands.create')
  @ApiOkResponse({ type: BrandResponseDto })
  async create(@Body() dto: CreateBrandDto): Promise<BrandResponseDto> {
    const brand = await this.brands.create(dto);
    return BrandResponseDto.fromDomain(brand);
  }

  @Patch(':id')
  @RequirePermission('catalog.brands.update')
  @ApiOkResponse({ type: BrandResponseDto })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBrandDto,
  ): Promise<BrandResponseDto> {
    const brand = await this.brands.update(asBrandId(id), dto);
    return BrandResponseDto.fromDomain(brand);
  }

  @Delete(':id')
  @RequirePermission('catalog.brands.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.brands.delete(asBrandId(id));
  }
}
