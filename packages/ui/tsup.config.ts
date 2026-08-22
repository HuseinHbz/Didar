import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ['react', 'react-dom'],
  // CP-018 added interactive components (dialog.tsx/confirm-dialog.tsx)
  // that need real hooks, alongside the package's original static,
  // server-safe ones (button, badge, table, …). Two per-module chunking
  // strategies were tried and both broke under one bundler or the other:
  // esbuild `splitting: true` factors shared code between the two hook
  // files into an internal chunk that carries neither file's directive
  // (Turbopack tolerated it; apps/pwa's webpack build correctly rejected
  // it), and `splitting: false` with one entry per component still
  // re-inlines every transitive import into the barrel's own index.js —
  // so the barrel itself needs the directive regardless of how the
  // individual component files are split. A `'use client'` banner on the
  // single bundled entry is the standard, bundler-agnostic fix real
  // component libraries use for this (Next.js's own docs and most
  // third-party library READMEs point here first, not at manual
  // splitting): the whole package becomes one client boundary. The one
  // real cost is apps/storefront's still-placeholder home page picking up
  // a client boundary for its lone `<Button>` — negligible next to
  // guaranteeing every hook-using export works under every bundler this
  // monorepo builds with (Turbopack for admin/storefront, webpack for
  // pwa), and storefront's real catalog UI (CP-019+) will need
  // client-side interactivity from this package anyway.
  banner: { js: "'use client';" },
});
