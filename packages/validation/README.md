# @iecp/validation

Shared [Zod](https://zod.dev) schemas, reused on both sides of the wire: the same
schema validates a NestJS DTO on the server and a React Hook Form on the client, so
validation rules are defined exactly once.

- **`phone.ts`** — Iranian mobile number parsing/normalization.
- **`prescription.ts`** — eyeglass prescription value ranges (SPH/CYL/AXIS/ADD/PD).
  ⚠️ Structural validation only, not a clinical/medical spec — see the TODO in that
  file and blueprint §21.
- **`env.ts`** — `parseEnv()`, a fail-fast wrapper for validating `process.env` in
  every service, so a missing env var is a startup error, not a silent `undefined`.

## Build

```
pnpm --filter @iecp/validation build
```
