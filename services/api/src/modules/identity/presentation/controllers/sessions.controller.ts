import { asSessionId, type UserId } from '@iecp/types';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ListSessionsUseCase } from '../../application/sessions/list-sessions.usecase';
import { RevokeSessionUseCase } from '../../application/sessions/revoke-session.usecase';
import { CurrentUserId } from '../decorators/current-user.decorator';
import { SessionResponseDto } from '../dto/session.dto';

/** blueprint §55 "Active Sessions" / "Session Control" — always scoped to
 * the caller's own sessions; there is no admin "list anyone's sessions"
 * endpoint in this pass. */
@ApiTags('sessions')
@Controller('me/sessions')
export class SessionsController {
  constructor(
    private readonly listSessions: ListSessionsUseCase,
    private readonly revokeSession: RevokeSessionUseCase,
  ) {}

  @Get()
  @ApiOkResponse({ type: [SessionResponseDto] })
  async list(@CurrentUserId() userId: UserId): Promise<SessionResponseDto[]> {
    const sessions = await this.listSessions.execute(userId);
    return sessions.map((session) => SessionResponseDto.fromDomain(session));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUserId() userId: UserId,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.revokeSession.execute(userId, asSessionId(id));
  }
}
