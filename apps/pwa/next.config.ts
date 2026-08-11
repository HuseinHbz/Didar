import withSerwistInit from '@serwist/next';
import type { NextConfig } from 'next';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // Keep the generated service worker out of dev — hot reload + a caching SW fight
  // each other, and it's a common source of "why isn't my change showing up".
  disable: process.env['NODE_ENV'] === 'development',
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

// @serwist/next's webpack plugin has no Turbopack support yet (confirmed against
// Next 16.3.0 — see https://github.com/serwist/serwist/issues/54), and Next 16
// defaults `next build` to Turbopack. `pnpm build`/`pnpm start` in package.json
// pass `--webpack` explicitly for that reason; don't drop that flag without
// first checking whether Serwist has picked up Turbopack support.
export default withSerwist(nextConfig);
