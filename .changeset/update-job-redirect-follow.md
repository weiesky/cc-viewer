---
"cc-viewer": patch
---

fix(server): in-app self-update no longer fails on registries that 302 the `.tgz` to a CDN. `downloadRelease` was fetching with `redirect: 'error'`, which undici rejects on any redirect as "unexpected redirect" → top-level "fetch failed". Now uses `redirect: 'follow'`; integrity is still enforced by the existing `verifyDigest` check, so following redirects does not widen the attack surface. Adds a regression test asserting the fetch flag.
