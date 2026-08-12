import { asMediaId, asProductId } from '@iecp/types';
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
import { MediaService } from '../../application/media.service';
import {
  AttachMediaDto,
  MediaResponseDto,
  ProductMediaResponseDto,
  RegisterMediaDto,
  ReorderProductMediaDto,
} from '../dto/media.dto';

/** Phase 005 — media registration + product attachment. No upload
 * endpoint (ADR-005 decision 3/"Deferred") — `register` takes an
 * already-hosted URL. */
@ApiTags('admin/catalog/media')
@Controller('admin/catalog')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('media/:id')
  @RequireModule('catalog')
  @ApiOkResponse({ type: MediaResponseDto })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<MediaResponseDto> {
    const media = await this.media.get(asMediaId(id));
    return MediaResponseDto.fromDomain(media);
  }

  @Post('media')
  @RequirePermission('catalog.media.manage')
  @ApiOkResponse({ type: MediaResponseDto })
  async register(@Body() dto: RegisterMediaDto): Promise<MediaResponseDto> {
    const media = await this.media.register(dto);
    return MediaResponseDto.fromDomain(media);
  }

  @Delete('media/:id')
  @RequirePermission('catalog.media.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.media.delete(asMediaId(id));
  }

  @Get('products/:productId/media')
  @RequireModule('catalog')
  @ApiOkResponse({ type: [ProductMediaResponseDto] })
  async listForProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<ProductMediaResponseDto[]> {
    const rows = await this.media.listForProduct(asProductId(productId));
    return rows.map((item) => ProductMediaResponseDto.fromDomain(item));
  }

  @Post('products/:productId/media')
  @RequirePermission('catalog.media.manage')
  @ApiOkResponse({ type: ProductMediaResponseDto })
  async attach(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: AttachMediaDto,
  ): Promise<ProductMediaResponseDto> {
    const attachment = await this.media.attach({
      productId,
      mediaId: dto.mediaId,
      variantId: dto.variantId,
      role: dto.role,
      sortOrder: dto.sortOrder,
      altTextOverride: dto.altTextOverride,
    });
    return ProductMediaResponseDto.fromDomain(attachment);
  }

  @Delete('products/:productId/media/:attachmentId')
  @RequirePermission('catalog.media.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async detach(@Param('attachmentId', ParseUUIDPipe) attachmentId: string): Promise<void> {
    await this.media.detach(attachmentId);
  }

  @Post('products/:productId/media/reorder')
  @RequirePermission('catalog.media.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReorderProductMediaDto,
  ): Promise<void> {
    await this.media.reorder(asProductId(productId), dto.mediaAttachmentIds);
  }
}
