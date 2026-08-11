import { nextConfig } from '@iecp/eslint-config/next';

export default [
  ...nextConfig,
  {
    // The service worker runs in its own global scope (self.__SW_MANIFEST, etc.)
    // which trips rules tuned for the app's DOM/window scope.
    files: ['src/app/sw.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
];
