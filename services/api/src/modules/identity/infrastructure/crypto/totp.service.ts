import { Injectable } from '@nestjs/common';
import {
  generate,
  generateSecret as otplibGenerateSecret,
  generateURI as otplibGenerateURI,
  verify,
} from 'otplib';

/** RFC 6238 TOTP (blueprint §56 2FA). Thin wrapper around `otplib` so the
 * rest of the module depends on this interface, not the library directly. */
@Injectable()
export class TotpService {
  // otplib's generateSecret/generateURI are synchronous; generate/verify
  // (below) are async — kept as-is rather than force-wrapping the sync ones
  // in a needless Promise, matching what the underlying library actually does.
  generateSecret(): string {
    return otplibGenerateSecret();
  }

  async currentCode(secret: string): Promise<string> {
    return generate({ secret });
  }

  /** Accepts otplib's default step tolerance (adjacent 30s windows),
   * absorbing normal clock drift between server and authenticator app. */
  async verifyCode(secret: string, token: string): Promise<boolean> {
    const result = await verify({ secret, token });
    return result.valid;
  }

  provisioningUri(props: { secret: string; accountLabel: string; issuer: string }): string {
    return otplibGenerateURI({
      secret: props.secret,
      label: props.accountLabel,
      issuer: props.issuer,
    });
  }
}
