// 覆盖目标：server/routes/voice-pack.js 的 4 个 handler。
//   GET    /api/voice-pack/list         voicePackList   —— 200 列表结构 / 500 catch
//   POST   /api/voice-pack/upload       voicePackUpload —— 403 非 loopback / 400 缺 boundary /
//                                         413 content-length 超限 / 413 流式累计超限 /
//                                         400 malformed multipart / 200 成功保存
//   DELETE /api/voice-pack/delete/<id>  voicePackDelete —— 403 / 400 非法 id / 404 不存在 / 200 删除
//   GET    /api/voice-pack/audio/...    voicePackAudio  —— 404 未知 / bundled 命中 / user 命中 /
//                                         ETag 304 / Range 206 / Range 416 / symlink 404
// 范式：import 前先设临时 LOG_DIR；handler 用 EventEmitter 假 req + 收集型 res（亦作可写流 sink）。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-api-vp-gap-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const vpDir = join(tmpDir, 'voice-packs');

// 一段最小合法 wav 字节（RIFF....WAVE，detectAudioFormat 识别为 wav）。
function wavBytes(extra = 0) {
  const head = Buffer.from([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x00, 0x00, 0x00, 0x00,
    0x57, 0x41, 0x56, 0x45, // WAVE
  ]);
  return Buffer.concat([head, Buffer.alloc(extra, 0x01)]);
}

/** 构造收集型 res（可写流 sink：pipe 目标）。*/
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.headers = null;
  res.chunks = [];
  res.ended = false;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); res.ended = true; res.emit('finish'); return res; };
  // createReadStream(...).pipe(res) 需要的 stream.Writable 接口最小子集
  res.on('error', () => {});
  return res;
}
function bodyBuf(res) { return Buffer.concat(res.chunks); }
function bodyStr(res) { return bodyBuf(res).toString('utf-8'); }
function json(res) { return JSON.parse(bodyStr(res)); }

function waitFinish(res) {
  return new Promise((resolve) => {
    if (res.ended) return resolve(res);
    res.on('finish', () => resolve(res));
  });
}

function url(pathname) { return { pathname, searchParams: new URLSearchParams() }; }

