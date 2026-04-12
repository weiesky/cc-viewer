# CC-Viewer Plugin System

[中文版](./plugins.zh.md)

CC-Viewer provides a lightweight plugin mechanism that allows injecting custom logic at specific lifecycle points. This is particularly useful for enterprise deployments — for example, replacing the QR code's LAN URL with a corporate proxy URL.

## Quick Start

1. Create the plugins directory:

```bash
mkdir -p ~/.claude/cc-viewer/plugins
```

2. Create a plugin file (`.js` or `.mjs`):

```javascript
// ~/.claude/cc-viewer/plugins/my-plugin.js
export default {
  name: 'my-plugin',
  hooks: {
    async localUrl({ url, ip, port, token }) {
      console.error('[my-plugin] Original URL:', url);
      return { url };
    },
  },
};
```

3. Restart cc-viewer. The plugin loads automatically — no `npm install` needed.

## Plugin Directory

All plugins live in:

```
~/.claude/cc-viewer/plugins/
```

This is `LOG_DIR/plugins/` — the same base directory cc-viewer uses for logs and preferences. Enterprise IT teams can pre-populate this directory for all users.

The loader scans for all `*.js` and `*.mjs` files in this directory. Each file is one plugin.

## Plugin Format

A plugin is an ES module that default-exports an object with `name` and `hooks`:

```javascript
export default {
  name: 'plugin-name',       // Used for logging and disabling
  hooks: {
    // Define hooks here
  },
};
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | No | Plugin identifier. Defaults to filename if omitted. Used in `disabledPlugins`. |
| `hooks` | `object` | Yes | An object mapping hook names to async functions. |

## Available Hooks

### `httpsOptions` — Waterfall

Triggered at server startup to obtain HTTPS certificate options. If the returned object contains `pfx` or `cert`, the server starts in HTTPS mode; otherwise it falls back to HTTP.

| Property | Description |
|----------|-------------|
| **Type** | Waterfall (serial pipeline) |
| **Parameters** | `{}` (empty object) |
| **Returns** | `{ pfx, passphrase }` or `{ cert, key }` — TLS options passed to `https.createServer()` |
| **Timing** | Before the HTTP/HTTPS server is created |

```javascript
hooks: {
  async httpsOptions() {
    // Example: load PFX certificate from an internal package
    const { getDevPfxBuffer, getDevPassphrase } = await import('@al/xxx');
    return { pfx: await getDevPfxBuffer(), passphrase: await getDevPassphrase() };
  },
}
```

```javascript
hooks: {
  async httpsOptions() {
    // Example: load PEM cert/key from files
    const { readFileSync } = await import('node:fs');
    return {
      cert: readFileSync('/path/to/cert.pem'),
      key: readFileSync('/path/to/key.pem'),
    };
  },
}
```

### `localUrl` — Waterfall

Triggered when `/api/local-url` is requested (used by the QR code feature).

| Property | Description |
|----------|-------------|
| **Type** | Waterfall (serial pipeline) |
| **Parameters** | `{ url, ip, port, token }` |
| **Returns** | `{ url }` — the modified URL |
| **Timing** | When a client requests the local network URL |

```javascript
hooks: {
  async localUrl({ url, ip, port, token }) {
    // Replace with enterprise proxy URL
    return { url: `https://dev.company.com/proxy/${token}` };
  },
}
```

### `serverStarted` — Parallel

Triggered after the HTTP server starts successfully.

| Property | Description |
|----------|-------------|
| **Type** | Parallel (concurrent notification) |
| **Parameters** | `{ port, host, url, ip, token, protocol, httpServer }` |
| **Returns** | Ignored |
| **Timing** | After server binds to a port |

```javascript
hooks: {
  async serverStarted({ port, host, url, ip, token, protocol, httpServer }) {
    console.error(`[my-plugin] Server is running at ${url}`);
  },
}
```

### `serverStopping` — Parallel

Triggered before the server shuts down.

| Property | Description |
|----------|-------------|
| **Type** | Parallel (concurrent notification) |
| **Parameters** | `{}` |
| **Returns** | Ignored |
| **Timing** | When `stopViewer()` is called |

```javascript
hooks: {
  async serverStopping() {
    console.error('[my-plugin] Server is shutting down');
  },
}
```

### `onNewEntry` — Parallel

Triggered whenever a new JSONL log entry is detected. Useful for forwarding log data to external HTTP services, analytics platforms, or custom storage.

| Property | Description |
|----------|-------------|
| **Type** | Parallel (concurrent notification) |
| **Parameters** | `entry` — the full JSONL log entry object containing request/response data, token usage, etc. Includes `entry.pid` (Claude process PID: PTY child PID in CLI mode, `process.pid` in hook-injection mode; may be `null` if PTY is not running) |
| **Returns** | Ignored |
| **Timing** | When a new entry is appended to the JSONL log file |

```javascript
hooks: {
  async onNewEntry(entry) {
    // Forward to a remote log collection service
    fetch('https://logs.company.com/api/collect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
  },
}
```

```javascript
hooks: {
  async onNewEntry(entry) {
    // Only forward MainAgent requests
    if (entry.mainAgent) {
      fetch('https://analytics.company.com/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    }
  },
}
```

## Hook Execution Models

### Waterfall

Plugins execute **sequentially** in filename sort order. Each plugin receives the return value of the previous one. The final value is used by cc-viewer.

```
initial value → plugin-A → plugin-B → plugin-C → final value
```

If a plugin returns `null`/`undefined`, the value passes through unchanged.

### Parallel

All plugins execute **concurrently**. Return values are ignored. Used for notifications/side effects.

## Error Isolation

Every hook call is wrapped in `try/catch`. If a plugin throws an error:

- The error is logged to stderr: `[CC Viewer] Plugin "name" hook "hookName" error: message`
- Other plugins and the host application are **not** affected
- For waterfall hooks, the value passes through to the next plugin unchanged

## Disabling Plugins

Add plugin names to `disabledPlugins` in `~/.claude/cc-viewer/preferences.json`:

```json
{
  "disabledPlugins": ["my-plugin", "another-plugin"]
}
```

Disabled plugins are skipped during loading.

## Complete Example: Enterprise Proxy

```javascript
// ~/.claude/cc-viewer/plugins/enterprise-proxy.js
export default {
  name: 'enterprise-proxy',
  hooks: {
    async localUrl({ url, ip, port, token }) {
      // Replace LAN URL with corporate proxy
      return { url: `https://dev.company.com/proxy/${token}` };
    },

    async serverStarted({ port, host }) {
      // Notify internal monitoring system
      fetch('https://monitor.company.com/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service: 'cc-viewer', port, host }),
      }).catch(() => {});
    },

    async serverStopping() {
      // Cleanup
    },

    async onNewEntry(entry) {
      // Forward logs to analytics platform
      fetch('https://analytics.company.com/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => {});
    },
  },
};
```

## Notes

- Plugins are loaded once at server startup. Adding/removing plugins requires a restart.
- If the plugins directory does not exist, the loader silently returns with zero overhead.
- Plugin files are sorted by filename before loading, which determines waterfall execution order.
- Use filename prefixes (e.g., `00-first.js`, `99-last.js`) to control execution order.
