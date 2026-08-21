import { OtpRequest } from './otp-request.entity';

describe('OtpRequest', () => {
  const now = new Date('2026-01-01T00:10:00Z');

  const build = (overrides: Partial<Parameters<typeof OtpRequest.create>[0]> = {}): OtpRequest =>
    OtpRequest.create({
      id: 'otp-1',
      phone: '+989121234567',
      codeHash: 'hash',
      purpose: 'LOGIN',
      attempts: 0,
      expiresAt: new Date(now.getTime() + 5 * 60_000),
      createdAt: now,
      ...overrides,
    });

  describe('isUsable', () => {
    it('is usable when unconsumed, unexpired, and under the attempt cap', () => {
      expect(build().isUsable(now)).toBe(true);
    });

    it('is not usable once consumed', () => {
      expect(build({ consumedAt: now }).isUsable(now)).toBe(false);
    });

    it('is not usable once expired', () => {
      expect(build().isUsable(new Date(now.getTime() + 6 * 60_000))).toBe(false);
    });

    it('is not usable once attempts reach the cap', () => {
      expect(build({ attempts: OtpRequest.MAX_ATTEMPTS }).isUsable(now)).toBe(false);
    });
  });

  describe('shouldSkipNotification (CP-017)', () => {
    it('never skips when there is no prior request', () => {
      expect(OtpRequest.shouldSkipNotification(null, now, 60)).toBe(false);
    });

    it('never skips when the prior request is already consumed — the normal request -> verify -> consume flow', () => {
      const previous = build({ consumedAt: now, createdAt: now });
      expect(OtpRequest.shouldSkipNotification(previous, now, 60)).toBe(false);
    });

    it('never skips when the prior request is expired', () => {
      const previous = build({ createdAt: new Date(now.getTime() - 10 * 60_000), expiresAt: now });
      expect(OtpRequest.shouldSkipNotification(previous, now, 60)).toBe(false);
    });

    it('never skips when the prior request has exhausted its attempts', () => {
      const previous = build({ attempts: OtpRequest.MAX_ATTEMPTS, createdAt: now });
      expect(OtpRequest.shouldSkipNotification(previous, now, 60)).toBe(false);
    });

    it('skips when a still-usable prior request was created within the cooldown window', () => {
      const previous = build({ createdAt: new Date(now.getTime() - 10_000) }); // 10s ago
      expect(OtpRequest.shouldSkipNotification(previous, now, 60)).toBe(true);
    });

    it('does not skip once the cooldown window has elapsed, even if still usable', () => {
      const previous = build({ createdAt: new Date(now.getTime() - 61_000) }); // 61s ago
      expect(OtpRequest.shouldSkipNotification(previous, now, 60)).toBe(false);
    });

    it('a cooldown of 0 never skips', () => {
      const previous = build({ createdAt: now });
      expect(OtpRequest.shouldSkipNotification(previous, now, 0)).toBe(false);
    });
  });
});
