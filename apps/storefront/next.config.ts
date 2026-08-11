import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Internal workspace packages ship pre-built (packages/*/dist), so no
  // transpilePackages entry is needed here — see packages/ui/README.md.
  //
  // NOTE: no `eslint` key here — Next 16 removed `next build`'s built-in lint
  // step (and the config option along with it). Linting is `pnpm lint` /
  // turbo.json's `lint` task, a separate CI step, not part of the build.
};

export default nextConfig;
