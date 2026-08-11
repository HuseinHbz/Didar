// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Base ESLint flat config shared by every TypeScript project in the monorepo.
 *
 * Project rule (see root CONTRIBUTING.md / docs/architecture): the `any` type is
 * banned. `@typescript-eslint/no-explicit-any` and `no-unsafe-*` are errors, not
 * warnings — there is no "just this once".
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const base = [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/generated/**',
      // tsup writes a transient bundled copy of *.config.ts while it runs, then
      // deletes it. Since `lint` and `build` have no ordering dependency on each
      // other for the same package (turbo.json only makes `lint` depend on
      // `^build`, i.e. dependencies' build, not the package's own), ESLint's file
      // crawl can catch this file mid-delete when both run concurrently —
      // ignoring the pattern outright is more robust than relying on timing.
      '**/*.bundled_*.*',
      // Serwist-generated service worker output (apps/pwa) — a build artifact,
      // gitignored, never hand-written; mirrors the pattern in root .gitignore.
      '**/public/sw.js',
      '**/public/sw.js.map',
      '**/public/swe-worker-*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: {
          // Root-level tool config files that live outside a *packages/* tsconfig
          // `include` (which only covers `src/`) — without this,
          // typescript-eslint's type-aware parser can't find a project for them
          // and errors on every one of them ("was not found by the project
          // service"). These still get linted, just without full type info.
          //
          // Deliberately NOT `*.config.ts` (only specific filenames): apps/*'s
          // next.config.ts is already covered by that app's own tsconfig
          // (`include: [..., "**/*.ts", ...]`), and typescript-eslint treats a
          // file matched by BOTH allowDefaultProject and a real project as a
          // *conflict* ("was included by allowDefaultProject but also was found
          // in the project service"), not a harmless no-op.
          allowDefaultProject: ['*.config.{js,mjs,cjs}', 'tsup.config.ts'],
        },
        // No explicit tsconfigRootDir: it must resolve relative to whichever
        // package's `eslint .` invocation is running (process.cwd()), not to
        // this shared config file's own location — same class of mistake as
        // the outDir issue documented in packages/config/nestjs.json.
      },
    },
    rules: {
      // The one rule the whole project is built around: no `any`, anywhere.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      // Off, not tuned: `noPropertyAccessFromIndexSignature` (packages/config/
      // base.json — a real strictness setting we want) requires bracket notation
      // for index-signature properties, e.g. `process.env['NODE_ENV']`. This
      // rule (stylisticTypeChecked's default) prefers dot notation and flags
      // that as unnecessary — direct conflict on every single env var access.
      // Its own `allowIndexSignaturePropertyAccess` option, tried first, did not
      // resolve the conflict in practice; simplest reliable fix is disabling a
      // purely stylistic rule rather than fighting the compiler setting we
      // actually want.
      '@typescript-eslint/dot-notation': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // strictTypeChecked's default bans numbers/booleans in template literals
      // too — worth keeping for `any`/`object`/`unknown`/nullable (genuinely
      // surprising `.toString()` output), not for plain numbers/booleans, which
      // are safe and idiomatic to interpolate (`${count}`, `${isActive}`).
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      'import/no-unresolved': 'off', // handled by TypeScript itself
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
    },
  },
];

export default base;
