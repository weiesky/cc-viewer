// wire-v2 S6a — zip transport for v2 session download/upload.
//   server/lib/log-zip.js  extractV2Zip  —— round-trip, both zip shapes, rejections
//   server/routes/logs.js  downloadLog(format=raw) —— binary zip response
//   server/routes/logs.js  uploadLogZip           —— stream rebuild + temp cleanup
// Fast tier: real V2Writer builds an on-disk session, adm-zip round-trips it,
// the adapter re-synthesizes it. env-before-import per the repo convention.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const LOG_DIR = mkdtempSync(join(tmpdir(), 'ccv-logzip-'));
process.env.CCV_LOG_DIR = LOG_DIR;
process.env.CLAUDE_CONFIG_DIR = LOG_DIR;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

const AdmZip = (await import('adm-zip')).default;
const { V2Writer } = await import('../server/lib/v2/v2-writer.js');
const { iterateV2RawEntries } = await import('../server/lib/v2/adapter.js');
const { streamRawEntriesAsync } = await import('../server/lib/log-stream.js');
const { resolveSessionDirName } = await import('../server/lib/v2/session-select.js');
const { extractV2Zip, boundedGetData } = await import('../server/lib/log-zip.js');
const { logsRoutes } = await import('../server/routes/logs.js');

const deps = { MAX_POST_BODY: 1024 * 1024 };
const SID = 'a9883ab8-0ab7-459a-bcfd-4c8950a14384';
const SYSTEM = [{ type: 'text', text: 'You are Claude Code, the official CLI.' }];
const TOOLS = [{ name: 'Edit', input_schema: {} }, { name: 'Bash', input_schema: {} }, { name: 'Agent', input_schema: {} }];
const userIdOf = (sid) => JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: sid });
const textMsg = (role, text) => ({ role, content: [{ type: 'text', text }] });

let tsCounter = 0;
const nextTs = () => new Date(Date.UTC(2026, 6, 13, 5, 0, 0, ++tsCounter)).toISOString();

function mainEntry(messages) {
  return {
    timestamp: nextTs(), project: 'proj', url: 'https://api.anthropic.com/v1/messages?beta=true', method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { model: 'claude-fable-5', system: SYSTEM, tools: TOOLS, metadata: { user_id: userIdOf(SID) }, messages },
    response: null, duration: 0, isStream: false, isHeartbeat: false, isCountTokens: false, mainAgent: true,
    requestId: `rid_${++tsCounter}`,
  };
}
function fire(w, entry) {
  const h = w.ingestRequest(entry, entry.body.messages);
  w.ingestCompletion(h, { ...entry, response: { status: 200, headers: {}, body: { content: [], stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 7 } } }, duration: 42 });
  return h;
}

let sessionDir;         // <LOG_DIR>/proj/sessions/<ts>_<uuid>
let sourceEntries;      // adapter output read directly off the source dir
let v2Ref;              // v2:proj/<dirName>

before(async () => {
  const w = new V2Writer({ logDir: LOG_DIR, project: 'proj', enabled: true, minFreeBytes: 0 });
  fire(w, mainEntry([textMsg('user', 'first prompt')]));
  fire(w, mainEntry([textMsg('user', 'first prompt'), textMsg('assistant', 'ok'), textMsg('user', 'second prompt')]));
  await w.flush();
  await w.close();
  const projectDir = join(LOG_DIR, 'proj');
  const dirName = resolveSessionDirName(projectDir, SID) || SID;
  sessionDir = join(projectDir, 'sessions', dirName);
  v2Ref = `v2:proj/${dirName}`;
  sourceEntries = [...iterateV2RawEntries(sessionDir)].map((r) => JSON.parse(r));
  assert.ok(sourceEntries.length >= 2, 'source session must synthesize entries');
});
after(() => { rmSync(LOG_DIR, { recursive: true, force: true }); });

// zip the source dir wrapped under `<dirName>/` (mirrors the download handler)
function zipSource() {
  const zip = new AdmZip();
  zip.addLocalFolder(sessionDir, require_basename(sessionDir), (n) => !/(^|\/)\./.test(n));
  return zip.toBuffer();
}
function require_basename(p) { return p.split(/[\\/]/).pop(); }

