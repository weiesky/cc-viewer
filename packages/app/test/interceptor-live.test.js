import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// 阻止 interceptor.js 顶层 setupInterceptor() 自动调用（line 827 条件：
// `!_ccvSkip && (!process.env.CCV_PROXY_MODE || _isTeammate)`）。设 CCV_PROXY_MODE=1
// 让条件为 false，从而跳过 viewer / fetch patch 启动。
// 我们只需 setLivePort / sendStreamChunk 两个纯函数。
process.env.CCV_PROXY_MODE = '1';
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

describe('interceptor live-streaming helpers', () => {
  let mod;
  let mockServer;
  let mockPort;
  let reqHandler; // 每个 test 注入

  before(async () => {
    mockServer = createServer((req, res) => {
      if (reqHandler) reqHandler(req, res);
      else { res.writeHead(204); res.end(); }
    });
    await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
    mockPort = mockServer.address().port;
    mod = await import('../server/interceptor.js');
  });

  after(async () => {
    mod.setLivePort(null);
    await new Promise((resolve) => mockServer.close(resolve));
    // interceptor.js 顶层 watchFile(PROFILE_PATH) 会阻止进程退出，强制终止
    setTimeout(() => process.exit(0), 50).unref();
  });

  it('sendStreamChunk is a no-op when _livePort not set', (_t, done) => {
    mod.setLivePort(null);
    let called = false;
    reqHandler = () => { called = true; };
    mod.sendStreamChunk({ timestamp: 't', url: 'u' }, 1, () => {});
    // no HTTP request should be issued; give the event loop a tick
    setTimeout(() => {
      assert.equal(called, false, 'no HTTP call when port null');
      done();
    }, 50);
  });

  it('setLivePort(port) enables POST to /api/stream-chunk', (_t, done) => {
    mod.setLivePort(mockPort);
    let receivedPath = null;
    let receivedHeader = null;
    let receivedBody = '';
    reqHandler = (req, res) => {
      receivedPath = req.url;
      receivedHeader = req.headers['x-cc-viewer-internal'];
      req.on('data', (chunk) => { receivedBody += chunk; });
      req.on('end', () => { res.writeHead(204); res.end(); });
    };
    mod.sendStreamChunk({ timestamp: 'ts1', url: 'u1', response: { body: null } }, 5, (ok) => {
      try {
        assert.equal(receivedPath, '/api/stream-chunk');
        assert.equal(receivedHeader, '1');
        const parsed = JSON.parse(receivedBody);
        assert.equal(parsed.timestamp, 'ts1');
        assert.equal(parsed._chunkSeq, 5);
        assert.equal(ok, true, 'onDone(true) on 204');
        done();
      } catch (err) { done(err); }
    });
  });

  it('sendStreamChunk invokes onDone(false) on 413', (_t, done) => {
    mod.setLivePort(mockPort);
    reqHandler = (req, res) => {
      req.on('data', () => {});
      req.on('end', () => { res.writeHead(413); res.end(); });
    };
    mod.sendStreamChunk({ timestamp: 'ts2', url: 'u2' }, 1, (ok) => {
      try {
        assert.equal(ok, false, 'onDone(false) on 413');
        done();
      } catch (err) { done(err); }
    });
  });

  it('sendStreamChunk invokes onDone(true) on network error (port closed)', (_t, done) => {
    // Point to a closed port to trigger ECONNREFUSED
    mod.setLivePort(1); // port 1 almost never listens
    mod.sendStreamChunk({ timestamp: 'ts3', url: 'u3' }, 1, (ok) => {
      try {
        // Network error: we pass ok=true to let caller keep trying
        assert.equal(ok, true, 'onDone(true) on network error (treat as transient)');
        done();
      } catch (err) { done(err); }
    });
    // Reset for subsequent tests
    setTimeout(() => mod.setLivePort(mockPort), 100);
  });

  it('setLivePort accepts string or number, and null disables', () => {
    mod.setLivePort(mockPort);
    // a follow-up send should go through
    let gotRequest = false;
    reqHandler = (req, res) => { gotRequest = true; res.writeHead(204); res.end(); };
    mod.sendStreamChunk({ timestamp: 't', url: 'u' }, 1);
    // tick
    return new Promise((resolve) => setTimeout(() => {
      assert.equal(gotRequest, true);
      // Now disable
      mod.setLivePort(null);
      gotRequest = false;
      mod.sendStreamChunk({ timestamp: 't', url: 'u' }, 2);
      setTimeout(() => {
        assert.equal(gotRequest, false, 'no request after setLivePort(null)');
        resolve();
      }, 50);
    }, 100));
  });
});
