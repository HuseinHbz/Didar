import { createServer, type Server } from 'node:net';

import { waitForRedis } from './wait-for-redis';

/**
 * CP-016 — regression tests for the bounded Redis reachability check that
 * gates this worker's own bootstrap (see main.ts and
 * docs/architecture/redis-reliability.md). These deliberately do not mock
 * an `ioredis`/Redis client — "no fake Redis mocks for infrastructure
 * reliability proofs" (CP-016 rules). Instead:
 *   - the "down" case connects to a real closed TCP port, producing a
 *     genuine OS-level ECONNREFUSED, exactly what an unreachable Redis
 *     produces over the wire;
 *   - the "up" case runs a real `node:net` TCP server that speaks just
 *     enough RESP (`PING` -> `+PONG\r\n`) to answer the real socket this
 *     module opens.
 * The live, production-entrypoint proof (`node dist/main.js` against a
 * real killed-then-restarted Redis, exit code 1, ~11s, never hanging) is
 * the CP-016 completion-report evidence; these tests exist to pin the
 * same bounded-retry/backoff behavior deterministically and fast, as an
 * automated regression a future change can't silently break.
 */
describe('waitForRedis', () => {
  // A real, currently-unbound localhost port — connecting here gets a
  // real ECONNREFUSED from the OS, not a simulated one.
  const UNREACHABLE_URL = 'redis://127.0.0.1:1';

  it('throws a bounded, descriptive error instead of hanging when Redis is never reachable', async () => {
    const startedAt = Date.now();

    await expect(waitForRedis(UNREACHABLE_URL)).rejects.toThrow(
      /still unreachable at 127\.0\.0\.1:1 after 5 attempts — refusing to boot/,
    );

    // This is the actual regression this test exists to pin: CP-014's
    // audit found a real boot against a killed Redis produce an
    // unbroken retry loop for 2+ minutes with no resolution.
    expect(Date.now() - startedAt).toBeLessThan(20_000);
  }, 25_000);

  it('resolves on the very first attempt once Redis is reachable', async () => {
    const server = createServer((socket) => {
      socket.on('data', (chunk) => {
        if (chunk.toString().startsWith('PING')) socket.write('+PONG\r\n');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('expected an AddressInfo');

    const startedAt = Date.now();
    try {
      await expect(waitForRedis(`redis://127.0.0.1:${address.port}`)).resolves.toBeUndefined();
      expect(Date.now() - startedAt).toBeLessThan(1_000);
    } finally {
      await closeServer(server);
    }
  });
});

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
