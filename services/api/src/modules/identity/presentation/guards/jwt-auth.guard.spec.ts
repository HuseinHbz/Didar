import { randomUUID } from 'node:crypto';

import { asApiKeyId, asUserId } from '@iecp/types';
import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

import { ApiKeyRecord } from '../../domain/entities/api-key.entity';
import type { ApiKeyRepositoryPort } from '../../domain/ports/api-key.repository.port';
import { ApiKeyGeneratorService } from '../../infrastructure/crypto/api-key-generator.service';
import type { JwtTokenService } from '../../infrastructure/crypto/jwt-token.service';
import type { AuthenticatedRequest } from '../request-context';

import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * CP-028 (P1-7/P2-6) — this repo had zero guard-level unit coverage for
 * either authentication path before this pass, despite `JwtAuthGuard`
 * being the single global enforcement point for authentication on every
 * route. Hand-rolled fakes throughout — same "no mocking framework
 * beyond jest.fn where needed" convention `request-otp.usecase.spec.ts`
 * already established for this module.
 */
describe('JwtAuthGuard', () => {
  const OWNER_ID = asUserId(randomUUID());
  const RAW_KEY = 'iecp_test-raw-key-value';
  const KEY_HASH = new ApiKeyGeneratorService().hash(RAW_KEY);

  function makeContext(props: { headers?: Record<string, string | string[] | undefined> }): {
    context: ExecutionContext;
    request: AuthenticatedRequest;
  } {
    const request = { headers: props.headers ?? {} } as unknown as AuthenticatedRequest;
    // The guard reads @Public() via its own injected Reflector (see
    // makeGuard), not via anything on ExecutionContext itself — a bare
    // stub handler/class is enough here.
    const context = {
      getHandler: () => ({}) as never,
      getClass: () => ({}) as never,
      switchToHttp: () => ({ getRequest: () => request }) as never,
    } as unknown as ExecutionContext;
    return { context, request };
  }

  function makeGuard(props: {
    isPublic?: boolean;
    verifyAccessToken?: JwtTokenService['verifyAccessToken'];
    apiKeys?: Partial<ApiKeyRepositoryPort>;
  }): JwtAuthGuard {
    const reflector = {
      getAllAndOverride: () => props.isPublic,
    } as unknown as Reflector;
    const jwtTokens = {
      verifyAccessToken:
        props.verifyAccessToken ??
        (() => {
          throw new UnauthorizedException('not configured for this test');
        }),
    } as unknown as JwtTokenService;
    const apiKeys = {
      findByHash: () => Promise.resolve(null),
      touchLastUsed: () => Promise.resolve(undefined),
      ...props.apiKeys,
    } as ApiKeyRepositoryPort;
    return new JwtAuthGuard(reflector, jwtTokens, apiKeys, new ApiKeyGeneratorService());
  }

  it('allows a @Public() route through with no token at all', async () => {
    const guard = makeGuard({ isPublic: true });
    const { context } = makeContext({});

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a missing bearer token with 401', async () => {
    const guard = makeGuard({});
    const { context } = makeContext({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a malformed Authorization header (no "Bearer " scheme) with 401', async () => {
    const guard = makeGuard({});
    const { context } = makeContext({ headers: { authorization: 'Basic abc123' } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token that fails signature/expiry verification with 401', async () => {
    const guard = makeGuard({
      verifyAccessToken: () => {
        throw new UnauthorizedException('invalid or expired token');
      },
    });
    const { context } = makeContext({ headers: { authorization: 'Bearer bad.token.here' } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('sets request.user from a valid bearer token, with no apiKeyScopes', async () => {
    const guard = makeGuard({
      verifyAccessToken: () => Promise.resolve({ userId: OWNER_ID, jti: 'jti-1' }),
    });
    const { context, request } = makeContext({ headers: { authorization: 'Bearer real-token' } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: OWNER_ID });
  });

  it('authenticates via a valid, active API key and sets apiKeyScopes', async () => {
    const record = ApiKeyRecord.create({
      id: randomUUID(),
      name: 'ci-key',
      keyHash: KEY_HASH,
      ownerId: OWNER_ID,
      scopes: ['catalog.brands.create'],
      createdAt: new Date(),
    });
    const guard = makeGuard({
      apiKeys: { findByHash: (hash) => Promise.resolve(hash === KEY_HASH ? record : null) },
    });
    const { context, request } = makeContext({ headers: { 'x-api-key': RAW_KEY } });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      userId: OWNER_ID,
      apiKeyScopes: ['catalog.brands.create'],
    });
  });

  it('rejects an unknown API key with 401', async () => {
    const guard = makeGuard({ apiKeys: { findByHash: () => Promise.resolve(null) } });
    const { context } = makeContext({ headers: { 'x-api-key': 'iecp_totally-unknown' } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a revoked API key with 401', async () => {
    const record = ApiKeyRecord.create({
      id: randomUUID(),
      name: 'revoked-key',
      keyHash: KEY_HASH,
      ownerId: OWNER_ID,
      scopes: [],
      revokedAt: new Date(),
      createdAt: new Date(),
    });
    const guard = makeGuard({
      apiKeys: { findByHash: () => Promise.resolve(record) },
    });
    const { context } = makeContext({ headers: { 'x-api-key': RAW_KEY } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an owner-less API key rather than treating it as anonymous', async () => {
    const record = ApiKeyRecord.create({
      id: randomUUID(),
      name: 'ownerless-key',
      keyHash: KEY_HASH,
      ownerId: null,
      scopes: [],
      createdAt: new Date(),
    });
    const guard = makeGuard({
      apiKeys: { findByHash: () => Promise.resolve(record) },
    });
    const { context } = makeContext({ headers: { 'x-api-key': RAW_KEY } });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('marks the key as used (touchLastUsed) on a successful API-key authentication', async () => {
    const record = ApiKeyRecord.create({
      id: randomUUID(),
      name: 'touched-key',
      keyHash: KEY_HASH,
      ownerId: OWNER_ID,
      scopes: [],
      createdAt: new Date(),
    });
    const touchLastUsed = jest.fn(() => Promise.resolve(undefined));
    const guard = makeGuard({
      apiKeys: { findByHash: () => Promise.resolve(record), touchLastUsed },
    });
    const { context } = makeContext({ headers: { 'x-api-key': RAW_KEY } });

    await guard.canActivate(context);

    expect(touchLastUsed).toHaveBeenCalledWith(asApiKeyId(record.id), expect.any(Date));
  });

  it('prefers X-API-Key over an Authorization header when both are present', async () => {
    const record = ApiKeyRecord.create({
      id: randomUUID(),
      name: 'precedence-key',
      keyHash: KEY_HASH,
      ownerId: OWNER_ID,
      scopes: ['scope-a'],
      createdAt: new Date(),
    });
    const verifyAccessToken = jest.fn();
    const guard = makeGuard({
      verifyAccessToken,
      apiKeys: { findByHash: () => Promise.resolve(record) },
    });
    const { context, request } = makeContext({
      headers: { 'x-api-key': RAW_KEY, authorization: 'Bearer some-jwt' },
    });

    await guard.canActivate(context);

    expect(verifyAccessToken).not.toHaveBeenCalled();
    expect(request.user).toEqual({ userId: OWNER_ID, apiKeyScopes: ['scope-a'] });
  });
});
