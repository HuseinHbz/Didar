import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import type { Env } from '../../config/env';

import { CreateApiKeyUseCase } from './application/api-keys/create-api-key.usecase';
import { ListApiKeysUseCase } from './application/api-keys/list-api-keys.usecase';
import { RevokeApiKeyUseCase } from './application/api-keys/revoke-api-key.usecase';
import { ListAuditLogUseCase } from './application/audit-log/list-audit-log.usecase';
import { CompleteLoginService } from './application/auth/complete-login.service';
import { LoginWithPasswordUseCase } from './application/auth/login-with-password.usecase';
import { LogoutAllUseCase } from './application/auth/logout-all.usecase';
import { LogoutUseCase } from './application/auth/logout.usecase';
import { RefreshTokenUseCase } from './application/auth/refresh-token.usecase';
import { RequestOtpUseCase } from './application/auth/request-otp.usecase';
import { SetPasswordUseCase } from './application/auth/set-password.usecase';
import { VerifyOtpUseCase } from './application/auth/verify-otp.usecase';
import { ListDevicesUseCase } from './application/devices/list-devices.usecase';
import { RevokeDeviceUseCase } from './application/devices/revoke-device.usecase';
import { TrustDeviceUseCase } from './application/devices/trust-device.usecase';
import { AssignRoleUseCase } from './application/rbac/assign-role.usecase';
import { ClearPermissionOverrideUseCase } from './application/rbac/clear-permission-override.usecase';
import { CreateRoleUseCase } from './application/rbac/create-role.usecase';
import { GetEffectivePermissionsUseCase } from './application/rbac/get-effective-permissions.usecase';
import { ListPermissionsUseCase } from './application/rbac/list-permissions.usecase';
import { ListRolesUseCase } from './application/rbac/list-roles.usecase';
import { SetPermissionOverrideUseCase } from './application/rbac/set-permission-override.usecase';
import { UnassignRoleUseCase } from './application/rbac/unassign-role.usecase';
import { UpdateRoleUseCase } from './application/rbac/update-role.usecase';
import { ListSessionsUseCase } from './application/sessions/list-sessions.usecase';
import { RevokeSessionUseCase } from './application/sessions/revoke-session.usecase';
import { DisableTwoFactorUseCase } from './application/two-factor/disable-two-factor.usecase';
import { EnableTwoFactorUseCase } from './application/two-factor/enable-two-factor.usecase';
import { SetupTwoFactorUseCase } from './application/two-factor/setup-two-factor.usecase';
import { VerifyTotpCodeHelper } from './application/two-factor/verify-totp-code.helper';
import { VerifyTwoFactorUseCase } from './application/two-factor/verify-two-factor.usecase';
import { GetUserByIdUseCase } from './application/users/get-user-by-id.usecase';
import { API_KEY_REPOSITORY } from './domain/ports/api-key.repository.port';
import { AUDIT_LOG_REPOSITORY } from './domain/ports/audit-log.repository.port';
import { DEVICE_REPOSITORY } from './domain/ports/device.repository.port';
import { OTP_REPOSITORY } from './domain/ports/otp.repository.port';
import { PERMISSION_OVERRIDE_REPOSITORY } from './domain/ports/permission-override.repository.port';
import { PERMISSION_REPOSITORY } from './domain/ports/permission.repository.port';
import { ROLE_REPOSITORY } from './domain/ports/role.repository.port';
import { SECURITY_EVENT_REPOSITORY } from './domain/ports/security-event.repository.port';
import { SESSION_REPOSITORY } from './domain/ports/session.repository.port';
import { TWO_FACTOR_REPOSITORY } from './domain/ports/two-factor.repository.port';
import { USER_REPOSITORY } from './domain/ports/user.repository.port';
import { IDENTITY_CONFIG, type IdentityConfig } from './identity.config';
import { ApiKeyGeneratorService } from './infrastructure/crypto/api-key-generator.service';
import {
  ENCRYPTION_KEYRING,
  EncryptionService,
  type EncryptionKeyring,
} from './infrastructure/crypto/encryption.service';
import { JwtTokenService } from './infrastructure/crypto/jwt-token.service';
import { OtpCodeService } from './infrastructure/crypto/otp-code.service';
import { PasswordHasherService } from './infrastructure/crypto/password-hasher.service';
import { TotpService } from './infrastructure/crypto/totp.service';
import { PrismaApiKeyRepository } from './infrastructure/repositories/prisma-api-key.repository';
import { PrismaAuditLogRepository } from './infrastructure/repositories/prisma-audit-log.repository';
import { PrismaDeviceRepository } from './infrastructure/repositories/prisma-device.repository';
import { PrismaOtpRepository } from './infrastructure/repositories/prisma-otp.repository';
import { PrismaPermissionOverrideRepository } from './infrastructure/repositories/prisma-permission-override.repository';
import { PrismaPermissionRepository } from './infrastructure/repositories/prisma-permission.repository';
import { PrismaRoleRepository } from './infrastructure/repositories/prisma-role.repository';
import { PrismaSecurityEventRepository } from './infrastructure/repositories/prisma-security-event.repository';
import { PrismaSessionRepository } from './infrastructure/repositories/prisma-session.repository';
import { PrismaTwoFactorRepository } from './infrastructure/repositories/prisma-two-factor.repository';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository';
import { ApiKeysController } from './presentation/controllers/api-keys.controller';
import { AuditLogController } from './presentation/controllers/audit-log.controller';
import { AuthController } from './presentation/controllers/auth.controller';
import { DevicesController } from './presentation/controllers/devices.controller';
import { IdentityController } from './presentation/controllers/identity.controller';
import { PermissionsController } from './presentation/controllers/permissions.controller';
import { RolesController } from './presentation/controllers/roles.controller';
import { SessionsController } from './presentation/controllers/sessions.controller';
import { TwoFactorController } from './presentation/controllers/two-factor.controller';
import { AuthorizationGuard } from './presentation/guards/authorization.guard';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard';
import { FieldPermissionInterceptor } from './presentation/interceptors/field-permission.interceptor';

