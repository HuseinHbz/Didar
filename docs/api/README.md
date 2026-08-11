# API

Full rationale: [`docs/product/blueprint.md`](../product/blueprint.md) §91-§92,
§99-§100. This document is the standard every endpoint in `services/api` should
follow; it is not an endpoint reference — for that, run the service and open
`/api/v1/docs` (generated Swagger UI, always in sync with the code since it's
generated from the same `@nestjs/swagger` decorators the controllers use).

## Conventions

- **Base path**: `/api/v1` — versioned from the first endpoint (blueprint §70),
  set once via `app.setGlobalPrefix('api/v1')` in `services/api/src/main.ts`.
  A `/api/v2` is a new prefix, not a breaking change to `/v1`.
- **REST**, with GraphQL left as a documented possibility (blueprint §91) for a
  future complex-frontend need, not something in place today.
- **Validation is server-side and rejects unknowns**: `ValidationPipe({ whitelist:
true, forbidNonWhitelisted: true, transform: true })` on every request — an
  unexpected field in a request body is a `400`, not silently dropped or accepted.
- **DTOs are Zod-shaped where possible** — `@iecp/validation` schemas are meant to
  be reused for both a NestJS DTO and a React Hook Form on the client, so a
  validation rule is defined exactly once. (Current DTOs, e.g.
  `UserResponseDto`, use `class-validator`/`@nestjs/swagger` decorators directly
  since they're response shapes rather than input to validate — use `@iecp/validation`
  schemas for request bodies once real write endpoints exist.)

## Error shape (target, not yet standardized end to end)

Blueprint §100's target shape:

```json
{
  "success": false,
  "error": { "code": "INVENTORY_NOT_AVAILABLE", "message": "..." },
  "requestId": "..."
}
```

`services/api` doesn't have a global exception filter producing exactly this
shape yet — NestJS's default `HttpException` JSON body is what ships today. Add a
global `ExceptionFilter` mapping to the shape above before the first real domain
module ships error responses clients need to branch on.

## Idempotency

Required for payment and order endpoints (blueprint §67) — an `Idempotency-Key`
header, checked before creating a new Order/Payment record, so a retried request
(client timeout + retry, double-tap on checkout) produces one charge, not two.
Not implemented yet; no write endpoints exist to need it yet either. Design this
alongside the `order`/`payment` domain modules, not bolted on after.

## Auth (not implemented yet)

Target: mobile OTP + optional password for customers, password + 2FA + device
trust for admin (blueprint §56). `services/api` has no auth guards yet — every
current endpoint (`/health`, `/users/:id`) is unauthenticated. Do not add a
write endpoint before auth exists to protect it.

## OpenAPI

`@nestjs/swagger` generates the spec directly from controller/DTO decorators —
`SwaggerModule.setup('api/v1/docs', ...)` in `main.ts`. Keep annotating
(`@ApiTags`, `@ApiOkResponse`, `@ApiParam`, etc.) as you go; there's no separate
hand-maintained OpenAPI YAML to keep in sync.
