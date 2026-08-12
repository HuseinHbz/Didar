import { nestjsConfig } from '@iecp/eslint-config/nestjs';

export default [
  {
    // Plain Node CJS test shim (see test/mocks/otplib.cjs's own header for
    // why it exists) — not TypeScript, not part of any tsconfig `include`,
    // and doesn't need type-aware linting; same treatment as a build config
    // file, not application code.
    ignores: ['test/mocks/**'],
  },
  // This file is linted via typescript-eslint's `allowDefaultProject`
  // fallback (see packages/eslint-config/base.mjs), which can't resolve
  // nestjsConfig's cross-package JSDoc array type through to here — the
  // spread below is a real, correctly-typed config array, not an actual
  // `any`, despite what the rule sees in this reduced-info context.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  ...nestjsConfig,
];