/**
 * Composition root for the identity domain (blueprint §5): auth
 * (OTP/password/refresh/2FA), RBAC (roles, permissions, overrides,
 * inheritance), sessions/devices, API keys, audit log. One NestJS module
 * for the whole domain, per the "domain-based module folders" convention —
 * not split into seven modules just because it now has that many concerns.
 * See presentation/README.md-equivalent doc at ./README.md for the full
 * picture and what's deliberately out of scope.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
  ],
  controllers: [
    IdentityController,
    AuthController,
    TwoFactorController,
    SessionsController,
    DevicesController,
    RolesController,
    PermissionsController,
    ApiKeysController,
    AuditLogController,
  ],
  providers: [
    // Global guards — JwtAuthGuard MUST run before AuthorizationGuard
    // (registration order = execution order for APP_GUARD providers): one
    // establishes *who* the caller is, the other checks *what* they're
    // allowed to do, and the second is meaningless without the first.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },

    // Repositories
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: ROLE_REPOSITORY, useClass: PrismaRoleRepository },
    { provide: PERMISSION_REPOSITORY, useClass: PrismaPermissionRepository },
    { provide: PERMISSION_OVERRIDE_REPOSITORY, useClass: PrismaPermissionOverrideRepository },
    { provide: SESSION_REPOSITORY, useClass: PrismaSessionRepository },
    { provide: DEVICE_REPOSITORY, useClass: PrismaDeviceRepository },
    { provide: TWO_FACTOR_REPOSITORY, useClass: PrismaTwoFactorRepository },
    { provide: OTP_REPOSITORY, useClass: PrismaOtpRepository },
    { provide: API_KEY_REPOSITORY, useClass: PrismaApiKeyRepository },
    { provide: AUDIT_LOG_REPOSITORY, useClass: PrismaAuditLogRepository },
    { provide: SECURITY_EVENT_REPOSITORY, useClass: PrismaSecurityEventRepository },

    // Config
    {
      provide: IDENTITY_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): IdentityConfig => ({
        jwtAccessTtlSeconds: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
        jwtRefreshTtlSeconds: config.get('JWT_REFRESH_TTL_SECONDS', { infer: true }),
        otpTtlSeconds: config.get('OTP_TTL_SECONDS', { infer: true }),
        exposeOtpCodeForTesting: config.get('NODE_ENV', { infer: true }) !== 'production',
      }),
    },
    {
      // CP-028 (P2-7) — builds the full key ring (v0 = ENCRYPTION_KEY,
      // always present; v1-v3 = optional rotation slots) and the
      // currently-active version — see EncryptionService's own doc
      // comment for the rotation story this enables.
      provide: ENCRYPTION_KEYRING,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EncryptionKeyring => {
        const keys = new Map<number, Buffer>();
        const v0 = config.get('ENCRYPTION_KEY', { infer: true });
        keys.set(0, Buffer.from(v0, 'base64'));
        const v1 = config.get('ENCRYPTION_KEY_V1', { infer: true });
        if (v1 !== undefined) keys.set(1, Buffer.from(v1, 'base64'));
        const v2 = config.get('ENCRYPTION_KEY_V2', { infer: true });
        if (v2 !== undefined) keys.set(2, Buffer.from(v2, 'base64'));
        const v3 = config.get('ENCRYPTION_KEY_V3', { infer: true });
        if (v3 !== undefined) keys.set(3, Buffer.from(v3, 'base64'));
        return {
          currentVersion: config.get('ENCRYPTION_KEY_CURRENT_VERSION', { infer: true }),
          keys,
        };
      },
    },

    // Crypto / infrastructure services
    JwtTokenService,
    PasswordHasherService,
    OtpCodeService,
    TotpService,
    EncryptionService,
    ApiKeyGeneratorService,

    // Application layer — auth
    RequestOtpUseCase,
    VerifyOtpUseCase,
    LoginWithPasswordUseCase,
    SetPasswordUseCase,
    RefreshTokenUseCase,
    LogoutUseCase,
    LogoutAllUseCase,
    CompleteLoginService,

    // Application layer — two-factor
    VerifyTotpCodeHelper,
    SetupTwoFactorUseCase,
    EnableTwoFactorUseCase,
    DisableTwoFactorUseCase,
    VerifyTwoFactorUseCase,

    // Application layer — sessions/devices
    ListSessionsUseCase,
    RevokeSessionUseCase,
    ListDevicesUseCase,
    TrustDeviceUseCase,
    RevokeDeviceUseCase,

    // Application layer — RBAC
    GetEffectivePermissionsUseCase,
    ListRolesUseCase,
    CreateRoleUseCase,
    UpdateRoleUseCase,
    AssignRoleUseCase,
    UnassignRoleUseCase,
    ListPermissionsUseCase,
    SetPermissionOverrideUseCase,
    ClearPermissionOverrideUseCase,

    // Application layer — API keys, audit log, users
    CreateApiKeyUseCase,
    ListApiKeysUseCase,
    RevokeApiKeyUseCase,
    ListAuditLogUseCase,
    GetUserByIdUseCase,

    // Field-level permission demo (see identity.controller.ts)
    FieldPermissionInterceptor,
  ],
  // Phase 007 (ADR-007) — `JwtTokenService` is exported so
  // `CartCheckoutModule` can verify an *optional* bearer token itself
  // (cart/checkout routes are @Public() — they support guest callers, so
  // the global JwtAuthGuard can't gate them) without reimplementing JWT
  // verification. Additive, behavior-preserving.
  exports: [JwtTokenService],
})
export class IdentityModule {}
