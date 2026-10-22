---
"cc-viewer": patch
---

feat(server+web): directory-shaped service plugins — independent child-process HTTP/WS services mounted on the main port under `/plugins/<name>/*`, full activate/deactivate/onError lifecycle with hot reload, plus remote React component panels hot-mounted into the web UI (desktop modal + mobile overlay) via `window.CCV.registerPanel`. Third-party docs: `docs/plugin-services.md` / `docs/plugin-services.zh.md`.
