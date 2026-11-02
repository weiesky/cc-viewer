# Service Plugins & Panel Plugins

> 中文文档：[plugin-services.zh.md](./plugin-services.zh.md)

cc-viewer supports two plugin shapes:

| Shape | File form | Runs in | Capabilities |
|---|---|---|---|
| **Hook plugin** | single `.js`/`.mjs` file | main process | the 10 hooks (`beforeRequest`, `serverStarted`, `onPermRequest`, …) — unchanged |
| **Service plugin** | directory with `plugin.json` | main process **and** a detached child process | everything hook plugins can do, **plus**: an independent HTTP/WS service mounted on the same port, an optional React panel in the web UI, and a full `activate`/`deactivate`/`onError` lifecycle with hot reload |

This document covers service plugins. For hook-plugin basics see [plugins.md](./plugins.md).

---

## 1. Directory layout

```
~/.claude/cc-viewer/plugins/
  legacy-hook.js                ← hook plugin (unchanged)
  hello-service/                ← service plugin
    plugin.json                 ← manifest (required)
    main.mjs                    ← main-process module: hooks + lifecycle (optional)
    service.mjs                 ← child-process entry: its own HTTP server (optional)
    panel/
      index.js                  ← panel bundle: remote React component (optional)
      index.css                 ← panel stylesheet (optional)
```

All three parts are optional and composable: a plugin may be service-only, panel-only,
or hooks+lifecycle only.

## 2. plugin.json (v1)

```json
{
  "name": "hello-service",
  "version": "1.0.0",
  "main": "main.mjs",
  "service": {
    "entry": "service.mjs",
    "prefix": "/plugins/hello-service",
    "env": { "HELLO_MODE": "demo" }
  },
  "panel": {
    "entry": "panel/index.js",
    "css": "panel/index.css",
    "title": { "en": "Hello Service", "zh": "Hello 服务" },
    "icon": "appstore",
    "width": 1100,
    "desktopOnly": false
  },
  "config": {
    "defaults": { "greeting": "hi" }
  }
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; unique across plugins; used in URLs and `disabledPlugins` |
| `version` | no | shown in UI; part of the hot-reload fingerprint |
| `main` | no | defaults to probing `main.mjs → main.js → index.mjs → index.js` |
| `service.entry` | with `service` | must resolve inside the plugin dir (no `..`, no symlink escape) |
| `service.prefix` | no | defaults to `/plugins/<name>`; in v1 it **must equal `/plugins/<name>`** (custom prefixes are rejected — the mount table routes by name) |
| `service.env` | no | static env for the child; `CCV_*`/`CCVIEWER_*` keys are rejected |
| `panel.entry` | with `panel` | a **`.js` bundle inside a subdirectory** (iframe-style `.html` panels are not supported) |
| `panel.css` | no | same directory as `panel.entry` |
| `panel.title` | no | string or `{lang: string}` map; defaults to `name` |
| `panel.icon` | no | one of `api / dashboard / appstore / tool / database / chart / file / global` |
| `panel.width` | no | desktop modal width, clamped to 360–1600 (default 1100) |
| `panel.desktopOnly` | no | hide the menu entry on mobile |
| `config.defaults` | no | static defaults exposed as `ctx.config` |

Manifest errors (bad JSON, bad name/prefix, escaping paths) skip the plugin with a
`loadError` — the rest of the plugins keep loading.

## 3. Main-process module (main.mjs)

```js
export default {
  // Optional: the same hooks a single-file plugin may use.
  hooks: {
    async beforeRequest(ctx) { /* ... */ },
  },

  // Called after the plugin is loaded AND (for service plugins) its child process
  // is ready and mounted. Keep main.mjs light — heavy work belongs in service.mjs
  // (loadPlugins runs before the HTTP server listens and cannot be timed out).
  async activate(ctx) {},

  // Called before unload: 'reload' | 'disable' | 'delete' | 'serverStopping' | 'restart'.
  // Do NOT rely on your service being alive here (it may already be SIGTERMed).
  async deactivate(reason) {},

  // Called on activate failure, spawn failure, unexpected child exit, health failure.
  async onError(err, info) {}, // info: { phase, exitCode?, signal?, pid? }
};
```

### PluginContext

```ts
interface PluginContext {
  name: string;
  version: string | null;
  pluginDir: string;
  dataDir: string;              // <log_dir>/plugin-data/<name>/ (created, 0700)
  basePath: string;             // '' or '/ccv' when CCV_BASE_PATH is set
  server: {
    port: number; host: string; protocol: 'http' | 'https'; url: string;
    token: string;              // ACCESS_TOKEN (sensitive)
    internalToken: string;      // INTERNAL_TOKEN (sensitive)
    httpServer: import('node:http').Server;
    pty: object | null;         // CLI mode only
    interactions: object;       // pending perm/ask resolvers (same as serverStarted hook)
  };
  service: {                    // service plugins only — LIVE object, updated in place
    prefix: string;             //   across crash restarts, so the reference you hold
    port: number; pid: number;  //   never goes stale
    baseUrl: string;            // http://127.0.0.1:<port>
    secret: string;             // the proxy-injected x-ccv-plugin-secret
    status(): ServiceStatus;  // 'pending'|'starting'|'ready'|'restarting'|'crashed'|'stopping'|'stopped'|'blocked'|'error'
    restart(): Promise<{ ok: boolean, status: ServiceStatus }>;
  } | null;
  panel: { url: string; title: string } | null;
  config: Readonly<object>;     // manifest config.defaults (no runtime writes in v1)
  logger: { debug/info/warn/error(...): void };
  events: {
    on(event: 'new_entry' | 'stream_chunk', cb): () => void; // auto-unsubscribed on deactivate
  };
  signal: AbortSignal;          // aborted on deactivate/unload
  isStopping(): boolean;
}
```

## 4. Child process (service.mjs)

The child is a **separate detached Node process** running your `service.entry`. It must:

1. create an HTTP server on `127.0.0.1:0` (OS-assigned port — no port races);
2. write its lock file (the host SDK does this for you);
3. answer `GET /__ccv/health` with the shared secret (SDK handles it);
4. honor SIGTERM for graceful shutdown (SDK handles it).

Use the host SDK via the `CCV_PLUGIN_HOST` file URL:

```js
const { startPluginService, WebSocketServer } = await import(process.env.CCV_PLUGIN_HOST);

