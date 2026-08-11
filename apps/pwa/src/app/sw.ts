import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

// `ServiceWorkerGlobalScope` needs the `webworker` TS lib, which conflicts with
// `dom` (used by the rest of this Next.js app) if added project-wide. `self` only
// needs to be typed narrowly enough for what this file actually reads off it —
// `WorkerGlobalScope` (available under `dom`) plus the `__SW_MANIFEST` augmentation
// above covers that; the real runtime `self` in a service worker still has the
// full ServiceWorkerGlobalScope shape, we just don't assert it in TypeScript here.
declare const self: WorkerGlobalScope;

/**
 * Offline strategy (blueprint §72): cache static/catalog-ish content for offline
 * browsing; payment, inventory, and order status must always hit the network live
 * and are deliberately NOT included in any cache-first runtime route here.
 */
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
