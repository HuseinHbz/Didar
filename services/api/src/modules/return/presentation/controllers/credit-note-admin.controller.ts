import { type UserId } from '@iecp/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUserId } from '../../../identity/presentation/decorators/current-user.decorator';
import { RequirePermission } from '../../../identity/presentation/decorators/require-permission.decorator';
import { CreditNoteService } from '../../application/credit-note.service';
import { CreditNoteResponseDto, VoidCreditNoteDto } from '../dto/credit-note.dto';

/** Admin/financial credit-note routes — every route permission-gated
 * (ADR-012 RBAC section: `credit_note.read`/`.issue`/`.void`). No
 * standalone "create an ad-hoc credit note" route — a `DRAFT` note is
 * only ever created as a side effect of `POST /admin/returns/:id/
 * approve-refund` (decision 7). `issue` here is a manual recovery path
 * for the (documented, decision 6) crash-window between that step and
 * `POST /admin/returns/:id/refund`, not the normal flow. */
@ApiTags('admin/credit-notes')
@Controller('admin/credit-notes')
export class CreditNoteAdminController {
  constructor(private readonly creditNotes: CreditNoteService) {}

  @Get()
  @RequirePermission('credit_note.read')
  @ApiOkResponse({ type: [CreditNoteResponseDto] })
  async list(
    @Query('orderId') orderId?: string,
    @Query('returnRequestId') returnRequestId?: string,
  ) {
    const notes = returnRequestId
      ? await this.creditNotes.listByReturnRequestId(returnRequestId)
      : orderId
        ? await this.creditNotes.listByOrderId(orderId)
        : [];
    const detailed = await Promise.all(notes.map((note) => this.creditNotes.get(note.id)));
    return detailed.map((detail) => CreditNoteResponseDto.fromDomain(detail));
  }

  @Get(':id')
  @RequirePermission('credit_note.read')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  async get(@Param('id') id: string) {
    const detail = await this.creditNotes.get(id);
    return CreditNoteResponseDto.fromDomain(detail);
  }

  @Post(':id/issue')
  @RequirePermission('credit_note.issue')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  async issue(@Param('id') id: string, @CurrentUserId() actorId: UserId) {
    await this.creditNotes.issue(id, actorId);
    const detail = await this.creditNotes.get(id);
    return CreditNoteResponseDto.fromDomain(detail);
  }

  @Post(':id/void')
  @RequirePermission('credit_note.void')
  @ApiOkResponse({ type: CreditNoteResponseDto })
  async void(
    @Param('id') id: string,
    @CurrentUserId() actorId: UserId,
    @Body() dto: VoidCreditNoteDto,
  ) {
    await this.creditNotes.void(id, actorId, dto.reason);
    const detail = await this.creditNotes.get(id);
    return CreditNoteResponseDto.fromDomain(detail);
  }
}
