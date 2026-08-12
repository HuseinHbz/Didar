import type { UserId } from '@iecp/types';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { DisableTwoFactorUseCase } from '../../application/two-factor/disable-two-factor.usecase';
import { EnableTwoFactorUseCase } from '../../application/two-factor/enable-two-factor.usecase';
import { SetupTwoFactorUseCase } from '../../application/two-factor/setup-two-factor.usecase';
import { CurrentUserId } from '../decorators/current-user.decorator';
import { TwoFactorCodeDto, TwoFactorSetupResponseDto } from '../dto/two-factor.dto';

/** blueprint §56 "2FA for Admin" — every step here requires an existing
 * Bearer token (no `@Public()` anywhere in this controller): 2FA is
 * something an already-authenticated user turns on for themselves, distinct
 * from `POST /auth/2fa/verify` (auth.controller.ts), which completes a
 * *login* that paused for a second factor. */
@ApiTags('two-factor')
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly setup: SetupTwoFactorUseCase,
    private readonly enable: EnableTwoFactorUseCase,
    private readonly disable: DisableTwoFactorUseCase,
  ) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TwoFactorSetupResponseDto })
  async setupTwoFactor(@CurrentUserId() userId: UserId): Promise<TwoFactorSetupResponseDto> {
    const result = await this.setup.execute(userId);
    return TwoFactorSetupResponseDto.fromResult(result);
  }

  @Post('enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async enableTwoFactor(
    @CurrentUserId() userId: UserId,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<void> {
    await this.enable.execute(userId, dto.code);
  }

  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disableTwoFactor(
    @CurrentUserId() userId: UserId,
    @Body() dto: TwoFactorCodeDto,
  ): Promise<void> {
    await this.disable.execute(userId, dto.code);
  }
}
