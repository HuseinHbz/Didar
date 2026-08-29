import { asPrescriptionId, type UserId } from '@iecp/types';
import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { PrescriptionService } from '../../application/prescriptions/prescription.service';
import { PrescriptionResponseDto, RejectPrescriptionDto } from '../dto/prescription.dto';

/** `admin/prescriptions/:id/{start-review,approve,reject}` — RBAC-only,
 * no ownership check, same shape `ReturnAdminController` establishes
 * for its own approve/reject routes: a reviewer with
 * `customer.prescription.review` may act on any customer's
 * prescription by design (that's the point of the role). */
@ApiTags('customer-admin')
@Controller('admin/prescriptions')
export class PrescriptionReviewController {
  constructor(private readonly prescriptions: PrescriptionService) {}

  @Post(':id/start-review')
  @RequirePermission('customer.prescription.review')
  @ApiOkResponse({ type: PrescriptionResponseDto })
  async startReview(
    @CurrentUserId() reviewerUserId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PrescriptionResponseDto> {
    const updated = await this.prescriptions.startReview(reviewerUserId, asPrescriptionId(id));
    return PrescriptionResponseDto.fromDomain(updated);
  }

  @Post(':id/approve')
  @RequirePermission('customer.prescription.review')
  @ApiOkResponse({ type: PrescriptionResponseDto })
  async approve(
    @CurrentUserId() reviewerUserId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PrescriptionResponseDto> {
    const updated = await this.prescriptions.approve(reviewerUserId, asPrescriptionId(id));
    return PrescriptionResponseDto.fromDomain(updated);
  }

  @Post(':id/reject')
  @RequirePermission('customer.prescription.review')
  @ApiOkResponse({ type: PrescriptionResponseDto })
  async reject(
    @CurrentUserId() reviewerUserId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPrescriptionDto,
  ): Promise<PrescriptionResponseDto> {
    const updated = await this.prescriptions.reject(reviewerUserId, asPrescriptionId(id), dto.reason);
    return PrescriptionResponseDto.fromDomain(updated);
  }
}
