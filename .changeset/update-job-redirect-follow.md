---
"cc-viewer": patch
---

Fix in-app self-update failing on tnpm-style registries that 302 the `.tgz` to a CDN. `downloadRelease` was fetching with `redirect: 'error'`, which undici rejects on any redirect as "unexpected redirect" → top-level "fetch failed". Now uses `redirect: 'follow'`; integrity is still enforced by the existing `verifyDigest` shasum check, so following redirects does not widen the attack surface. Adds a regression test asserting the fetch flag.
