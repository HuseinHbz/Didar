#!/usr/bin/env node
/**
 * CP-016: proves Redis is actually reachable at REDIS_URL (default
 * `redis://localhost:6379`, matching every service's own env schema
 * default) before any Redis-dependent step runs — used by CI's `test` job
 * and available for local use the same way.
 *
 * Zero-dependency by design, matching this directory's other scripts
 * (validate-structure.mjs, roadmap-audit.mjs) — a raw TCP `PING` using the
 * Redis RESP protocol directly (no `ioredis` import), since a repo-root
 * script has no access to any single service's own node_modules and this
 * check has no reason to need more than "can we open a socket and get
 * PONG back." A bounded number of attempts with capped backoff — never an
 * unbounded retry loop — so a genuinely unreachable Redis fails this
 * script fast and legibly instead of hanging.
 *
 * Usage: node scripts/verify-redis.mjs [redisUrl]
 */
import { Socket } from 'node:net';

const url = new URL(process.argv[2] ?? process.env.REDIS_URL ?? 'redis://localhost:6379');
const host = url.hostname || 'localhost';
const port = Number(url.port) || 6379;
const MAX_ATTEMPTS = 5;
const CONNECT_TIMEOUT_MS = 3000;

function pingOnce() {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let response = '';

    const fail = (message) => {
      socket.destroy();
      reject(new Error(message));
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('timeout', () => fail(`connection to ${host}:${port} timed out after ${CONNECT_TIMEOUT_MS}ms`));
    socket.once('error', (err) => fail(err.message));

    socket.connect(port, host, () => {
      socket.write('PING\r\n');
    });

    socket.on('data', (chunk) => {
      response += chunk.toString();
      // RESP simple string reply for PING is "+PONG\r\n" — a real Redis
      // server always answers this immediately; anything else (or a
      // connection that never sends this) is fair to treat as unreachable
      // for this check's purposes.
      if (response.includes('+PONG')) {
        socket.end();
        resolve(response.trim());
      }
    });
  });
}

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const reply = await pingOnce();
      console.log(`Redis PING -> ${reply} (attempt ${attempt}/${MAX_ATTEMPTS}, ${host}:${port})`);
      process.exit(0);
    } catch (err) {
      console.error(`Redis unreachable (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}`);
      if (attempt === MAX_ATTEMPTS) {
        console.error(`Redis still unreachable after ${MAX_ATTEMPTS} attempts — giving up.`);
        process.exit(1);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }
}

void main();
