import type { UserId } from '@iecp/types';
import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../../../common/decorators/public.decorator';
import { LoginWithPasswordUseCase } from '../../application/auth/login-with-password.usecase';
import { LogoutAllUseCase } from '../../application/auth/logout-all.usecase';
import { LogoutUseCase } from '../../application/auth/logout.usecase';
import { RefreshTokenUseCase } from '../../application/auth/refresh-token.usecase';
import { RequestOtpUseCase } from '../../application/auth/request-otp.usecase';
import { SetPasswordUseCase } from '../../application/auth/set-password.usecase';
import { VerifyOtpUseCase } from '../../application/auth/verify-otp.usecase';
import { VerifyTwoFactorUseCase } from '../../application/two-factor/verify-two-factor.usecase';
import { CurrentUserId } from '../decorators/current-user.decorator';
import {
  LoginResponseDto,
  LoginWithPasswordDto,
  RefreshTokenDto,
  RequestOtpDto,
  RequestOtpResponseDto,
  SetPasswordDto,
  VerifyOtpDto,
  VerifyTwoFactorLoginDto,
} from '../dto/auth.dto';
import { extractLoginContext } from '../login-context.util';

/** blueprint §56: mobile OTP, password (optional), refresh-token rotation,
 * and 2FA — see identity/README.md for the full flow diagram and what's
 * deliberately not here (OAuth/social login). */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly requestOtp: RequestOtpUseCase,
    private readonly verifyOtp: VerifyOtpUseCase,
    private readonly loginWithPassword: LoginWithPasswordUseCase,
    private readonly setPassword: SetPasswordUseCase,
    private readonly refreshToken: RefreshTokenUseCase,
    private readonly logout: LogoutUseCase,
    private readonly logoutAll: LogoutAllUseCase,
    private readonly verifyTwoFactor: VerifyTwoFactorUseCase,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: RequestOtpResponseDto })
  async requestOtpCode(
    @Body() dto: RequestOtpDto,
    @Req() req: Request,
  ): Promise<RequestOtpResponseDto> {
    const result = await this.requestOtp.execute({
      phone: dto.phone,
      purpose: dto.purpose,
      ipAddress: req.ip,
    });
    return RequestOtpResponseDto.fromResult(result);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  async verifyOtpCode(@Body() dto: VerifyOtpDto, @Req() req: Request): Promise<LoginResponseDto> {
    const outcome = await this.verifyOtp.execute({
      phone: dto.phone,
      purpose: dto.purpose,
      code: dto.code,
      ...extractLoginContext(req),
    });
    return LoginResponseDto.fromOutcome(outcome);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  async loginWithEmailPassword(
    @Body() dto: LoginWithPasswordDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const outcome = await this.loginWithPassword.execute({
      email: dto.email,
      password: dto.password,
      ...extractLoginContext(req),
    });
    return LoginResponseDto.fromOutcome(outcome);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  async verifyTwoFactorLogin(
    @Body() dto: VerifyTwoFactorLoginDto,
    @Req() req: Request,
  ): Promise<LoginResponseDto> {
    const outcome = await this.verifyTwoFactor.execute({
      pendingToken: dto.pendingToken,
      code: dto.code,
      ...extractLoginContext(req),
    });
    return LoginResponseDto.fromOutcome(outcome);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeOwnPassword(
    @CurrentUserId() userId: UserId,
    @Body() dto: SetPasswordDto,
  ): Promise<void> {
    await this.setPassword.execute(userId, dto.newPassword);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LoginResponseDto })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request): Promise<LoginResponseDto> {
    const tokens = await this.refreshToken.execute({
      refreshToken: dto.refreshToken,
      userAgent: req.headers['user-agent'] ?? null,
      ipAddress: req.ip ?? null,
    });
    return LoginResponseDto.fromRefreshed(tokens);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutCurrentSession(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.logout.execute(dto.refreshToken);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiCreatedResponse({ description: 'Every active session for the caller is revoked.' })
  async logoutEverywhere(@CurrentUserId() userId: UserId): Promise<void> {
    await this.logoutAll.execute(userId);
  }
}
