/**
 * server/routes/files-fs.js — POST /api/files-exists (filesExists) endpoint tests.
 *
 * 覆盖目标:
 *   - 存在性判定: 相对/绝对路径存在 → true; 不存在 / 目录 / allowlist 外 /
 *     敏感文件 / null 字节 / 相对 `..` → 统一 false(信息隐匿: 响应只含
 *     {path, exists}, 不回传 reason/allowedRoots —— 严格弱于 file-content 的
 *     404/403 分裂)
 *   - 结构校验: 坏 JSON / 非数组 / >50 项 / 非字符串项 / >1024 字符 → 400;
 *     body 超 256KB → 413
 *   - 顺序保持与重复项逐项返回
 *
 * 隔离策略与 api-files-content.test.js 同款: import 目标模块【之前】mkdtemp +
 * env 注入(CCV_PROJECT_DIR / CLAUDE_CONFIG_DIR / CCV_LOG_DIR), 使临时目录成为
 * file-access-policy allowlist 的项目 root。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 沙箱目录:必须在 import 目标模块前建好并注入 env ──────────────────────────
const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'ccv-files-exists-test-')));
const PROJECT = join(TMP, 'project');
const FAKE_CLAUDE = join(TMP, 'claude');
const OUTSIDE = join(TMP, 'outside'); // 不在任何 allowlist root 下
mkdirSync(PROJECT, { recursive: true });
mkdirSync(FAKE_CLAUDE, { recursive: true });
mkdirSync(OUTSIDE, { recursive: true });

process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CLAUDE_CONFIG_DIR = FAKE_CLAUDE;
process.env.CCV_LOG_DIR = join(TMP, 'logs');
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

// fixtures
writeFileSync(join(PROJECT, 'README.md'), '# hi\n');
mkdirSync(join(PROJECT, 'src'), { recursive: true });
writeFileSync(join(PROJECT, 'src', 'a.js'), 'const a = 1;\n');
writeFileSync(join(OUTSIDE, 'secret.txt'), 'nope\n');
writeFileSync(join(FAKE_CLAUDE, '.credentials.json'), '{}');

/** 调用 POST handler(req 为流式 EventEmitter),resolve { status, json }。 */
function callPost(handler, body) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.destroy = () => { req.emit('end'); }; // 模拟 overflow 时的 destroy → end
    let ended = false; // 真实 http.ServerResponse: end 之后的状态不可逆(二次 end 抛错)
    const res = {
      statusCode: 0,
      writeHead(code) { if (!ended) this.statusCode = code; },
      end(b) {
        if (ended) return;
        ended = true;
        resolve({ status: this.statusCode, json: JSON.parse(b == null ? '{}' : String(b)) });
      },
    };
    handler(req, res);
    req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
    req.emit('end');
  });
}

let filesExists;

before(async () => {
  const mod = await import('../server/routes/files-fs.js');
  const matches = mod.filesFsRoutes.filter(r => r.path === '/api/files-exists' && r.method === 'POST');
  assert.equal(matches.length, 1, 'exactly one POST /api/files-exists route');
  filesExists = matches[0].handler;
});

