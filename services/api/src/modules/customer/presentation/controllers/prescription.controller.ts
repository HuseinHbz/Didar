import { asPrescriptionId, type UserId } from '@iecp/types';
import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { PrescriptionService } from '../../application/prescriptions/prescription.service';
import { CreatePrescriptionDto, PrescriptionResponseDto } from '../dto/prescription.dto';

/** `/me/prescriptions[/:id]` — customer-facing only. Reviewer/approval
 * routes live on `PrescriptionReviewController` (`admin/prescriptions`),
 * gated by `@RequirePermission('customer.prescription.review')` —
 * never exposed here, so an ordinary customer has no route that could
 * ever approve/reject *any* prescription, their own included. */
@ApiTags('customer')
@Controller('me/prescriptions')
export class PrescriptionController {
  constructor(private readonly prescriptions: PrescriptionService) {}

  @Get()
  @ApiOkResponse({ type: [PrescriptionResponseDto] })
  async list(@CurrentUserId() userId: UserId): Promise<PrescriptionResponseDto[]> {
    const items = await this.prescriptions.list(userId);
    return items.map((item) => PrescriptionResponseDto.fromDomain(item));
  }

  @Get(':id')
  @ApiOkResponse({ type: PrescriptionResponseDto })
  async get(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PrescriptionResponseDto> {
    const prescription = await this.prescriptions.get(userId, asPrescriptionId(id));
    return PrescriptionResponseDto.fromDomain(prescription);
  }

  @Post()
  @ApiOkResponse({ type: PrescriptionResponseDto })
  async create(
    @CurrentUserId() userId: UserId,
    @Body() dto: CreatePrescriptionDto,
  ): Promise<PrescriptionResponseDto> {
    const created = await this.prescriptions.create(userId, {
      rightEye: dto.rightEye,
      leftEye: dto.leftEye,
      notes: dto.notes ?? null,
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return PrescriptionResponseDto.fromDomain(created);
  }

  @Post(':id/submit')
  @ApiOkResponse({ type: PrescriptionResponseDto })
  async submit(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PrescriptionResponseDto> {
    const updated = await this.prescriptions.submit(userId, asPrescriptionId(id));
    return PrescriptionResponseDto.fromDomain(updated);
  }

  /** Creates a new `DRAFT` version superseding an `APPROVED` prescription
   * the caller owns — the customer-facing "correct my prescription"
   * path (see `PrescriptionService.createNewVersion()`). */
  @Post(':id/new-version')
  @ApiOkResponse({ type: PrescriptionResponseDto })
  async createNewVersion(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreatePrescriptionDto,
  ): Promise<PrescriptionResponseDto> {
    const created = await this.prescriptions.createNewVersion(userId, asPrescriptionId(id), {
      rightEye: dto.rightEye,
      leftEye: dto.leftEye,
      notes: dto.notes ?? null,
      issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    });
    return PrescriptionResponseDto.fromDomain(created);
  }
}