async function readDir(dir) {
  const out = [];
  await streamRawEntriesAsync(dir, (raw) => out.push(JSON.parse(raw)));
  return out;
}

// ─── extractV2Zip round-trip ────────────────────────────────────────────────
describe('extractV2Zip round-trip', () => {
  it('wrapped <dir>/ zip → nested sessions/<sid> → adapter output equals source (count > 0)', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'ccv-logzip-x-'));
    try {
      const dir = extractV2Zip(zipSource(), parent);
      assert.ok(dir.endsWith(join('sessions', require_basename(sessionDir))), 'must nest under sessions/<sid>');
      const got = await readDir(dir);
      assert.ok(got.length > 0, 'must synthesize entries (guards the sessions/ nesting bug)');
      assert.deepEqual(got, sourceEntries);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });

  it('bare-root zip (files at depth 0, no wrapping folder) also round-trips', async () => {
    const zip = new AdmZip();
    zip.addLocalFolder(sessionDir, '', (n) => !/(^|\/)\./.test(n)); // no root prefix
    const parent = mkdtempSync(join(tmpdir(), 'ccv-logzip-x-'));
    try {
      const dir = extractV2Zip(zip.toBuffer(), parent);
      const got = await readDir(dir);
      assert.ok(got.length > 0);
      assert.deepEqual(got, sourceEntries);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});

// ─── extractV2Zip rejections ────────────────────────────────────────────────
describe('extractV2Zip rejections', () => {
  const parentOf = () => mkdtempSync(join(tmpdir(), 'ccv-logzip-r-'));

  it('corrupt archive → 400 INVALID_ZIP', () => {
    const p = parentOf();
    try { assert.throws(() => extractV2Zip(Buffer.from('not a zip'), p), (e) => e.status === 400 && e.code === 'INVALID_ZIP'); }
    finally { rmSync(p, { recursive: true, force: true }); }
  });

  it('zip with no journal.jsonl (e.g. a v1 .jsonl inside) → 400 NOT_V2', () => {
    const zip = new AdmZip();
    zip.addFile('session.jsonl', Buffer.from('{"timestamp":"t"}\n---\n'));
    const p = parentOf();
    try { assert.throws(() => extractV2Zip(zip.toBuffer(), p), (e) => e.status === 400 && e.code === 'NOT_V2'); }
    finally { rmSync(p, { recursive: true, force: true }); }
  });

  it('zip-slip entry is not written outside the target', () => {
    const zip = new AdmZip();
    zip.addFile('s/journal.jsonl', Buffer.from('{"ph":"meta","wireFormat":2}\n'));
    zip.addFile('s/../../escape.txt', Buffer.from('pwned'));
    const p = parentOf();
    try {
      extractV2Zip(zip.toBuffer(), p);
      assert.ok(!existsSync(join(p, 'escape.txt')), 'zip-slip must not escape');
      assert.ok(!existsSync(join(p, '..', 'escape.txt')));
    } finally { rmSync(p, { recursive: true, force: true }); }
  });

  it('symlink entry → 400 INVALID_ZIP (0o170000 mask rejects symlink, keeps regular files)', () => {
    const zip = new AdmZip();
    zip.addFile('s/journal.jsonl', Buffer.from('{"ph":"meta","wireFormat":2}\n'));
    const link = zip.addFile('s/link', Buffer.from('/etc/passwd'));
    // stamp S_IFLNK (0o120000) into the external attributes high word
    link.attr = (0o120777 << 16) >>> 0;
    const p = parentOf();
    try { assert.throws(() => extractV2Zip(zip.toBuffer(), p), (e) => e.status === 400 && e.code === 'INVALID_ZIP'); }
    finally { rmSync(p, { recursive: true, force: true }); }
  });

  it('entry-count over ceiling → 400 ZIP_BOMB', () => {
    const zip = new AdmZip();
    zip.addFile('s/journal.jsonl', Buffer.from('{"ph":"meta","wireFormat":2}\n'));
    zip.addFile('s/blobs/a.json', Buffer.from('{}'));
    zip.addFile('s/blobs/b.json', Buffer.from('{}'));
    const p = parentOf();
    try { assert.throws(() => extractV2Zip(zip.toBuffer(), p, { maxEntryCount: 1 }), (e) => e.status === 400 && e.code === 'ZIP_BOMB'); }
    finally { rmSync(p, { recursive: true, force: true }); }
  });

  it('declared per-file size over ceiling → 400 ZIP_BOMB (Pass 1)', () => {
    const zip = new AdmZip();
    zip.addFile('s/journal.jsonl', Buffer.from('{"ph":"meta","wireFormat":2}\n'));
    zip.addFile('s/big', Buffer.alloc(4096, 0x61));
    const p = parentOf();
    try { assert.throws(() => extractV2Zip(zip.toBuffer(), p, { maxPerFile: 1024 }), (e) => e.status === 400 && e.code === 'ZIP_BOMB'); }
    finally { rmSync(p, { recursive: true, force: true }); }
  });

  it('total declared size over ceiling → 400 ZIP_BOMB (Pass 1 running sum)', () => {
    const zip = new AdmZip();
    zip.addFile('s/journal.jsonl', Buffer.from('{"ph":"meta","wireFormat":2}\n'));
    zip.addFile('s/a', Buffer.alloc(2000, 0x61));
    zip.addFile('s/b', Buffer.alloc(2000, 0x62));
    const p = parentOf();
    // each member under maxPerFile (5000) but the running total trips maxTotal (3000)
    try { assert.throws(() => extractV2Zip(zip.toBuffer(), p, { maxPerFile: 5000, maxTotal: 3000 }), (e) => e.status === 400 && e.code === 'ZIP_BOMB'); }
    finally { rmSync(p, { recursive: true, force: true }); }
  });

  it('boundedGetData caps real deflate inflation → ZIP_BOMB (the anti-bomb guard skills.js lacks)', () => {
    const zip = new AdmZip();
    zip.addFile('big.txt', Buffer.alloc(50000, 0x61)); // highly compressible → stored as deflate
    const e = new AdmZip(zip.toBuffer()).getEntries()[0];
    assert.equal(e.header.method, 8, 'fixture must be deflate to exercise the bounded inflate');
    // cap below the real inflated size → zlib maxOutputLength throws before ballooning
    assert.throws(() => boundedGetData(e, 1024), (er) => er.status === 400 && er.code === 'ZIP_BOMB');
    // under the cap: identical bytes to adm-zip's own getData()
    assert.deepEqual(boundedGetData(e, 1024 * 1024), e.getData());
  });

  it('a filename with ".." as a substring (not a path segment) is preserved', () => {
    const zip = new AdmZip();
    zip.addFile('s/journal.jsonl', Buffer.from('{"ph":"meta","wireFormat":2}\n'));
    zip.addFile('s/weird..name.json', Buffer.from('{"ok":1}'));
    const p = parentOf();
    try {
      const dir = extractV2Zip(zip.toBuffer(), p);
      assert.ok(existsSync(join(dir, 'weird..name.json')), 'legit ".." substring name must survive the segment check');
    } finally { rmSync(p, { recursive: true, force: true }); }
  });
});

// ─── HTTP handlers ──────────────────────────────────────────────────────────
function handler(path, method) {
  const r = logsRoutes.find((x) => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path}`);
  return r.handler;
}
// Buffer-preserving res (the shared api-logs-gap makeRes coerces to string and
// corrupts the binary zip from res.end(buf)).
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 0; res.headers = null; res.chunks = []; res.headersSent = false; res.writableEnded = false;
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; res.headersSent = true; return res; };
  res.write = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true; };
  res.end = (c) => { if (c != null) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); res.writableEnded = true; res.emit('finish'); return res; };
  res.on('error', () => {});
  return res;
}
const resBuffer = (res) => Buffer.concat(res.chunks);
const url = (pathname, query = {}) => ({ pathname, searchParams: new URLSearchParams(query) });

describe('GET /api/download-log?format=raw (v2 zip)', () => {
  it('returns a zip that unpacks to the same session', async () => {
    const res = makeRes();
    await new Promise((resolve) => {
      res.on('finish', resolve);
      Promise.resolve(handler('/api/download-log', 'GET')({ headers: {} }, res, url('/api/download-log', { file: v2Ref, format: 'raw' }))).catch(resolve);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/zip');
    const parent = mkdtempSync(join(tmpdir(), 'ccv-logzip-dl-'));
    try {
      const dir = extractV2Zip(resBuffer(res), parent);
      assert.deepEqual(await readDir(dir), sourceEntries);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});

describe('POST /api/upload-log-zip', () => {
  function callUpload(buf, headers = {}) {
    const req = new EventEmitter();
    req.headers = { 'content-length': String(buf.length), ...headers };
    const res = makeRes();
    return new Promise((resolve) => {
      res.on('finish', () => resolve(res));
      handler('/api/upload-log-zip', 'POST')(req, res, url('/api/upload-log-zip'), true, deps);
      req.emit('data', buf);
      req.emit('end');
    });
  }

  it('streams rebuilt entries equal to a direct read', async () => {
    const before = countUploadTmp();
    const res = await callUpload(zipSource());
    assert.equal(res.statusCode, 200);
    const got = resBuffer(res).toString('utf-8').split('\n---\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    assert.ok(got.length > 0);
    assert.deepEqual(got, sourceEntries);
    assert.equal(countUploadTmp(), before, 'temp extract dir must be cleaned up');
  });

  it('corrupt zip → 400 INVALID_ZIP', async () => {
    const res = await callUpload(Buffer.from('garbage'));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(resBuffer(res).toString('utf-8')).code, 'INVALID_ZIP');
  });

  it('oversize (content-length) → 413', async () => {
    const res = await callUpload(zipSource(), { 'content-length': String(301 * 1024 * 1024) });
    assert.equal(res.statusCode, 413);
  });

  it('a zip with no journal.jsonl → 400 NOT_V2, and the temp dir is cleaned up', async () => {
    const before = countUploadTmp();
    const zip = new AdmZip();
    zip.addFile('session.jsonl', Buffer.from('{"timestamp":"t"}\n---\n')); // v1 payload, no journal
    const res = await callUpload(zip.toBuffer());
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(resBuffer(res).toString('utf-8')).code, 'NOT_V2');
    assert.equal(countUploadTmp(), before, 'temp dir must be reclaimed on the error path too');
  });
});

// ─── download error branches ────────────────────────────────────────────────
describe('GET /api/download-log?format=raw error branches', () => {
  function callDownload(query) {
    const res = makeRes();
    return new Promise((resolve) => {
      res.on('finish', () => resolve(res));
      Promise.resolve(handler('/api/download-log', 'GET')({ headers: {} }, res, url('/api/download-log', query))).catch(() => resolve(res));
    });
  }

  it('unknown v2 ref → 404', async () => {
    const res = await callDownload({ file: 'v2:proj/00000000-0000-4000-8000-000000000000', format: 'raw' });
    assert.equal(res.statusCode, 404);
  });

  it('session over CCV_MAX_ZIP_SOURCE → 413 TOO_LARGE', async () => {
    process.env.CCV_MAX_ZIP_SOURCE = '1'; // 1 byte — any real session exceeds it
    try {
      const res = await callDownload({ file: v2Ref, format: 'raw' });
      assert.equal(res.statusCode, 413);
      assert.equal(JSON.parse(resBuffer(res).toString('utf-8')).code, 'TOO_LARGE');
    } finally { delete process.env.CCV_MAX_ZIP_SOURCE; }
  });
});

// Count ONLY this feature's temp dirs. test/upload-api.test.js uses the
// `ccv-upload-test-` prefix, which would otherwise collide under parallel
// workers and make this snapshot flaky.
function countUploadTmp() {
  try { return readdirSync(tmpdir()).filter((n) => n.startsWith('ccv-upload-') && !n.startsWith('ccv-upload-test-')).length; }
  catch { return 0; }
}
