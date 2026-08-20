// 分支补强：server/routes/voice-pack.js
// 现有 test/api-voice-pack-gap.test.js 已覆盖 4 个 handler 的主路径(200/403/400/413/415/404/304/206/416)。
// 本文件专攻其遗漏的防御性 catch 分支:
//   - voicePackList 的 catch(42-44)        —— try 内 res.writeHead(200) 抛错 → 走 500 catch
//   - voicePackAudio 的 catch(225-227)      —— resolved 命中真实文件后, try 内 res.writeHead 抛错 → 走 500 catch
// 路由级 symlink 分支(177-180)经核为不可达:getUserAudioPath / getBundledPackPath
// 均已用 lstatSync 过滤 symlink(返回 null),故 resolved.path 永不为 symlink —— 记入 unreachable。
//
// 并行隔离:import 前设私有临时 CCV_LOG_DIR/CLAUDE_CONFIG_DIR;无端口、无共享目录。
import './_shims/register.mjs';
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-vp-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const vpDir = join(tmpDir, 'voice-packs');

/** 收集型 res;writeHead 可被 throwOnFirst 注入为「首次调用抛错」。 */
function makeRes({ throwOnStatus = null } = {}) {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.chunks = [];
  res.ended = false;
  res.writeHeadCalls = [];
  res.writeHead = (code, headers) => {
    res.writeHeadCalls.push(code);
    // 仅在第一次以 throwOnStatus 命中时抛错(模拟写响应头途中失败),
    // catch 内的二次 writeHead(500) 不再抛错。
    if (throwOnStatus != null && code === throwOnStatus && res.writeHeadCalls.length === 1) {
      throw new Error('synthetic writeHead failure');
    }
    res.statusCode = code;
    res.headers = headers || {};
    return res;
  };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); res.ended = true; res.emit('finish'); return res; };
  res.on('error', () => {});
  return res;
}
function bodyStr(res) { return Buffer.concat(res.chunks).toString('utf-8'); }
function json(res) { return JSON.parse(bodyStr(res)); }
function url(pathname) { return { pathname, searchParams: new URLSearchParams() }; }
function waitFinish(res) {
  return new Promise((resolve) => {
    if (res.ended) return resolve(res);
    res.on('finish', () => resolve(res));
  });
}

