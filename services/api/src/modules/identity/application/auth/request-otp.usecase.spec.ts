import { OtpRequest } from '../../domain/entities/otp-request.entity';
import type { OtpNotificationPort } from '../../domain/ports/otp-notification.port';
import type { OtpRepositoryPort } from '../../domain/ports/otp.repository.port';
import type { SecurityEventRepositoryPort } from '../../domain/ports/security-event.repository.port';
import type { IdentityConfig } from '../../identity.config';
import { OtpCodeService } from '../../infrastructure/crypto/otp-code.service';

import { RequestOtpUseCase } from './request-otp.usecase';

/**
 * CP-017 — hand-rolled fakes, same "no NestJS test module, no database, no
 * HTTP" precedent `get-user-by-id.usecase.spec.ts` already established.
 * The one real class used here is `OtpCodeService` (pure, no I/O) — using
 * the real generator rather than a fake one is what lets this test assert
 * "a code is always issued" without hand-maintaining a second definition
 * of what a valid code looks like.
 */
describe('RequestOtpUseCase', () => {
  const phone = '+989121234567';
  const config: IdentityConfig = {
    jwtAccessTtlSeconds: 900,
    jwtRefreshTtlSeconds: 2_592_000,
    otpTtlSeconds: 300,
    exposeOtpCodeForTesting: true,
    otpNotificationCooldownSeconds: 60,
  };

  const buildFakes = (previous: OtpRequest | null) => {
    const created: unknown[] = [];
    const sentSms: { phone: string; code: string; purpose: string }[] = [];
    let notificationShouldFail = false;

    const otpRequests: OtpRepositoryPort = {
      findLatest: () => Promise.resolve(previous),
      create: (props) => {
        created.push(props);
        return Promise.resolve(
          OtpRequest.create({
            id: 'new-otp',
            phone: props.phone,
            codeHash: props.codeHash,
            purpose: props.purpose,
            attempts: 0,
            expiresAt: props.expiresAt,
            createdAt: new Date(),
          }),
        );
      },
      incrementAttempts: () => Promise.resolve(),
      consume: () => Promise.resolve(),
    };

    const securityEvents: SecurityEventRepositoryPort = {
      record: () => Promise.resolve(),
      listForUser: () => Promise.resolve([]),
    };

    const otpNotifications: OtpNotificationPort = {
      sendOtpSms: (props) => {
        if (notificationShouldFail) return Promise.reject(new Error('provider down'));
        sentSms.push(props);
        return Promise.resolve();
      },
    };

    return {
      otpRequests,
      securityEvents,
      otpNotifications,
      created,
      sentSms,
      failNextNotification: () => (notificationShouldFail = true),
    };
  };

  it('always issues a fresh code, regardless of any prior request', async () => {
    const fakes = buildFakes(null);
    const useCase = new RequestOtpUseCase(
      fakes.otpRequests,
      fakes.securityEvents,
      fakes.otpNotifications,
      config,
      new OtpCodeService(),
    );

    const result = await useCase.execute({ phone, purpose: 'LOGIN' });

    expect(result.devOnlyCode).toEqual(expect.stringMatching(/^\d{6}$/));
    expect(fakes.created).toHaveLength(1);
  });

  it('never exposes devOnlyCode when exposeOtpCodeForTesting is false (production)', async () => {
    const fakes = buildFakes(null);
    const prodConfig: IdentityConfig = { ...config, exposeOtpCodeForTesting: false };
    const useCase = new RequestOtpUseCase(
      fakes.otpRequests,
      fakes.securityEvents,
      fakes.otpNotifications,
      prodConfig,
      new OtpCodeService(),
    );

    const result = await useCase.execute({ phone, purpose: 'LOGIN' });

    expect(result.devOnlyCode).toBeNull();
  });

  it('dispatches a real SMS when there is no prior request', async () => {
    const fakes = buildFakes(null);
    const useCase = new RequestOtpUseCase(
      fakes.otpRequests,
      fakes.securityEvents,
      fakes.otpNotifications,
      config,
      new OtpCodeService(),
    );

    await useCase.execute({ phone, purpose: 'LOGIN' });
    // Dispatch is fire-and-forget (not awaited by execute()) — flush microtasks.
    await new Promise(process.nextTick);

    expect(fakes.sentSms).toHaveLength(1);
    expect(fakes.sentSms[0]).toMatchObject({ phone, purpose: 'LOGIN' });
  });

  it('skips the SMS dispatch when a still-usable prior request is within the cooldown window', async () => {
    const now = new Date();
    const previous = OtpRequest.create({
      id: 'prev',
      phone,
      codeHash: 'prev-hash',
      purpose: 'LOGIN',
      attempts: 0,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
      createdAt: new Date(now.getTime() - 10_000), // 10s ago, well within a 60s cooldown
    });
    const fakes = buildFakes(previous);
    const useCase = new RequestOtpUseCase(
      fakes.otpRequests,
      fakes.securityEvents,
      fakes.otpNotifications,
      config,
      new OtpCodeService(),
    );

    const result = await useCase.execute({ phone, purpose: 'LOGIN' });
    await new Promise(process.nextTick);

    // The code is still always issued — only dispatch is skipped.
    expect(result.devOnlyCode).toEqual(expect.stringMatching(/^\d{6}$/));
    expect(fakes.created).toHaveLength(1);
    expect(fakes.sentSms).toHaveLength(0);
  });

  it('dispatches again once the prior request has been consumed (the normal login flow)', async () => {
    const previous = OtpRequest.create({
      id: 'prev',
      phone,
      codeHash: 'prev-hash',
      purpose: 'LOGIN',
      attempts: 0,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      consumedAt: new Date(), // already used by a prior verify() call
      createdAt: new Date(),
    });
    const fakes = buildFakes(previous);
    const useCase = new RequestOtpUseCase(
      fakes.otpRequests,
      fakes.securityEvents,
      fakes.otpNotifications,
      config,
      new OtpCodeService(),
    );

    await useCase.execute({ phone, purpose: 'LOGIN' });
    await new Promise(process.nextTick);

    expect(fakes.sentSms).toHaveLength(1);
  });

  it('a notification dispatch failure never fails or delays the use case response', async () => {
    const fakes = buildFakes(null);
    fakes.failNextNotification();
    const useCase = new RequestOtpUseCase(
      fakes.otpRequests,
      fakes.securityEvents,
      fakes.otpNotifications,
      config,
      new OtpCodeService(),
    );

    await expect(useCase.execute({ phone, purpose: 'LOGIN' })).resolves.toMatchObject({
      devOnlyCode: expect.stringMatching(/^\d{6}$/) as unknown,
    });
  });
});
