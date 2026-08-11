import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // See apps/storefront/next.config.ts — no `eslint` key; linting is a separate
  // `pnpm lint` step in Next 16, not a `next build` option anymore.
};

export default nextConfig;
