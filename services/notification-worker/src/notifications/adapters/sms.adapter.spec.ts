import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { Env } from '../../config/env';

import { SmsAdapter } from './sms.adapter';

/**
 * CP-017 — real HTTP, never `jest.mock` of `fetch`. A real local
 * `node:http` server stands in for Kavenegar's REST contract (same
 * "real infrastructure over mocks" technique CP-016's own
 * `wait-for-redis.spec.ts` used for Redis) — this exercises the adapter's
 * actual request construction, URL building, and response parsing
 * against a real socket, not a stubbed function. Kavenegar itself is not
 * reachable from this environment (outbound proxy denial, confirmed the
 * same way ADR-008 confirmed it for ZarinPal) — that gap is a live-network
 * staging concern, not something a unit test can or should paper over.
 */
describe('SmsAdapter', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: { path: string; body: string } | null;
  let nextResponse: { status: number; body: unknown };

  const configWithKey = (
    apiKey: string | undefined,
    baseUrlOverride?: string,
  ): ConfigService<Env, true> => {
    const values: Partial<Env> = {
      SMS_API_KEY: apiKey,
      SMS_OTP_TEMPLATE: 'verify',
      SMS_BASE_URL: baseUrlOverride ?? baseUrl,
    };
    return {
      get: (key: string) => values[key as keyof Env],
    } as unknown as ConfigService<Env, true>;
  };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
      req.on('end', () => {
        lastRequest = { path: req.url ?? '', body: raw };
        res.writeHead(nextResponse.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(nextResponse.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  beforeEach(() => {
    lastRequest = null;
    nextResponse = { status: 200, body: {} };
  });

  it('falls back to the stub when SMS_API_KEY is unset — no HTTP call made', async () => {
    const adapter = new SmsAdapter(configWithKey(undefined));

    const result = await adapter.send({
      to: '+989121234567',
      templateKey: 'OTP',
      variables: { code: '123456' },
    });

    expect(result.status).toBe('sent');
    expect(lastRequest).toBeNull();
  });

  it('calls the real Verify-Lookup endpoint for an OTP message, with the code as "token"', async () => {
    nextResponse = {
      status: 200,
      body: {
        return: { status: 200, message: 'ok' },
        entries: [
          {
            messageid: 111,
            message: 'sent',
            status: 1,
            statustext: 'in queue',
            sender: '3000',
            receptor: '+989121234567',
            date: 0,
            cost: 120,
          },
        ],
      },
    };
    const adapter = new SmsAdapter(configWithKey('real-test-key'));

    const result = await adapter.send({
      to: '+989121234567',
      templateKey: 'OTP',
      variables: { code: '654321' },
    });

    expect(result.status).toBe('sent');
    expect(result.id).toBe('111');
    expect(lastRequest?.path).toBe('/v1/real-test-key/verify/lookup.json');
    expect(lastRequest?.body).toContain('token=654321');
    expect(lastRequest?.body).toContain('template=verify');
    // The API key must appear only in the URL path (Kavenegar's own
    // contract), never duplicated into the form body.
    expect(lastRequest?.body).not.toContain('real-test-key');
  });

  it('calls the generic send endpoint for a non-OTP template', async () => {
    nextResponse = {
      status: 200,
      body: {
        return: { status: 200, message: 'ok' },
        entries: [
          {
            messageid: 222,
            message: 'sent',
            status: 1,
            statustext: 'in queue',
            sender: '3000',
            receptor: '+989121234567',
            date: 0,
            cost: 120,
          },
        ],
      },
    };
    const adapter = new SmsAdapter(configWithKey('real-test-key'));

    const result = await adapter.send({
      to: '+989121234567',
      templateKey: 'ORDER_CREATED',
      variables: { order_number: '10042' },
    });

    expect(result.status).toBe('sent');
    expect(lastRequest?.path).toBe('/v1/real-test-key/sms/send.json');
  });

  it('maps a Kavenegar delivery-failure status (>=100) to "failed", not "sent"', async () => {
    nextResponse = {
      status: 200,
      body: {
        return: { status: 200, message: 'ok' },
        entries: [
          {
            messageid: 333,
            message: 'failed',
            status: 100,
            statustext: 'invalid receptor',
            sender: '3000',
            receptor: '+989121234567',
            date: 0,
            cost: 0,
          },
        ],
      },
    };
    const adapter = new SmsAdapter(configWithKey('real-test-key'));

    const result = await adapter.send({
      to: '+989121234567',
      templateKey: 'OTP',
      variables: { code: '000000' },
    });

    expect(result.status).toBe('failed');
  });

  it('maps a real API-level error (bad key, insufficient credit, ...) to "failed" and never throws', async () => {
    nextResponse = {
      status: 200,
      body: { return: { status: 414, message: 'insufficient credit' } },
    };
    const adapter = new SmsAdapter(configWithKey('real-test-key'));

    const result = await adapter.send({
      to: '+989121234567',
      templateKey: 'OTP',
      variables: { code: '000000' },
    });

    expect(result.status).toBe('failed');
  });

  it('maps a malformed (non-JSON) provider response to "failed" and never throws', async () => {
    // A real failure mode this adapter must survive: Kavenegar's own proxy/
    // edge (or any intermediary) returning an HTML error page or truncated
    // body instead of the documented JSON envelope — `response.json()`
    // throws a real `SyntaxError` here, exercised against a real socket,
    // not simulated.
    let rawServer: Server | undefined;
    try {
      rawServer = createServer((req, res) => {
        req.on('data', () => undefined);
        req.on('end', () => {
          res.writeHead(502, { 'Content-Type': 'text/html' });
          res.end('<html><body>Bad Gateway</body></html>');
        });
      });
      await new Promise<void>((resolve) => rawServer?.listen(0, '127.0.0.1', resolve));
      const address = rawServer.address();
      if (address === null || typeof address === 'string')
        throw new Error('expected an AddressInfo');
      const malformedBaseUrl = `http://127.0.0.1:${address.port}`;

      const adapter = new SmsAdapter(configWithKey('real-test-key', malformedBaseUrl));
      const result = await adapter.send({
        to: '+989121234567',
        templateKey: 'OTP',
        variables: { code: '111111' },
      });

      expect(result.status).toBe('failed');
    } finally {
      if (rawServer)
        await new Promise<void>((resolve) =>
          rawServer?.close(() => {
            resolve();
          }),
        );
    }
  });

  it('maps a real request timeout to "failed" and never throws or hangs past the adapter\'s own bound', async () => {
    // A real server that accepts the connection and never responds —
    // exercises the adapter's real `AbortSignal.timeout()`, not a
    // simulated/faked clock. This is the same "real timeout, real wait,
    // generous jest timeout" technique this repo's own
    // `wait-for-redis.spec.ts` established for CP-016.
    let hangingServer: Server | undefined;
    try {
      hangingServer = createServer(() => {
        // Never call res.end() / res.write() — the request hangs until
        // the adapter's own AbortSignal.timeout(15_000) fires.
      });
      await new Promise<void>((resolve) => hangingServer?.listen(0, '127.0.0.1', resolve));
      const address = hangingServer.address();
      if (address === null || typeof address === 'string') {
        throw new Error('expected an AddressInfo');
      }
      const hangingBaseUrl = `http://127.0.0.1:${address.port}`;

      const adapter = new SmsAdapter(configWithKey('real-test-key', hangingBaseUrl));
      const startedAt = Date.now();

      const result = await adapter.send({
        to: '+989121234567',
        templateKey: 'OTP',
        variables: { code: '222222' },
      });

      expect(result.status).toBe('failed');
      // Bounded by the adapter's own 15s timeout, not left hanging —
      // this is the actual regression the test exists to pin.
      expect(Date.now() - startedAt).toBeLessThan(17_000);
    } finally {
      if (hangingServer) {
        await new Promise<void>((resolve) =>
          hangingServer?.close(() => {
            resolve();
          }),
        );
      }
    }
  }, 20_000);

  it('never leaks the API key into the error path when the provider is unreachable', async () => {
    // A real closed local port — a genuine OS-level ECONNREFUSED, not a
    // simulated network error (same technique wait-for-redis.spec.ts uses).
    const unreachableBaseUrl = 'http://127.0.0.1:1';
    const secretKey = 'THIS-KEY-MUST-NEVER-APPEAR-IN-AN-ERROR';
    const logSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const adapter = new SmsAdapter(configWithKey(secretKey, unreachableBaseUrl));

      const result = await adapter.send({
        to: '+989121234567',
        templateKey: 'OTP',
        variables: { code: '333333' },
      });

      expect(result.status).toBe('failed');
      const loggedMessages = logSpy.mock.calls.map((call) => String(call[0]));
      for (const line of loggedMessages) {
        expect(line).not.toContain(secretKey);
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  it('getStatus reflects the outcome recorded by the preceding send()', async () => {
    nextResponse = {
      status: 200,
      body: {
        return: { status: 200, message: 'ok' },
        entries: [
          {
            messageid: 444,
            message: 'sent',
            status: 1,
            statustext: 'in queue',
            sender: '3000',
            receptor: '+989121234567',
            date: 0,
            cost: 120,
          },
        ],
      },
    };
    const adapter = new SmsAdapter(configWithKey('real-test-key'));

    const result = await adapter.send({
      to: '+989121234567',
      templateKey: 'OTP',
      variables: { code: '000000' },
    });

    await expect(adapter.getStatus(result.id)).resolves.toBe('sent');
    await expect(adapter.getStatus('never-sent-id')).resolves.toBe('failed');
  });
});
