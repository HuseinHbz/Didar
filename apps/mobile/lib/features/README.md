# lib/features

One directory per feature module (blueprint §71), each internally shaped roughly
like `<feature>/{data,domain,presentation}` or simpler `<feature>/<feature>_page.dart`
for thin ones — consistency matters less here than in `services/*`, since Flutter
features are more UI-driven than domain-driven.

Planned modules (blueprint §71 `lib/features/`):

| Module         | Status        |
| -------------- | ------------- |
| `home/`        | placeholder page only |
| `auth/`        | not started |
| `catalog/`     | not started |
| `search/`      | not started |
| `product/`     | not started |
| `cart/`        | not started |
| `checkout/`    | not started |
| `orders/`      | not started |
| `prescription/`| not started |
| `try_on/`      | not started |
| `loyalty/`     | not started |
| `profile/`     | not started |

Only `home/` exists right now (`home/home_page.dart`), as the reference example for
the pattern. Business logic (pricing, order rules, inventory) never lives in this
app — it calls `services/api`, same as every other client (root `CLAUDE.md`).
