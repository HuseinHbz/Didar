// @ts-check
import globals from 'globals';

import { base } from './base.mjs';

/**
 * ESLint flat config for NestJS services (services/api, worker, notification-worker,
 * scheduler). NestJS relies on decorators + reflection metadata, which needs a couple
 * of narrow, deliberate relaxations from the base strict-type-checked ruleset.
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const nestjsConfig = [
  ...base,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      // Nest constructors commonly have >3 injected dependencies by design (DI container).
      '@typescript-eslint/no-extraneous-class': 'off',
      // Decorator-heavy DTOs/entities read better with empty constructors left implicit.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', '**/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      // `expect(prisma.user.count).toHaveBeenCalledTimes(1)` and
      // `jest.fn()`-mocked methods cast for `.mockResolvedValueOnce(...)` are
      // routine Jest patterns this rule can't distinguish from a genuinely risky
      // detached method reference — it isn't Jest-aware without
      // eslint-plugin-jest (not worth the extra dependency for this one rule).
      '@typescript-eslint/unbound-method': 'off',
    },
  },
];

export default nestjsConfig;
