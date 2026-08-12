import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MinLength } from 'class-validator';

import type { LoginOutcome } from '../../application/auth/login-types';
import type { RefreshedTokens } from '../../application/auth/refresh-token.usecase';
import type { RequestOtpResult } from '../../application/auth/request-otp.usecase';
import type { OtpPurpose } from '../../domain/entities/otp-request.entity';

import { IsIranMobile } from './is-iran-mobile.validator';

const OTP_PURPOSES: OtpPurpose[] = ['LOGIN', 'REGISTER', 'RESET_PASSWORD'];

export class RequestOtpDto {
  @ApiProperty({ example: '+989121234567' })
  @IsIranMobile()
  phone!: string;

  @ApiProperty({ enum: OTP_PURPOSES })
  @IsIn(OTP_PURPOSES)
  purpose!: OtpPurpose;
}

export class RequestOtpResponseDto {
  @ApiProperty()
  expiresAt!: Date;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Only present outside production — see RequestOtpUseCase.',
  })
  devOnlyCode?: string | null;

  static fromResult(result: RequestOtpResult): RequestOtpResponseDto {
    const dto = new RequestOtpResponseDto();
    dto.expiresAt = result.expiresAt;
    dto.devOnlyCode = result.devOnlyCode;
    return dto;
  }
}

export class VerifyOtpDto {
  @ApiProperty({ example: '+989121234567' })
  @IsIranMobile()
  phone!: string;

  @ApiProperty({ enum: OTP_PURPOSES })
  @IsIn(OTP_PURPOSES)
  purpose!: OtpPurpose;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  code!: string;
}

export class LoginWithPasswordDto {
  @ApiProperty({ example: 'admin@iecp.dev' })
  @IsString()
  email!: string;

  @ApiProperty()
  @IsString()
  password!: string;
}

export class SetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class VerifyTwoFactorLoginDto {
  @ApiProperty()
  @IsString()
  pendingToken!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  code!: string;
}

export class TokensDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;
}

/** Maps `LoginOutcome`'s discriminated union onto one response shape —
 * exactly one of `tokens` or `pendingToken` is ever populated, matching
 * which branch of `LoginOutcome` produced this DTO. */
export class LoginResponseDto {
  @ApiProperty({ enum: ['AUTHENTICATED', 'TWO_FACTOR_REQUIRED'] })
  status!: LoginOutcome['kind'];

  @ApiProperty({ required: false, type: TokensDto })
  tokens?: TokensDto;

  @ApiProperty({
    required: false,
    description: 'Pass to POST /auth/2fa/verify along with a TOTP code.',
  })
  pendingToken?: string;

  static fromOutcome(outcome: LoginOutcome): LoginResponseDto {
    const dto = new LoginResponseDto();
    dto.status = outcome.kind;
    if (outcome.kind === 'AUTHENTICATED') {
      dto.tokens = { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
    } else {
      dto.pendingToken = outcome.pendingToken;
    }
    return dto;
  }

  static fromRefreshed(tokens: RefreshedTokens): LoginResponseDto {
    const dto = new LoginResponseDto();
    dto.status = 'AUTHENTICATED';
    dto.tokens = tokens;
    return dto;
  }
}
