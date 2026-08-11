// @ts-check
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import globals from 'globals';

import { base } from './base.mjs';

/**
 * ESLint flat config for plain React component libraries that aren't a full
 * Next.js app (currently: packages/ui).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const reactLibraryConfig = [
  ...base,
  {
    // Scoped to actual source files. Two reasons: React-specific rules (JSX,
    // hooks) are meaningless outside them, and — the reason this is not just
    // tidiness — `eslint-plugin-react` 7.37.5 (only officially supports ESLint
    // <=9.7; we're on 10) crashes with `contextOrFilename.getFilename is not a
    // function` when its rules run against a non-source file like this
    // package's own eslint.config.mjs, because its React-version auto-detection
    // calls an ESLint API removed in v9+'s flat-config context. Un-scoping this
    // reintroduces that crash.
    files: ['**/*.{ts,tsx}'],
    plugins: { react: reactPlugin, 'react-hooks': reactHooksPlugin },
    languageOptions: { globals: { ...globals.browser } },
    // Hardcoded rather than `version: 'detect'` — `'detect'` is what triggers
    // the crash above (it's the auto-detection codepath). We pin the version we
    // actually depend on instead of resolving it at lint time.
    settings: { react: { version: '19.2.8' } },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      ...reactHooksPlugin.configs.recommended.rules,
      'react/prop-types': 'off',
    },
  },
];

export default reactLibraryConfig;
