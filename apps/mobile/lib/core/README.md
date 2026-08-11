# lib/core

App-wide, feature-agnostic building blocks (blueprint §71):

- `network/` — the Dio HTTP client, interceptors (auth header, retry), API error
  mapping.
- `storage/` — secure token/session storage (`flutter_secure_storage`), local cache.
- `router/` — `go_router` route table + deep-link handling (blueprint §73: a
  `https://.../product/123` link opens `Product 123` inside the app, not the PWA).
- `theme/` — Material 3 theme, replaced once the real design system exists.

Nothing here is a placeholder file yet — this README exists so the intended shape
is documented before code lands, per "every module must have documentation".
