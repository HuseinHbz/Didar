import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

import type { TwoFactorSetupResult } from '../../application/two-factor/setup-two-factor.usecase';

export class TwoFactorSetupResponseDto {
  @ApiProperty({ description: 'otpauth:// URI — render as a QR code in the client.' })
  provisioningUri!: string;

  @ApiProperty({ type: [String], description: 'Shown exactly once — store these safely.' })
  recoveryCodes!: string[];

  static fromResult(result: TwoFactorSetupResult): TwoFactorSetupResponseDto {
    const dto = new TwoFactorSetupResponseDto();
    dto.provisioningUri = result.provisioningUri;
    dto.recoveryCodes = result.recoveryCodes;
    return dto;
  }
}

export class TwoFactorCodeDto {
  @ApiProperty({ example: '123456' })
  @IsString()
  code!: string;
}