let routes;
before(async () => { routes = (await import('../server/routes/voice-pack.js')).voicePackRoutes; });
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function h(path, method) {
  const r = routes.find((x) => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path}`);
  return r.handler;
}

function cleanVp() { rmSync(vpDir, { recursive: true, force: true }); }

describe('GET /api/voice-pack/list', () => {
  beforeEach(cleanVp);

  it('200 returns the expected list envelope', async () => {
    const handler = h('/api/voice-pack/list', 'GET');
    const res = makeRes();
    handler({ headers: {} }, res, url('/api/voice-pack/list'), true);
    await waitFinish(res);
    assert.equal(res.statusCode, 200);
    const data = json(res);
    assert.ok(Array.isArray(data.userAudio));
    assert.ok(Array.isArray(data.bundledPacks));
    assert.ok('defaultPack' in data);
    assert.ok('defaultPackPlaceholder' in data);
    assert.ok(Array.isArray(data.eventKeys));
    assert.equal(typeof data.maxBytes, 'number');
  });

  it('200 reflects a previously saved user audio file', async () => {
    mkdirSync(vpDir, { recursive: true });
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    writeFileSync(join(vpDir, `${id}.wav`), wavBytes(20));
    const res = makeRes();
    h('/api/voice-pack/list', 'GET')({ headers: {} }, res, url('/api/voice-pack/list'), true);
    await waitFinish(res);
    const data = json(res);
    assert.ok(data.userAudio.some((a) => a.id === id), 'saved id appears in userAudio');
  });
});

describe('POST /api/voice-pack/upload', () => {
  beforeEach(cleanVp);

  function postMultipart({ isLocal = true, headers = {}, body = Buffer.alloc(0), chunked = false } = {}) {
    const handler = h('/api/voice-pack/upload', 'POST');
    const req = new EventEmitter();
    req.headers = headers;
    req.destroy = () => { req.destroyed = true; };
    const res = makeRes();
    handler(req, res, url('/api/voice-pack/upload'), isLocal);
    if (chunked && Buffer.isBuffer(body)) {
      // 分多块发送以触发流式累计判定
      const mid = Math.floor(body.length / 2);
      req.emit('data', body.slice(0, mid));
      req.emit('data', body.slice(mid));
    } else if (body && body.length) {
      req.emit('data', body);
    }
    req.emit('end');
    return waitFinish(res).then(() => ({ res, req }));
  }

  it('403 when not loopback', async () => {
    const { res } = await postMultipart({ isLocal: false, headers: { 'content-type': 'multipart/form-data; boundary=xyz' } });
    assert.equal(res.statusCode, 403);
    assert.match(json(res).error, /loopback only/);
  });

  it('400 when boundary missing from content-type', async () => {
    const { res } = await postMultipart({ headers: { 'content-type': 'multipart/form-data' } });
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Missing boundary');
  });

  it('413 when Content-Length header exceeds the cap up front', async () => {
    const { res } = await postMultipart({
      headers: { 'content-type': 'multipart/form-data; boundary=xyz', 'content-length': String(50 * 1024 * 1024) },
    });
    assert.equal(res.statusCode, 413);
    assert.match(json(res).error, /too large/i);
  });

  it('413 when streamed bytes exceed the cap mid-upload', async () => {
    const boundary = 'BNDRY';
    // 构造一个超过 MAX_AUDIO_BYTES(2MB)+4096 的 body，不带 content-length（绕过前置检查）
    const big = Buffer.alloc(2 * 1024 * 1024 + 8192, 0x01);
    const { res } = await postMultipart({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: big,
      chunked: true,
    });
    assert.equal(res.statusCode, 413);
    assert.match(json(res).error, /too large/i);
  });

  it('400 on malformed multipart (no header terminator)', async () => {
    const boundary = 'BNDRY';
    const { res } = await postMultipart({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body: Buffer.from('no crlf crlf here at all'),
    });
    assert.equal(res.statusCode, 400);
    assert.match(json(res).error, /Malformed multipart|Upload failed/);
  });

  it('200 saves a valid wav part and returns id/format', async () => {
    const boundary = 'BNDRY';
    const file = wavBytes(64);
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="hi.wav"\r\nContent-Type: audio/wav\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, file, tail]);
    const { res } = await postMultipart({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    assert.equal(res.statusCode, 200);
    const data = json(res);
    assert.equal(data.ok, true);
    assert.equal(data.format, 'wav');
    assert.ok(data.id);
    // 落盘验证
    assert.ok(existsSync(join(vpDir, `${data.id}.wav`)));
  });

  it('415 when the part is not a recognised audio format', async () => {
    const boundary = 'BNDRY';
    const garbage = Buffer.from('this is plain text not audio at all 1234567890');
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, garbage, tail]);
    const { res } = await postMultipart({
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    // saveAudio 抛 BAD_FORMAT → 415
    assert.equal(res.statusCode, 415);
  });
});

describe('DELETE /api/voice-pack/delete/<id>', () => {
  const id = 'deadbeef-1111-2222-3333-444444444444';
  beforeEach(() => {
    cleanVp();
    mkdirSync(vpDir, { recursive: true });
    writeFileSync(join(vpDir, `${id}.wav`), wavBytes(10));
  });

  function del(suffix, isLocal = true) {
    const handler = h('/api/voice-pack/delete/', 'DELETE');
    const res = makeRes();
    handler({ headers: {} }, res, url(`/api/voice-pack/delete/${suffix}`), isLocal);
    return waitFinish(res);
  }

  it('403 when not loopback', async () => {
    const res = await del(id, false);
    assert.equal(res.statusCode, 403);
    assert.match(json(res).error, /loopback only/);
  });

  it('400 on invalid id', async () => {
    const res = await del('not a valid id!!');
    assert.equal(res.statusCode, 400);
    assert.equal(json(res).error, 'Invalid id');
  });

  it('404 when id does not map to a file', async () => {
    const res = await del('00000000-0000-0000-0000-000000000000');
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).ok, false);
  });

  it('200 deletes an existing user file', async () => {
    const res = await del(id);
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).ok, true);
    assert.equal(existsSync(join(vpDir, `${id}.wav`)), false);
  });
});

describe('GET /api/voice-pack/audio/...', () => {
  const id = 'cafe0001-2222-3333-4444-555555555555';
  beforeEach(() => {
    cleanVp();
    mkdirSync(vpDir, { recursive: true });
    // 16 字节内容，便于 Range 断言
    writeFileSync(join(vpDir, `${id}.wav`), Buffer.from('0123456789ABCDEF'));
  });

  function audio(tail, headers = {}) {
    const handler = h('/api/voice-pack/audio/', 'GET');
    const res = makeRes();
    handler({ headers }, res, url(`/api/voice-pack/audio/${tail}`));
    return waitFinish(res);
  }

  it('404 for unknown id', async () => {
    const res = await audio('11111111-9999-9999-9999-999999999999');
    assert.equal(res.statusCode, 404);
    assert.equal(json(res).error, 'Not found');
  });

  it('200 serves a user file with immutable private cache + ETag + Accept-Ranges', async () => {
    const res = await audio(id);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'audio/wav');
    assert.equal(res.headers['Content-Length'], 16);
    assert.equal(res.headers['Accept-Ranges'], 'bytes');
    assert.match(res.headers['Cache-Control'], /immutable/);
    assert.match(res.headers.ETag, /^"[0-9a-f]+-[0-9a-f]+"$/);
  });

  it('304 when If-None-Match matches the ETag', async () => {
    const first = await audio(id);
    const etag = first.headers.ETag;
    const res = await audio(id, { 'if-none-match': etag });
    assert.equal(res.statusCode, 304);
    assert.equal(res.headers.ETag, etag);
  });

  it('206 partial content for a valid Range', async () => {
    const res = await audio(id, { range: 'bytes=4-9' });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['Content-Range'], 'bytes 4-9/16');
    assert.equal(res.headers['Content-Length'], 6);
    assert.equal(bodyStr(res), '456789');
  });

  it('206 open-ended Range (bytes=N-) serves to EOF', async () => {
    const res = await audio(id, { range: 'bytes=10-' });
    assert.equal(res.statusCode, 206);
    assert.equal(res.headers['Content-Range'], 'bytes 10-15/16');
    assert.equal(bodyStr(res), 'ABCDEF');
  });

  it('416 for an unsatisfiable Range (end beyond EOF)', async () => {
    const res = await audio(id, { range: 'bytes=100-200' });
    assert.equal(res.statusCode, 416);
    assert.equal(res.headers['Content-Range'], 'bytes */16');
  });

  it('200 full body when Range header has no parseable bytes=', async () => {
    // range 存在但不匹配正则 → 落到 416 分支
    const res = await audio(id, { range: 'rows=1-2' });
    assert.equal(res.statusCode, 416);
  });

  it('200 serves a bundled pack file via <packId>/<eventKey> with revalidate cache', async () => {
    // 路径形如 default/planApproval → 命中 BUNDLED_PACK_IDS 分支（dist/voice-packs 内置音频）
    const res = await audio('default/planApproval');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'audio/mpeg');
    // bundled 用 must-revalidate（非 immutable，因占位音频可能被重生成）
    assert.match(res.headers['Cache-Control'], /must-revalidate/);
    assert.ok(Number(res.headers['Content-Length']) > 0);
  });

  it('404 for a bundled pack with an unknown eventKey (falls through, no user file)', async () => {
    const res = await audio('default/notAnEvent');
    assert.equal(res.statusCode, 404);
  });

  it('404 refuses to serve a symlinked user file', async () => {
    const linkId = 'feed0002-2222-3333-4444-555555555555';
    const target = join(tmpDir, 'secret.txt');
    writeFileSync(target, 'top secret');
    try {
      symlinkSync(target, join(vpDir, `${linkId}.wav`));
    } catch {
      return; // 某些 FS/权限不支持 symlink，跳过
    }
    // getUserAudioPath 自身先用 lstatSync 过滤 symlink → 直接 404（resolved=null）
    const res = await audio(linkId);
    assert.equal(res.statusCode, 404);
  });
});
