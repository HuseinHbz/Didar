import { asProductAttributeId, asProductAttributeValueId, asProductVariantId } from '@iecp/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { AttributesService } from '../../application/attributes.service';
import {
  AttributeResponseDto,
  AttributeValueResponseDto,
  CreateAttributeDto,
  CreateAttributeValueDto,
} from '../dto/attribute.dto';

/** Phase 005 — admin-defined attributes (blueprint's Dynamic Filter
 * Engine) + variant assignment. */
@ApiTags('admin/catalog/attributes')
@Controller('admin/catalog')
export class AttributeController {
  constructor(private readonly attributes: AttributesService) {}

  @Get('attributes')
  @RequireModule('catalog')
  @ApiOkResponse({ type: [AttributeResponseDto] })
  async listAttributes(): Promise<AttributeResponseDto[]> {
    const attributes = await this.attributes.listAttributes();
    return attributes.map((item) => AttributeResponseDto.fromDomain(item));
  }

  @Post('attributes')
  @RequirePermission('catalog.attributes.manage')
  @ApiOkResponse({ type: AttributeResponseDto })
  async createAttribute(@Body() dto: CreateAttributeDto): Promise<AttributeResponseDto> {
    const attribute = await this.attributes.createAttribute(dto);
    return AttributeResponseDto.fromDomain(attribute);
  }

  @Get('attributes/:id/values')
  @RequireModule('catalog')
  @ApiOkResponse({ type: [AttributeValueResponseDto] })
  async listValues(@Param('id', ParseUUIDPipe) id: string): Promise<AttributeValueResponseDto[]> {
    const values = await this.attributes.listValues(asProductAttributeId(id));
    return values.map((item) => AttributeValueResponseDto.fromDomain(item));
  }

  @Post('attributes/:id/values')
  @RequirePermission('catalog.attributes.manage')
  @ApiOkResponse({ type: AttributeValueResponseDto })
  async createValue(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: Omit<CreateAttributeValueDto, 'attributeId'>,
  ): Promise<AttributeValueResponseDto> {
    const value = await this.attributes.createValue({
      attributeId: id,
      value: dto.value,
      localizedValue: dto.localizedValue,
      sortOrder: dto.sortOrder,
    });
    return AttributeValueResponseDto.fromDomain(value);
  }

  @Post('variants/:variantId/attributes/:valueId')
  @RequirePermission('catalog.attributes.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async assign(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
  ): Promise<void> {
    await this.attributes.assignToVariant(
      asProductVariantId(variantId),
      asProductAttributeValueId(valueId),
    );
  }

  @Delete('variants/:variantId/attributes/:valueId')
  @RequirePermission('catalog.attributes.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unassign(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Param('valueId', ParseUUIDPipe) valueId: string,
  ): Promise<void> {
    await this.attributes.unassignFromVariant(
      asProductVariantId(variantId),
      asProductAttributeValueId(valueId),
    );
  }
}
