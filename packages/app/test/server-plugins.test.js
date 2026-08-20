import { describe, it, before, after } from 'node:test';
import { describeCli } from './_helpers/cli-tier.mjs';
import assert from 'node:assert/strict';
import { request, createServer } from 'node:http';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

function httpRequest(port, path, { method = 'GET', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json() { return JSON.parse(data); },
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describeCli('server plugin endpoints', { concurrency: false }, () => {
  let startViewer, stopViewer, getPort;
  let port;

  before(async () => {
    const mod = await import('../server/server.js');
    startViewer = mod.startViewer;
    stopViewer = mod.stopViewer;
    getPort = mod.getPort;
    const srv = await startViewer();
    assert.ok(srv);
    port = getPort();
    assert.ok(port > 0);
  });

  after(() => {
    stopViewer();
  });

  it('GET /api/plugins returns plugins list', async () => {
    const res = await httpRequest(port, '/api/plugins');
    assert.equal(res.status, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.plugins));
    assert.equal(typeof data.pluginsDir, 'string');
  });

  it('POST /api/plugins/upload rejects invalid file type', async () => {
    const res = await httpRequest(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'bad.txt', content: 'not js' }] },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('.js or .mjs'));
  });

  it('POST /api/plugins/upload accepts valid plugin and affects local-url', async () => {
    const pluginContent = `
      export default {
        name: 'upload-plugin',
        hooks: {
          localUrl(v) { return { url: v.url + '/u' }; }
        }
      };
    `;
    const res = await httpRequest(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-upload.js', content: pluginContent }] },
    });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-upload.js');
    assert.ok(found);
    assert.equal(found.enabled, true);

    const urlRes = await httpRequest(port, '/api/local-url');
    assert.equal(urlRes.status, 200);
    const urlData = urlRes.json();
    assert.ok(urlData.url.includes('/u'));
  });

  it('POST /api/plugins/reload returns updated list', async () => {
    const res = await httpRequest(port, '/api/plugins/reload', { method: 'POST' });
    assert.equal(res.status, 200);
    const data = res.json();
    assert.ok(Array.isArray(data.plugins));
  });

  it('DELETE /api/plugins rejects invalid filename', async () => {
    const res = await httpRequest(port, '/api/plugins?file=../../evil.js', { method: 'DELETE' });
    assert.equal(res.status, 400);
  });

  it('DELETE /api/plugins returns 404 when file missing', async () => {
    const res = await httpRequest(port, '/api/plugins?file=not-exist.js', { method: 'DELETE' });
    assert.equal(res.status, 404);
  });

  it('DELETE /api/plugins removes uploaded plugin', async () => {
    const res = await httpRequest(port, '/api/plugins?file=test-upload.js', { method: 'DELETE' });
    assert.equal(res.status, 200);
    const data = res.json();
    const found = data.plugins.find(p => p.file === 'test-upload.js');
    assert.equal(!!found, false);
  });

  // --- POST /api/plugins/install-from-url tests ---

  it('POST /api/plugins/install-from-url rejects missing url', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: {},
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('required'));
  });

  it('POST /api/plugins/install-from-url rejects invalid URL', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'not-a-url' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid URL'));
  });

  it('POST /api/plugins/install-from-url rejects non-http protocol', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'ftp://example.com/plugin.js' },
    });
    assert.equal(res.status, 400);
    assert.ok(res.json().error.includes('Invalid URL'));
  });

  it('POST /api/plugins/install-from-url returns 500 for unreachable URL', async () => {
    const res = await httpRequest(port, '/api/plugins/install-from-url', {
      method: 'POST',
      body: { url: 'https://127.0.0.1:1/nonexistent-plugin.js' },
    });
    assert.equal(res.status, 500);
    assert.ok(res.json().error.includes('Failed to fetch'));
  });

  it('POST /api/plugins/install-from-url installs a reachable plugin (success path, plugins.js:78-81)', async () => {
    // 起一个本地 origin 服务真实插件 JS，命中 installPluginFromUrl 的下载→保存成功路径，
    // 进而覆盖 route 的成功臂（loadPlugins + 200 + plugins 列表回写）。
    const pluginJs = "export default { name: 'installed-from-url', hooks: {} };\n";
    const origin = createServer((oReq, oRes) => {
      oRes.writeHead(200, { 'Content-Type': 'application/javascript' });
      oRes.end(pluginJs);
    });
    await new Promise((r) => origin.listen(0, '127.0.0.1', r));
    const oPort = origin.address().port;
    try {
      const res = await httpRequest(port, '/api/plugins/install-from-url', {
        method: 'POST',
        body: { url: `http://127.0.0.1:${oPort}/install-url-plugin.js` },
      });
      assert.equal(res.status, 200);
      const data = res.json();
      assert.ok(Array.isArray(data.plugins));
      assert.equal(typeof data.pluginsDir, 'string');
      // extract-plugin-name.mjs 子进程读出插件 export 的 name 字段 → 文件名 installed-from-url.js
      const found = data.plugins.find(p => p.file && p.file.startsWith('installed-from-url'));
      assert.ok(found, 'newly installed plugin should appear in the list');
      assert.equal(found.name, 'installed-from-url');
      // 清理：删掉刚装入的插件文件
      await httpRequest(port, `/api/plugins?file=${encodeURIComponent(found.file)}`, { method: 'DELETE' });
    } finally {
      await new Promise((r) => origin.close(r));
    }
  });

  it('DELETE /api/plugins returns 500 when unlink fails (target is a directory, plugins.js:34-36)', async () => {
    // 在 pluginsDir 下造一个与「文件名」同名的子目录，unlinkSync 对目录抛错 → 命中 catch 500 臂。
    const { getPluginsDir } = await import('../server/lib/plugin-loader.js');
    const dirAsFile = join(getPluginsDir(), 'isdir-plugin.js');
    mkdirSync(dirAsFile, { recursive: true });
    try {
      const res = await httpRequest(port, '/api/plugins?file=isdir-plugin.js', { method: 'DELETE' });
      assert.equal(res.status, 500);
      assert.ok(res.json().error, 'error message from unlink failure should be returned');
    } finally {
      if (existsSync(dirAsFile)) rmSync(dirAsFile, { recursive: true, force: true });
    }
  });

  // --- /api/perm-hook decision whitelist (fix/pr70-review B4) ---
  // server.js:2065 曾经是 `if (hookResult.decision)` 的 truthy-check，
  // plugin 返回 `decision: 'garbage'` 会被原样回转给 perm-bridge.js:133，
  // 再被 coerce 为 'deny' —— 既与 sdk-manager.js 的 strict allow/deny 白名单
  // 不对称，也违反 cb2326e 声称的 "unknown → fall through to user UI" 语义。
  // 下面两条锁死新的白名单行为。

  function permHookRequest(port, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const req = request({
        hostname: '127.0.0.1',
        port,
        path: '/api/perm-hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: data, json() { return JSON.parse(data); } }));
      });
      req.on('error', reject);
      const t = setTimeout(() => { try { req.destroy(); } catch {} reject(Object.assign(new Error('client-timeout'), { code: 'ETIMEDOUT' })); }, timeoutMs);
      req.on('close', () => clearTimeout(t));
      req.write(JSON.stringify(body));
      req.end();
    });
  }

  it('POST /api/perm-hook short-circuits when plugin returns decision:allow', async () => {
    const pluginContent = `
      export default {
        name: 'perm-whitelist-allow',
        hooks: { onPermRequest() { return { decision: 'allow' }; } }
      };
    `;
    const up = await httpRequest(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-perm-allow.js', content: pluginContent }] },
    });
    assert.equal(up.status, 200);
    try {
      const res = await permHookRequest(port, { toolName: 'Bash', input: {} }, 2000);
      assert.equal(res.status, 200);
      assert.equal(res.json().decision, 'allow');
    } finally {
      await httpRequest(port, '/api/plugins?file=test-perm-allow.js', { method: 'DELETE' });
    }
  });

  it('POST /api/perm-hook does NOT short-circuit on non-whitelist decision (falls through to long-poll)', async () => {
    const pluginContent = `
      export default {
        name: 'perm-whitelist-garbage',
        hooks: { onPermRequest() { return { decision: 'garbage' }; } }
      };
    `;
    const up = await httpRequest(port, '/api/plugins/upload', {
      method: 'POST',
      body: { files: [{ name: 'test-perm-garbage.js', content: pluginContent }] },
    });
    assert.equal(up.status, 200);
    try {
      // Plugin 返回 decision:'garbage'。修复前：server 立即 200 + {decision:'garbage'}。
      // 修复后：server 走长轮询等待真实 user 审批；这里 300ms 内肯定收不到 200。
      let shortCircuited = false;
      try {
        await permHookRequest(port, { toolName: 'Bash', input: {} }, 300);
        shortCircuited = true;
      } catch (err) {
        assert.equal(err.code, 'ETIMEDOUT', 'expected client-timeout, got ' + err.message);
      }
      assert.equal(shortCircuited, false, 'server short-circuited with non-whitelist decision — regression to pre-cb2326e truthy-check');
    } finally {
      await httpRequest(port, '/api/plugins?file=test-perm-garbage.js', { method: 'DELETE' });
    }
  });
}); 
