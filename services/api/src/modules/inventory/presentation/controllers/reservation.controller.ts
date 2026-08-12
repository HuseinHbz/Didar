import { type UserId, asProductSkuId, asWarehouseId } from '@iecp/types';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequireModule } from '../../../identity/presentation/decorators/require-module.decorator';
import { ReservationService } from '../../application/reservation.service';
import {
  ConvertReservationDto,
  CreateReservationDto,
  ReleaseReservationDto,
  ReservationResponseDto,
} from '../dto/reservation.dto';

/**
 * `POST /internal/inventory/reservations` (+`/release`, `/convert`) — the
 * seam future cart/checkout/POS/home-try-on modules (none of which this
 * phase implements) call into. Still behind the same global
 * `JwtAuthGuard`/`AuthorizationGuard` every other route uses — there is no
 * separate service-to-service auth mechanism yet (see
 * `docs/security/inventory-security.md`'s "Deliberately not built this
 * phase"), so "internal" here means "the URL prefix a future
 * service-to-service caller uses," not a different auth model.
 */
@ApiTags('internal/inventory/reservations')
@Controller('internal/inventory/reservations')
export class ReservationController {
  constructor(private readonly reservations: ReservationService) {}

  @Get(':id')
  @RequireModule('inventory')
  @ApiOkResponse({ type: ReservationResponseDto })
  async get(@Param('id') id: string): Promise<ReservationResponseDto> {
    const reservation = await this.reservations.get(id);
    return ReservationResponseDto.fromDomain(reservation);
  }

  @Post()
  @RequireModule('inventory')
  @ApiOkResponse({ type: ReservationResponseDto })
  async reserve(
    @Body() dto: CreateReservationDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<ReservationResponseDto> {
    const reservation = await this.reservations.reserve({
      productSkuId: asProductSkuId(dto.productSkuId),
      warehouseId: asWarehouseId(dto.warehouseId),
      quantity: dto.quantity,
      sourceType: dto.sourceType,
      sourceId: dto.sourceId,
      idempotencyKey: dto.idempotencyKey,
      expiresAt: dto.expiresAt,
      actorUserId: actorId,
    });
    return ReservationResponseDto.fromDomain(reservation);
  }

  @Post(':id/release')
  @RequireModule('inventory')
  @ApiOkResponse({ type: ReservationResponseDto })
  async release(
    @Param('id') id: string,
    @Body() dto: ReleaseReservationDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<ReservationResponseDto> {
    const reservation = await this.reservations.release(id, actorId, dto.reason);
    return ReservationResponseDto.fromDomain(reservation);
  }

  @Post(':id/convert')
  @RequireModule('inventory')
  @ApiOkResponse({ type: ReservationResponseDto })
  async convert(
    @Param('id') id: string,
    @Body() dto: ConvertReservationDto,
    @CurrentUserId() actorId: UserId,
  ): Promise<ReservationResponseDto> {
    const reference =
      dto.referenceType && dto.referenceId
        ? { referenceType: dto.referenceType, referenceId: dto.referenceId }
        : undefined;
    const reservation = await this.reservations.convert(id, actorId, reference);
    return ReservationResponseDto.fromDomain(reservation);
  }
}
