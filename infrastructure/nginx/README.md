# infrastructure/nginx

`nginx.conf` — a starting-point reverse proxy: `/api/*` → `services/api`,
`/admin/*` → `apps/admin`, everything else → `apps/storefront`. Assumes Docker
Compose service names as upstreams.

Not deployed or tested anywhere. Real production edge config also needs TLS
termination (or a CDN/WAF in front doing it — blueprint §5/§114 puts
Cloudflare-or-equivalent ahead of Nginx, not instead of it), and per-route rate
limits tuned rather than the one blanket `general` zone here.