let routes;
before(async () => { routes = (await import('../server/routes/voice-pack.js')).voicePackRoutes; });
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function h(path, method) {
  const r = routes.find((x) => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path}`);
  return r.handler;
}
function cleanVp() { rmSync(vpDir, { recursive: true, force: true }); }

describe('voicePackList catch 分支(42-44)', () => {
  beforeEach(cleanVp);

  it('500 当写 200 响应头时抛错 → 落入 catch 返回 list failed', async () => {
    const handler = h('/api/voice-pack/list', 'GET');
    const res = makeRes({ throwOnStatus: 200 });
    handler({ headers: {} }, res, url('/api/voice-pack/list'), true);
    await waitFinish(res);
    assert.equal(res.statusCode, 500);
    const data = json(res);
    assert.equal(data.error, 'list failed');
    // detail 取自 err?.message —— 验证 optional-chaining 取到了合成错误信息
    assert.equal(data.detail, 'synthetic writeHead failure');
    // 两次 writeHead:首次 200(抛错) + catch 的 500
    assert.deepEqual(res.writeHeadCalls, [200, 500]);
  });
});

describe('voicePackUpload 余项分支', () => {
  beforeEach(cleanVp);

  function runUpload({ isLocal = true, headers = {}, body = Buffer.alloc(0), chunked = false } = {}) {
    const handler = h('/api/voice-pack/upload', 'POST');
    const req = new EventEmitter();
    req.headers = headers;
    req.destroy = () => { req.destroyed = true; };
    const res = makeRes();
    handler(req, res, url('/api/voice-pack/upload'), isLocal);
    if (chunked && Buffer.isBuffer(body) && body.length) {
      const mid = Math.floor(body.length / 2);
      req.emit('data', body.slice(0, mid));
      req.emit('data', body.slice(mid));
    } else if (body && body.length) {
      req.emit('data', body);
    }
    req.emit('end');
    return waitFinish(res).then(() => res);
  }

  it("400 当完全缺失 content-type 头 → `|| ''` 兜底为空串(L56),boundary 匹配失败", async () => {
    // 不带 content-type:req.headers['content-type'] 为 undefined → `|| ''` 取右侧空串。
    const res = await runUpload({ headers: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Missing boundary');
  });

  it("200 当 multipart 段无 filename → originalName 走 'upload' 兜底(L92 false 臂)", async () => {
    const boundary = 'BNDRY';
    // Content-Disposition 无 filename=,nameMatch 为 null → originalName='upload'。
    const file = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // RIFF....WAVE
      0x01, 0x01, 0x01, 0x01,
    ]);
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"\r\n\r\n`);
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, file, tail]);
    const res = await runUpload({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).ok, true);
  });

  it('200 当 multipart 无闭合 boundary → bodyEnd=-1 走 buf.slice(bodyStart) 兜底(L96 false 臂)', async () => {
    const boundary = 'BNDRY';
    const file = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // RIFF....WAVE
      0x02, 0x02, 0x02, 0x02,
    ]);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="noclose.wav"\r\n\r\n`,
    );
    // 故意不追加 `\r\n--boundary--` 闭合段 → indexOf(closingBoundary) 返回 -1。
    const body = Buffer.concat([head, file]);
    const res = await runUpload({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).ok, true);
    assert.equal(json(res).format, 'wav');
  });

  it('413 当解出的文件体超过 MAX 但流总量未越界 → saveAudio 抛 TOO_LARGE(L101 ? 413 臂)', async () => {
    const boundary = 'BNDRY';
    // 文件体取 MAX+2000:>MAX(saveAudio TOO_LARGE),且 wrapper 后总量 < MAX+4096(过流式闸)。
    const MAX = 2 * 1024 * 1024;
    const file = Buffer.alloc(MAX + 2000, 0x01); // 非合法音频亦可:TOO_LARGE 检查先于格式检测
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.wav"\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, file, tail]);
    assert.ok(body.length <= MAX + 4096, '构造的总体积须落在流式闸门以内');
    // 无 content-length 头 → 跳过前置 413(parseInt('0')=0),只能由 saveAudio 抛 TOO_LARGE。
    const res = await runUpload({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    assert.equal(res.statusCode, 413);
    assert.match(json(res).error, /too large/i);
  });
});

describe('voicePackAudio catch 分支(225-227)', () => {
  const id = 'beef0003-2222-3333-4444-555555555555';
  beforeEach(() => {
    cleanVp();
    mkdirSync(vpDir, { recursive: true });
    writeFileSync(join(vpDir, `${id}.wav`), Buffer.from('0123456789ABCDEF'));
  });

  function audio(tail, headers = {}, resOpts = {}) {
    const handler = h('/api/voice-pack/audio/', 'GET');
    const res = makeRes(resOpts);
    handler({ headers }, res, url(`/api/voice-pack/audio/${tail}`));
    return waitFinish(res);
  }

  it('500 当写 200(全量)响应头时抛错 → 落入 catch 返回 Read failed', async () => {
    // resolved 命中真实用户文件;lstatSync/statSync 正常,随后 res.writeHead(200) 抛错 → catch。
    const res = await audio(id, {}, { throwOnStatus: 200 });
    assert.equal(res.statusCode, 500);
    const data = json(res);
    assert.equal(data.error, 'Read failed');
    assert.equal(data.detail, 'synthetic writeHead failure');
    assert.deepEqual(res.writeHeadCalls, [200, 500]);
  });

  it('500 当写 206(Range)响应头时抛错 → 同一 catch', async () => {
    // 走 Range 命中分支后 writeHead(206) 抛错,验证 catch 同样兜底(覆盖 try 内 Range 子路径的失败)。
    const res = await audio(id, { range: 'bytes=4-9' }, { throwOnStatus: 206 });
    assert.equal(res.statusCode, 500);
    assert.equal(json(res).error, 'Read failed');
    assert.deepEqual(res.writeHeadCalls, [206, 500]);
  });

  it('500 当写 304 响应头时抛错 → 同一 catch', async () => {
    // 先取一次正常 ETag,再以 If-None-Match 命中 304 路径,并令 writeHead(304) 抛错。
    const first = await audio(id);
    const etag = first.headers.ETag;
    const res = await audio(id, { 'if-none-match': etag }, { throwOnStatus: 304 });
    assert.equal(res.statusCode, 500);
    assert.equal(json(res).error, 'Read failed');
    assert.deepEqual(res.writeHeadCalls, [304, 500]);
  });
});
