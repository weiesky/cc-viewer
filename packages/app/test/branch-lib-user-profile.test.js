// 分支覆盖补强：server/lib/user-profile.js
// 目标分支(line 100% 已达，gap 全在 branch)：
//  - line 37 `http://` 左操作数短路(既有测试只走 https，左臂未覆盖)
//  - line 65 `_osProfilePromise` 并发缓存臂(两次并发调用，第二次命中 in-flight promise)
//  - line 74 `info.username || 'User'` 右臂 + line 78 非 darwin 路径(子进程 mock)
// 既有 test/user-profile.test.js 已覆盖 resolveAvatar 的 data/file/size/ext/catch 各臂。
import './_shims/register.mjs';
import { describe, it, before, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const targetPath = join(here, '..', 'server', 'lib', 'user-profile.js');

// 私有 LOG_DIR，目标模块加载前设好。
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-userprofile-' + process.pid + '-'));
process.env.CCV_LOG_DIR = tmpDir;

let getUserProfile, clearProfileCache;
const savedEnv = {};
function saveEnv() { for (const k of ['CCV_USER_NAME', 'CCV_USER_AVATAR']) savedEnv[k] = process.env[k]; }
function restoreEnv() {
  for (const k of ['CCV_USER_NAME', 'CCV_USER_AVATAR']) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

before(async () => {
  const mod = await import('../server/lib/user-profile.js');
  getUserProfile = mod.getUserProfile;
  clearProfileCache = mod.clearProfileCache;
});

beforeEach(() => { saveEnv(); clearProfileCache(); });
afterEach(() => { restoreEnv(); clearProfileCache(); });
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('resolveAvatar URL 左操作数短路', () => {
  it('http:// URL 直接透传（覆盖 startsWith("http://") 左臂为真）', async () => {
    delete process.env.CCV_USER_NAME;
    process.env.CCV_USER_AVATAR = 'http://example.com/pic.png';
    const p = await getUserProfile();
    assert.equal(p.avatar, 'http://example.com/pic.png');
  });
});

describe('_getOsProfile 并发缓存臂', () => {
  it('清缓存后两次并发调用：第二次命中 in-flight promise（line 65 臂）', async () => {
    clearProfileCache();
    delete process.env.CCV_USER_AVATAR;
    delete process.env.CCV_USER_NAME;
    // 两次调用在第一次 await 解析前同步发起，第二次进入时 _osProfilePromise 已置位、_osProfile 仍空
    const pr1 = getUserProfile();
    const pr2 = getUserProfile();
    const [a, b] = await Promise.all([pr1, pr2]);
    assert.equal(a.name, b.name);
    assert.equal(typeof a.name, 'string');
  });

  it('已解析后再次调用命中 _osProfile 快路（line 64 臂）', async () => {
    clearProfileCache();
    delete process.env.CCV_USER_AVATAR;
    delete process.env.CCV_USER_NAME;
    const a = await getUserProfile();   // 填充 _osProfile
    const b = await getUserProfile();   // 命中 if (_osProfile) return
    assert.equal(a.name, b.name);
  });
});

describe('darwin 下 dscl/JPEGPhoto 失败的 catch 臂（line 83 / line 90）', () => {
  it('清空 PATH 使 dscl/JPEGPhoto 子进程找不到 → 两个 catch{} 均命中，displayName 回退到 username', async () => {
    clearProfileCache();
    const savedPath = process.env.PATH;
    delete process.env.CCV_USER_NAME;
    delete process.env.CCV_USER_AVATAR;
    try {
      // 运行期(非加载期)才执行 execFile('dscl')/exec(...)，此处清空 PATH 使二者均抛错 → 命中 line 83、line 90 的 catch
      process.env.PATH = '/__ccv_nonexistent_dir__';
      const p = await getUserProfile();
      assert.equal(typeof p.name, 'string');
      assert.ok(p.name.length > 0);          // 回退到 userInfo().username
      assert.equal(p.avatar, null);          // JPEGPhoto 失败 → avatar 维持 null
    } finally {
      if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
      clearProfileCache();
    }
  });
});

describe('CCV_USER_AVATAR 未设时保留 OS 头像（line 106 假臂）', () => {
  it('不设 CCV_USER_AVATAR 时不进入 resolveAvatar 覆盖逻辑', async () => {
    delete process.env.CCV_USER_AVATAR;
    delete process.env.CCV_USER_NAME;
    const p = await getUserProfile();
    // OS 头像可能为 null（CI/无头像）或 data URI（本机有头像）
    assert.ok(p.avatar === null || typeof p.avatar === 'string');
  });
});

// 模块加载期/平台分支 & username 回退用 canonical 子进程跑（spread process.env 保留 NODE_V8_COVERAGE）
describe('子进程：非 darwin 平台 + username 回退分支', () => {
  it('platform 非 darwin 时跳过 dscl/JPEGPhoto，avatar 为 null（line 78 假臂）', () => {
    // 写一个 os mock loader 到临时文件：platform 返回 linux，username 返回空 → 命中 line 74 右臂 'User'
    const loaderPath = join(tmpDir, 'os-mock-loader.mjs');
    const targetUrl = pathToFileURL(targetPath).href;
    writeFileSync(loaderPath, [
      "export async function resolve(spec, ctx, next) {",
      "  if (spec === 'node:os' || spec === 'os') return { url: 'ccv-os-mock:os', shortCircuit: true, format: 'module' };",
      "  return next(spec, ctx);",
      "}",
      "export async function load(url, ctx, next) {",
      "  if (url === 'ccv-os-mock:os') {",
      "    return { format: 'module', shortCircuit: true, source: 'export function userInfo(){return {username:\"\"};} export function platform(){return \"linux\";}' };",
      "  }",
      "  return next(url, ctx);",
      "}",
    ].join('\n'));
    const bootstrapPath = join(tmpDir, 'os-mock-bootstrap.mjs');
    writeFileSync(bootstrapPath, [
      "import { register } from 'node:module';",
      `register(${JSON.stringify(pathToFileURL(loaderPath).href)}, import.meta.url);`,
    ].join('\n'));
    const code = `
      const { getUserProfile, clearProfileCache } = await import(${JSON.stringify(targetUrl)});
      clearProfileCache();
      delete process.env.CCV_USER_NAME;
      delete process.env.CCV_USER_AVATAR;
      const p = await getUserProfile();
      console.log(JSON.stringify({ name: p.name, avatar: p.avatar }));
    `;
    const res = spawnSync(process.execPath, ['--input-type=module', '--import', pathToFileURL(bootstrapPath).href, '-e', code], {
      env: { ...process.env, CCV_LOG_DIR: tmpDir },
      encoding: 'utf-8',
      timeout: 30000,
    });
    assert.equal(res.status, 0, `子进程失败: ${res.stderr}`);
    const out = JSON.parse(res.stdout.trim().split('\n').pop());
    // username 空 → 'User'（line 74 右臂）；非 darwin → avatar null（line 78 假臂）
    assert.equal(out.name, 'User');
    assert.equal(out.avatar, null);
  });
});
