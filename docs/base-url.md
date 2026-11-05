# Deploying cc-viewer behind a reverse-proxy URL (`CCV_BASE_URL`)

> 中文文档：[base-url.zh.md](./base-url.zh.md)

Cloud platforms often map cc-viewer's internal port (default `7008`) to a public URL with a path prefix, e.g.:

```
https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/your/custom/path
wss://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/your/ws/path
```

Set `CCV_BASE_URL` to that public URL and cc-viewer will serve the whole app — HTTP API, SSE, WebSocket upgrades, static assets, share/QR links — correctly under it. No rebuild and no frontend changes are needed.

## Accepted forms

| Form | Example | Effect |
|---|---|---|
| `host/path` | `arca-sandbox-office.alipay.com/arca/api/v1/session/{token}` | path prefix + public host |
| `/path` | `/arca/api/v1/session/{token}` | path prefix only |
| `scheme://host/path` | `https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}` | path prefix + host + pinned scheme |
| `//host/path` | `//arca-sandbox-office.alipay.com/arca/api/v1/session/{token}` | path prefix + host (protocol-relative form; scheme auto-detected) |

Notes:

- `ws://` and `wss://` are accepted as aliases and normalized to `http`/`https` (WebSocket URLs are derived from the page's own scheme).
- Write the `{token}` segment **literally** — do not URL-encode it. It is a path segment assigned by the platform; cc-viewer matches both the literal and the percent-encoded (`%7Btoken%7D`) request forms automatically.
- If the platform later rewrites the segment to a concrete session id, set `CCV_BASE_URL` to the exact resulting prefix.

## What the path prefix affects

Everything already worked for `CCV_BASE_PATH` now works for the `CCV_BASE_URL` path:

- **HTTP routing** — the prefix is stripped before route matching, so `/api/*` and `/events` resolve normally.
- **`<base href>` + `window.__CCV_BASE_PATH__` injection** — every served `index.html` carries the prefix, so relative asset/API/WebSocket URLs resolve under it.
- **WebSocket upgrades** — the same prefix strip applies to the upgrade path (`/ws/*`, plugin sockets).
- **Plugins** — service-plugin mounts, cookie paths, and `CCV_PLUGIN_PARENT_BASE_PATH` inherit the effective prefix.
- **Startup output & browser auto-open** — the `Local`/`Network` lines include the prefix; with a host, an extra line is printed:
  ```
    ➜ External: https://arca-sandbox-office.alipay.com/arca/api/v1/session/{token}/?token=...
  ```
- **Share/QR link (`/api/local-url`)** — returns the public URL (scheme + host + prefix + ccv's own `?token=`) when the value carries a host. With a `/path`-only value there is no public host to print, so the QR link keeps the LAN-IP form — include the host if remote devices must reach the link.

## Scheme resolution for generated URLs

1. The explicit scheme in `CCV_BASE_URL` (`https://...` → `https`; `http://...` → `http`).
2. Otherwise the request's `X-Forwarded-Proto` header (first hop, `http`/`https` only) — used by `/api/local-url` when it has a request context.
3. Otherwise `https` (a host-based deployment is normally TLS-terminated in front of ccv).

WebSocket links always follow the page scheme (`https` → `wss`, `http` → `ws`) and are built from `window.location`, so they need no configuration.

## Host allowlist

When `CCV_BASE_URL` includes a host, that hostname is **always merged** into the `Host`-header allowlist (`CCV_ALLOWED_HOSTS` semantics) — otherwise every proxied request would be rejected with `403 host-not-allowed`. The merge is additive: an explicit `CCV_ALLOWED_HOSTS` list is kept, and `*` still disables the check.

## Precedence vs `CCV_BASE_PATH`

| `CCV_BASE_URL` | `CCV_BASE_PATH` | Effective prefix | Warning |
|---|---|---|---|
| unset | unset | *(none)* | — |
| unset | `/p/` | `/p/` | legacy warning if malformed |
| valid | unset | URL's path (`''` if host-only) | — |
| valid | set | URL's path | `CCV_BASE_URL takes precedence` |
| invalid | set | `/p/` (fallback) | `invalid ... falling back` |
| invalid | unset | *(none)* | `invalid ... falling back` |

"Set" means a `CCV_BASE_PATH` that normalizes to a non-empty prefix: `CCV_BASE_PATH=/` (or a malformed value) is treated as unset and produces no precedence warning.

`CCV_BASE_PATH` keeps working as before (one deliberate refinement: a bare prefix without trailing slash now serves the app root instead of falling through to the SPA fallback); `CCV_BASE_URL` only adds the host/scheme forms and the external-URL generation on top.

## Reverse-proxy requirements

cc-viewer strips the prefix **itself**, so the proxy should forward the path **unchanged** (a proxy that strips the prefix still routes correctly, but the injected `<base href>` assumes the browser-facing prefix — forwarding unchanged keeps everything predictable):

```nginx
# HTTPS — the location value contains '{', so it MUST be quoted (nginx would otherwise
# fail to parse the config). The exact-match block lets the bare prefix (no trailing
# slash) reach ccv too; ccv serves the app root for it.
location = "/arca/api/v1/session/{token}" {
    proxy_pass http://127.0.0.1:7008;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
location "/arca/api/v1/session/{token}/" {
    proxy_pass http://127.0.0.1:7008;          # no URI part — forward the path as-is
    proxy_set_header Host $http_host;          # required: Host is allowlisted + Origin-checked
                                               # ($http_host keeps a non-default port; use $host
                                               #  if you deploy on the default 443/80)
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket upgrades (terminal sockets are long-lived and idle — raise the read timeout)
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;

    # SSE (/events, log streaming): disable response buffering or events arrive in bursts
    proxy_buffering off;
}
```

The same block serves both HTTP and WebSocket traffic. If your platform injects the session token into the path (the `{token}` segment), no extra rewrite is needed.

## Security notes

- The platform's `{token}` **path segment is unrelated** to cc-viewer's own `?token=` access token. cc-viewer still enforces its own auth (token URL or password login) and Origin/Host checks on every request; the External/QR links carry ccv's token in the query string as usual.
- Auto-allowlisting only happens when you explicitly set `CCV_BASE_URL` — the same trust statement as setting `CCV_ALLOWED_HOSTS` yourself.
- Password login works under the prefix (the login page posts to the prefixed endpoint).

## Building from source

No build-time variable is needed. The published frontend is built with relative asset URLs; the runtime `<base href>` injection makes one build work at the root or under any prefix. Do **not** set `CCV_BASE_PATH` at build time for a `CCV_BASE_URL` deployment (that would hardcode asset URLs to a fixed prefix).

## Troubleshooting

- **`403 host-not-allowed`** — the proxy rewrote the `Host` header. Preserve it (`proxy_set_header Host $http_host;` — `$http_host` keeps a non-default port, which the Origin check compares), or add the public hostname to `CCV_ALLOWED_HOSTS`.
- **API requests return HTML (the SPA)** — the path cc-viewer receives doesn't start with the configured prefix. Check that `CCV_BASE_URL` includes *all* path segments the proxy forwards (a missing/extra segment is the usual cause), and that the prefix isn't duplicated. (A proxy that strips the prefix before forwarding is tolerated — unprefixed requests still route — but the injected `<base href>` assumes the browser-facing prefix, so prefer forwarding unchanged.)
- **QR/share link unreachable** — the generated URL uses `https` by default; if your deployment is plain HTTP, either write `http://` explicitly in `CCV_BASE_URL` or have the proxy send `X-Forwarded-Proto: http`.
- **Link without trailing slash** — handled automatically: the bare prefix serves the app root (make sure your proxy forwards it too — see the exact-match `location = ...` block in the example above).
