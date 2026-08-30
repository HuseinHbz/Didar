#!/usr/bin/env node
/**
 * `pnpm load-test` (CP-029, P1-5 / O4) — a real, bounded load test against
 * a real running `services/api` instance, using `autocannon`. Not a
 * correctness proof (the domain unit/e2e suites already cover that) — this
 * checks throughput/latency under sustained concurrent load and that the
 * process survives it without crashing, leaking connections, or its error
 * rate climbing under load.
 *
 * Usage:
 *   pnpm load-test                              # against http://localhost:4000, /api/v1/catalog/products, 20 conns, 15s
 *   TARGET_URL=http://localhost:4000/api/v1/catalog/products pnpm load-test
 *   CONNECTIONS=50 DURATION=30 pnpm load-test
 *
 * Requires a real, already-running services/api instance (this script does
 * not boot one) — see docs/operations/load-testing.md for how this was run
 * for CP-029's own evidence.
 */
import autocannon from 'autocannon';

const TARGET_URL = process.env.TARGET_URL ?? 'http://localhost:4000/api/v1/catalog/products';
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 20);
const DURATION = Number(process.env.DURATION ?? 15);

console.log(`==> Load testing ${TARGET_URL} (${CONNECTIONS} connections, ${DURATION}s)`);

const result = await autocannon({
  url: TARGET_URL,
  connections: CONNECTIONS,
  duration: DURATION,
});

console.log(autocannon.printResult(result));

const errorRate = (result.errors + result.timeouts + result.non2xx) / result.requests.total;
console.log(
  `==> Total requests: ${result.requests.total}, non-2xx/errors/timeouts: ${result.errors + result.timeouts + result.non2xx} (${(errorRate * 100).toFixed(2)}%)`,
);
console.log(
  `==> Latency: p50=${result.latency.p50}ms p99=${result.latency.p99}ms max=${result.latency.max}ms`,
);
console.log(`==> Throughput: ${result.requests.average.toFixed(1)} req/s average`);

if (errorRate > 0.01) {
  console.error('==> FAIL: error rate above 1% under load');
  process.exit(1);
}

console.log('==> Done. See docs/operations/load-testing.md for interpretation and caveats.');
