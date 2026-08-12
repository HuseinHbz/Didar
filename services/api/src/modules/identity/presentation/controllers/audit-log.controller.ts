import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ListAuditLogUseCase } from '../../application/audit-log/list-audit-log.usecase';
import { RequirePermission } from '../decorators/require-permission.decorator';
import { AuditLogPageResponseDto, ListAuditLogQueryDto } from '../dto/audit-log.dto';

/** blueprint §54 — read side of the "who changed what" trail. */
@ApiTags('audit-log')
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly listAuditLog: ListAuditLogUseCase) {}

  @Get()
  @RequirePermission('identity.audit_logs.view')
  @ApiOkResponse({ type: AuditLogPageResponseDto })
  async list(@Query() query: ListAuditLogQueryDto): Promise<AuditLogPageResponseDto> {
    const result = await this.listAuditLog.execute(query);
    return AuditLogPageResponseDto.fromResult(result);
  }
}