after(() => {
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

describe('POST /api/files-exists — existence semantics', () => {
  it('existing file by relative path → true', async () => {
    const { status, json } = await callPost(filesExists, { paths: ['README.md'] });
    assert.equal(status, 200);
    assert.deepEqual(json, { results: [{ path: 'README.md', exists: true }] });
  });

  it('existing nested file and absolute path → true', async () => {
    const abs = join(PROJECT, 'src', 'a.js');
    const { json } = await callPost(filesExists, { paths: ['src/a.js', abs] });
    assert.deepEqual(json.results, [
      { path: 'src/a.js', exists: true },
      { path: abs, exists: true },
    ]);
  });

  it('missing file → false', async () => {
    const { json } = await callPost(filesExists, { paths: ['no/such/file.md'] });
    assert.deepEqual(json.results, [{ path: 'no/such/file.md', exists: false }]);
  });

  it('directory → false (only regular files are clickable)', async () => {
    const { json } = await callPost(filesExists, { paths: ['src'] });
    assert.deepEqual(json.results, [{ path: 'src', exists: false }]);
  });

  it('outside allowlist → false (uniform, no reason leak)', async () => {
    const p = join(OUTSIDE, 'secret.txt');
    const { status, json } = await callPost(filesExists, { paths: [p] });
    assert.equal(status, 200);
    assert.deepEqual(json.results, [{ path: p, exists: false }]);
    assert.deepEqual(Object.keys(json.results[0]).sort(), ['exists', 'path']);
  });

  it('sensitive claude-config file → false (denied-but-existing indistinguishable from missing)', async () => {
    const p = join(FAKE_CLAUDE, '.credentials.json');
    const { json } = await callPost(filesExists, { paths: [p] });
    assert.deepEqual(json.results, [{ path: p, exists: false }]);
  });

  it('null-byte path → false, batch continues', async () => {
    const { json } = await callPost(filesExists, { paths: ['a\0b.md', 'README.md'] });
    assert.deepEqual(json.results, [
      { path: 'a\0b.md', exists: false },
      { path: 'README.md', exists: true },
    ]);
  });

  it('relative .. path → false (mirrors /api/file-content 400 contract)', async () => {
    const { json } = await callPost(filesExists, { paths: ['../outside/secret.txt'] });
    assert.deepEqual(json.results, [{ path: '../outside/secret.txt', exists: false }]);
  });

  it('filenames containing ".." but no ".." segment are probed normally', async () => {
    writeFileSync(join(PROJECT, 'foo..bar.md'), 'x\n');
    const { json } = await callPost(filesExists, { paths: ['foo..bar.md'] });
    assert.deepEqual(json.results, [{ path: 'foo..bar.md', exists: true }]);
  });

  it('duplicate entries each get a result, order preserved', async () => {
    const { json } = await callPost(filesExists, { paths: ['README.md', 'nope.md', 'README.md'] });
    assert.deepEqual(json.results, [
      { path: 'README.md', exists: true },
      { path: 'nope.md', exists: false },
      { path: 'README.md', exists: true },
    ]);
  });
});

describe('POST /api/files-exists — structural validation', () => {
  it('malformed JSON → 400', async () => {
    const { status } = await callPost(filesExists, '{not json');
    assert.equal(status, 400);
  });

  it('missing paths / non-array → 400', async () => {
    assert.equal((await callPost(filesExists, {})).status, 400);
    assert.equal((await callPost(filesExists, { paths: 'README.md' })).status, 400);
  });

  it('non-string entry → 400', async () => {
    assert.equal((await callPost(filesExists, { paths: ['README.md', 42] })).status, 400);
  });

  it('entry longer than 1024 chars → 400', async () => {
    const { status } = await callPost(filesExists, { paths: ['a'.repeat(1025)] });
    assert.equal(status, 400);
  });

  it('more than 50 paths → 400', async () => {
    const paths = Array.from({ length: 51 }, (_, i) => `f${i}.md`);
    const { status } = await callPost(filesExists, { paths });
    assert.equal(status, 400);
  });

  it('exactly 50 paths → 200', async () => {
    const paths = Array.from({ length: 50 }, (_, i) => `f${i}.md`);
    const { status, json } = await callPost(filesExists, { paths });
    assert.equal(status, 200);
    assert.equal(json.results.length, 50);
    assert.ok(json.results.every(r => r.exists === false));
  });

  it('body over 256KB → 413 (handler-level probe: the size cap fires before JSON.parse)', async () => {
    const status = await new Promise((resolve) => {
      const req = new EventEmitter();
      let ended = false;
      req.destroy = () => { req.emit('end'); };
      const res = {
        statusCode: 0,
        writeHead(code) { if (!ended) this.statusCode = code; },
        end() { if (!ended) { ended = true; resolve(this.statusCode); } },
      };
      filesExists(req, res);
      req.emit('data', Buffer.alloc(256 * 1024 + 1, 120)); // 'x' × 256KB+1
      req.emit('end');
    });
    assert.equal(status, 413);
  });
});
