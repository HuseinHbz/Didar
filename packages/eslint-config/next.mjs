// @ts-check
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { base } from './base.mjs';

/**
 * ESLint flat config for Next.js apps (storefront, admin, pwa).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const nextConfig = [
  ...base,
  {
    // Scoped to app source files, not e.g. next.config.ts / postcss.config.mjs —
    // see the comment in react-library.mjs: unscoped, eslint-plugin-react 7.37.5
    // crashes under ESLint 10 when its rules run against a non-source file.
    files: ['**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      '@next/next': nextPlugin,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    // Hardcoded, not `'detect'` — see react-library.mjs.
    settings: {
      react: { version: '19.2.8' },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react/prop-types': 'off',
    },
  },
];

export default nextConfig;