await startPluginService({
  onRequest(req, res) {
    // every request here already passed x-ccv-plugin-secret verification
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  },
  onUpgrade(req, socket, head) {       // optional, for WebSocket
    const wss = new WebSocketServer({ noServer: true });
    wss.on('connection', ws => ws.on('message', m => ws.send('echo:' + m)));
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  },
});
```

The SDK also exports `config` (parsed plugin config), `plugin`
(name/version/dir/dataDir), `parent` (port/basePath/url), and `callParent(path, init)`
for calling back into the host API.

**Dependency boundary:** the child's cwd is the plugin directory, so bare imports only
resolve Node builtins and this SDK. You cannot `import 'express'` (or any other package)
unless you vendor it inside your plugin directory. `ws` is re-exported by the SDK —
never `import 'ws'` directly.

## 5. Same-port mounting (proxy semantics)

| Path | Owner | Auth |
|---|---|---|
| `/plugins/<name>/*` | proxied to the child (prefix stripped, query kept, `token` removed) | host `decideAuth` |
| `/plugins/<name>` | 308 → `/plugins/<name>/` | host `decideAuth` |
| `/plugin-panels/<name>/*` | host serves the panel bundle directory statically | exempt (static) |
| `/api/plugin-panels` | panel manifest list | read auth |

Proxy details you can rely on:

- Streaming end-to-end: request/response bodies are piped (SSE works; no buffering,
  no compression by the proxy, no response timeout once headers arrive).
- Headers: `host` rewritten, `x-forwarded-host/proto/prefix/for` added,
  `x-ccv-plugin-secret` injected (client-sent copies are overwritten),
  `cookie`/`authorization` stripped, hop-by-hop headers removed.
- `Location` on same-origin redirects gets the plugin prefix prepended;
  `Set-Cookie` gets `Path=<prefix>/` and no `Domain`; `ccv_auth` cookies are dropped.
- WebSocket upgrades are tunneled as raw bytes (permessage-deflate etc. negotiated
  directly between your client and your service).
- Failure semantics: unknown plugin → 404; disabled → 404; crashed/starting → 503.
- CORS: plugin APIs are for same-origin panels; cross-origin CORS is not supported
  (the host answers all `OPTIONS` itself).

## 6. Panel (remote React component)

A panel is a **React component hot-mounted into the host UI** — desktop antd Modal,
mobile full-screen overlay. No iframe.

```jsx
// src/Panel.jsx (built to panel/index.js — see §7)
export default function Panel(props) {
  const { name, version, theme, lang, isMobile, project, instance, status,
          basePath, assetBaseUrl, apiUrl, pluginApiUrl, pluginWsUrl, onClose } = props;
  // render with the host's antd (theme comes free)
}
window.CCV.registerPanel('hello-service', Panel); // synchronous, top level
```

Contract notes:

- `registerPanel(name, Component)` must run **synchronously** during bundle evaluation
  (the host matches it against the injected `<script data-ccv-load>`; async registration
  is rejected).
- Shared deps: your bundle must resolve `react`, `react-dom`, `antd` (incl. deep
  imports) to `window.CCV.deps` — the build template does this for you. A second React
  copy breaks hooks; a second antd copy breaks theming.
- `pluginApiUrl(path)` / `pluginWsUrl(path)` build authenticated URLs to your service
  (token/cookie handled); `apiUrl(path)` targets host APIs; `assetBaseUrl` prefixes
  your static assets.
- Side effects only inside effects with cleanup — the bundle re-executes on every
  open, and module-level timers/listeners accumulate across opens.
- Styling: prefix your classes (`ccv-<name>-*`); no bare element selectors, no
  `!important`, don't override global `.ant-*`. Theme via the host CSS variables
  (`var(--bg-base)`, `var(--text-primary)`, …) — they follow `data-theme` automatically.
- The panel re-loads when its fingerprint changes (the manifest list embeds it in
  `entryUrl`), so a rebuild + plugin reload picks the new bundle up. An already-open
  panel is not hot-swapped — close and reopen.
- **Security:** panels run with the same privileges as the host page (DOM, cookies,
  any API call). A panel is trusted code — installing a panel plugin is like
  installing software. Only install plugins you trust.

## 7. Building a panel

Use the template in `docs/plugin-templates/panel/`:

```bash
cp -r docs/plugin-templates/panel /path/to/your/plugin-dir
cd /path/to/your/plugin-dir
cp plugin.json.example plugin.json   # then edit name/title
pnpm install
node build.mjs                       # writes panel/index.js (+ .css if imported)
```

The build script bundles to a single IIFE and rewrites react/react-dom/antd imports to
`window.CCV.deps`. Limitations: no dynamic `import()`, no code splitting, no top-level
await; keep React 18 / antd 5 major versions aligned with the host.

## 8. Hot reload semantics

`POST /api/plugins/reload` (or the Reload button) performs:

1. `deactivate('reload')` on every loaded plugin and SIGTERM on every service child run
   **in parallel** (`Promise.allSettled`), escalating to SIGKILL on timeout; proxy
   connections destroyed;
2. re-scan + re-import (fingerprint cache-bust — unchanged mains are reused);
3. spawn → health-check → mount → `activate(ctx)`.

- Editing `service.mjs`: fully picked up on reload (the child restarts wholesale).
- Editing `main.mjs`: picked up (fingerprint busts the import).
- Editing a **helper** imported by `main.mjs`: **not** picked up. The main is re-imported
  with a cache-busting query, but its static imports resolve to the helper's unqueried
  URL and Node's ESM cache returns the old module — touching `main.mjs` does not help.
  Restart the cc-viewer process for helper changes.
- Editing the panel bundle: picked up on next panel open (fingerprinted URL).
- Per-plugin failure isolation: one broken plugin goes offline with `loadError`; the
  others keep running.

## 9. Management API

| Endpoint | Notes |
|---|---|
| `GET /api/plugins` | list incl. `type`/`serviceStatus` (running state, lastError) |
| `POST /api/plugins/reload` | hot reload everything (single-flight) |
| `POST /api/plugins/restart?name=<name>` | restart one service child |
| `DELETE /api/plugins?file=<f>` | delete a single-file plugin |
| `DELETE /api/plugins?dir=<name>` | unload + recursively delete a directory plugin |
| `POST /api/plugins/upload` | single-file upload only (directories: copy the folder + reload) |
| `POST /api/plugins/install-from-url` | single-file install only |
| `GET /api/plugin-panels` | panel manifest list for the web UI |

## 10. Security model

- Service plugins run **detached child processes on your machine**; hook plugins and
  panel bundles execute with full host privileges. Isolation here is for crash
  containment and hot reload — **not** a security sandbox. Install only trusted code.
- Any client holding the ACCESS_TOKEN (including a phone that scanned the QR code) can
  read the plugin surface — treat the token as full admin. **Write endpoints are now
  gated on admin AND same-origin**: reload/restart/upload/install/delete (and
  `GET /api/local-url`, which returns the token itself) require a loopback or
  authenticated-remote admin *and* a same-origin browser context. CLI/native clients
  that send no `Origin` header keep working; cross-site pages are rejected with 403.
- **Reverse-proxy deployment:** keep the original `Host` header (do not rewrite it) and,
  preferably, set `X-Forwarded-Proto` to the external scheme. WebSocket upgrades and the
  write endpoints validate the browser `Origin` against `Host`; a proxy that rewrites
  `Host`/`Origin` or strips the scheme will cause those requests to be rejected.
- Panel static files are publicly readable on the network interface (auth-exempt
  static) — never embed secrets in bundles; your APIs stay authenticated.
- The child only listens on loopback and requires the per-spawn secret, so the host
  proxy is the only practical caller.

## 11. Environment specifics

- **Electron:** every server process (the management server + each tab worker) runs its
  own instance of every enabled service plugin. Plugins with external side effects
  (bound ports, singleton resources) will run once per tab — design accordingly.
  IM worker processes never activate service plugins.
- **Windows:** process-group kill uses `taskkill /T /F`; locks and configs are per
  server PID, so concurrent cc-viewer instances don't collide.
- **CCV_BASE_PATH:** the proxy strips it before forwarding; your service always sees
  unprefixed paths. `x-forwarded-prefix` carries `<basePath><pluginPrefix>`.
