/**
 * file-access-policy 单元测试
 *
 * 覆盖:allowlist 命中 / denylist / 项目内 sensitive 豁免 / ~/.claude/ 子拦 /
 *      symlink realpath / null-byte / 不存在路径 / outside-allowlist。
 *
 * 隔离策略:mktemp 创建假 HOME + CCV_PROJECT_DIR,通过 env 注入到 policy。
 * 注意:policy 模块顶部 STARTUP_CWD 在 import 时锁定,测试中需让 policy 在 env 设置后再 import。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, symlinkSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir, platform } from 'node:os';

const isWin = platform() === 'win32';

// 沙箱:HOME=<tmp>/home, CCV_PROJECT_DIR=<tmp>/project
const TMP = mkdtempSync(join(tmpdir(), 'ccv-policy-test-'));
const FAKE_HOME = join(TMP, 'home');
const PROJECT = join(TMP, 'project');
const CLAUDE_DIR = join(FAKE_HOME, '.claude');
const PLANS_DIR = join(CLAUDE_DIR, 'plans');
const SSH_DIR = join(FAKE_HOME, '.ssh');
const AWS_DIR = join(FAKE_HOME, '.aws');
const UPLOADS_DIR_TMP = '/tmp/cc-viewer-uploads';
const UPLOADS_DIR_OS = join(tmpdir(), 'cc-viewer-uploads');

mkdirSync(FAKE_HOME, { recursive: true });
mkdirSync(PROJECT, { recursive: true });
mkdirSync(PLANS_DIR, { recursive: true });
mkdirSync(SSH_DIR, { recursive: true });
mkdirSync(AWS_DIR, { recursive: true });
try { mkdirSync(UPLOADS_DIR_TMP, { recursive: true }); } catch {}
try { mkdirSync(UPLOADS_DIR_OS, { recursive: true }); } catch {}

// 写入测试文件
const PROJECT_FILE = join(PROJECT, 'src', 'index.js');
const PROJECT_ENV = join(PROJECT, '.env');
const PROJECT_PEM = join(PROJECT, 'tests', 'fixtures', 'cert.pem');
mkdirSync(join(PROJECT, 'src'), { recursive: true });
mkdirSync(join(PROJECT, 'tests', 'fixtures'), { recursive: true });
writeFileSync(PROJECT_FILE, 'console.log(1);');
writeFileSync(PROJECT_ENV, 'API_KEY=fake');
writeFileSync(PROJECT_PEM, '---FAKE---');

const PLAN_FILE = join(PLANS_DIR, 'happy-test.md');
writeFileSync(PLAN_FILE, '# plan');

const CLAUDE_SETTINGS = join(CLAUDE_DIR, 'settings.json');
const CLAUDE_CREDS = join(CLAUDE_DIR, '.credentials.json');
writeFileSync(CLAUDE_SETTINGS, '{}');
writeFileSync(CLAUDE_CREDS, '{}');

const SSH_KEY = join(SSH_DIR, 'id_rsa');
writeFileSync(SSH_KEY, '---PRIVATE---');

const AWS_CREDS = join(AWS_DIR, 'credentials');
writeFileSync(AWS_CREDS, '[default]\naws_access_key_id=AKIA');

const UPLOAD_FILE_TMP = join(UPLOADS_DIR_TMP, 'foo-test-policy.png');
const UPLOAD_FILE_OS = join(UPLOADS_DIR_OS, 'foo-test-policy.png');
writeFileSync(UPLOAD_FILE_TMP, 'PNG');
writeFileSync(UPLOAD_FILE_OS, 'PNG');

// 保存原 env,恢复用
const _origEnv = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CCV_PROJECT_DIR: process.env.CCV_PROJECT_DIR,
};
process.env.HOME = FAKE_HOME;
process.env.USERPROFILE = FAKE_HOME;
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.CCV_PROJECT_DIR = PROJECT;

// dynamic import:env 设置后再加载 policy
const policy = await import('../server/lib/file-access-policy.js');
const { isReadAllowed, getAllowedRoots, _resetCacheForTests } = policy;
_resetCacheForTests();

after(() => {
  process.env.HOME = _origEnv.HOME;
  process.env.USERPROFILE = _origEnv.USERPROFILE;
  if (_origEnv.CLAUDE_CONFIG_DIR === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = _origEnv.CLAUDE_CONFIG_DIR;
  if (_origEnv.CCV_PROJECT_DIR === undefined) delete process.env.CCV_PROJECT_DIR;
  else process.env.CCV_PROJECT_DIR = _origEnv.CCV_PROJECT_DIR;
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

describe('file-access-policy: allowlist 命中', () => {
  it('项目内文件 → ok + real', () => {
    const r = isReadAllowed(PROJECT_FILE);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(typeof r.real === 'string' && r.real.length > 0);
  });

  it('项目内 .env → ok(项目内豁免 sensitive filename)', () => {
    const r = isReadAllowed(PROJECT_ENV);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('项目内 *.pem(测试 fixture)→ ok(项目内豁免)', () => {
    const r = isReadAllowed(PROJECT_PEM);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('~/.claude/plans/foo.md → ok', () => {
    const r = isReadAllowed(PLAN_FILE);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('上传目录 /tmp/cc-viewer-uploads/foo.png → ok', () => {
    const r = isReadAllowed(UPLOAD_FILE_TMP);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('上传目录 os.tmpdir()/cc-viewer-uploads/foo.png → ok(macOS realpath 兼容)', () => {
    const r = isReadAllowed(UPLOAD_FILE_OS);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('上传目录 /tmp/cc-viewer-uploads/foo.png → ok(macOS realpath 后 /private/tmp 也覆盖)', () => {
    // macOS 上 /tmp 是 symlink → /private/tmp。realpath 后要落在 allowlist 中。
    // 我们 allowlist 同时含 '/tmp/cc-viewer-uploads' 和 tmpdir()/cc-viewer-uploads,
    // computeRoots 阶段把每条 raw root 都 realpath 后存入 r.real,所以 /tmp 写入文件后
    // realpath 解析为 /private/tmp/... 时仍能命中(因为 /tmp/cc-viewer-uploads 这条 root
    // 的 r.real 也是 /private/tmp/cc-viewer-uploads)。
    const r = isReadAllowed(UPLOAD_FILE_TMP);
    assert.equal(r.ok, true, JSON.stringify(r));
    // 验证返回的 real 路径是 realpath 解析后的形式
    if (process.platform === 'darwin') {
      assert.ok(r.real === '/private/tmp/cc-viewer-uploads/foo-test-policy.png'
        || r.real === '/tmp/cc-viewer-uploads/foo-test-policy.png',
        `unexpected real: ${r.real}`);
    }
  });

  it('macOS 显式包含 /private/tmp 上传目录,覆盖 upload dir 启动后才创建的场景', { skip: process.platform !== 'darwin' }, () => {
    _resetCacheForTests();
    const roots = getAllowedRoots();
    assert.ok(
      roots.some(r => r.raw === '/private/tmp/cc-viewer-uploads'),
      JSON.stringify(roots)
    );
  });
});

describe('file-access-policy: ~/.claude/ 子拦', () => {
  it('~/.claude/settings.json → 403 sensitive-claude-config', () => {
    const r = isReadAllowed(CLAUDE_SETTINGS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'sensitive-claude-config');
  });

  it('~/.claude/.credentials.json → 403 sensitive-claude-config', () => {
    const r = isReadAllowed(CLAUDE_CREDS);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'sensitive-claude-config');
  });
});

describe('file-access-policy: denylist (allowlist 命中后兜底)', () => {
  it('~/.ssh/id_rsa 通过 symlink 进项目 → 拒绝(sensitive-prefix 或 outside-allowlist)', () => {
    // FAKE_HOME 不在 SENSITIVE_PATH_PREFIXES (那是真正的 ~/.ssh) 中,所以 FAKE_HOME/.ssh
    // 会被 outside-allowlist 拦下。在真实环境中真 ~/.ssh 会被 sensitive-prefix 拦下。
    // 两个 reason 都 ok=false 都是安全拦截,断言只校验一定被拒。
    const projLink = join(PROJECT, 'mylink');
    try { symlinkSync(SSH_KEY, projLink); } catch {}
    const r = isReadAllowed(projLink);
    assert.equal(r.ok, false);
    assert.ok(['sensitive-prefix', 'outside-allowlist'].includes(r.reason),
      `got reason=${r.reason}`);
  });

  it('~/.aws/credentials 通过 symlink 进项目 → 拒绝', () => {
    const projLink = join(PROJECT, 'awslink');
    try { symlinkSync(AWS_CREDS, projLink); } catch {}
    const r = isReadAllowed(projLink);
    assert.equal(r.ok, false);
    assert.ok(['sensitive-prefix', 'sensitive-filename', 'outside-allowlist'].includes(r.reason),
      `got reason=${r.reason}`);
  });
});

describe('file-access-policy: outside allowlist', () => {
  it('完全无关的 /tmp/some-other-path 不在任何 root → 403 outside-allowlist', () => {
    const path = join(tmpdir(), 'completely-unrelated-' + Date.now() + '.txt');
    writeFileSync(path, 'x');
    try {
      const r = isReadAllowed(path);
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'outside-allowlist');
      assert.ok(Array.isArray(r.allowedRoots));
      assert.ok(r.allowedRoots.length > 0);
    } finally {
      try { rmSync(path); } catch {}
    }
  });
});

describe('file-access-policy: 输入校验', () => {
  it('null byte → 403 null-byte', () => {
    const r = isReadAllowed(PROJECT_FILE + '\x00.md');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'null-byte');
  });

  it('空字符串 → invalid', () => {
    const r = isReadAllowed('');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid');
  });

  it('非 string → invalid', () => {
    const r = isReadAllowed(null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'invalid');
  });

  it('不存在路径 → realpath-failed', () => {
    const r = isReadAllowed(join(PROJECT, 'does-not-exist.txt'));
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'realpath-failed');
  });
});

describe('file-access-policy: TOCTOU 合同', () => {
  it('返回的 real 路径用于读,而非用户原始 path', () => {
    const link = join(PROJECT, 'src', 'link-to-index');
    try { symlinkSync(PROJECT_FILE, link); } catch {}
    const r = isReadAllowed(link);
    assert.equal(r.ok, true);
    // real 应是 PROJECT_FILE realpath,不是 link 本身
    assert.equal(r.real, realpathSync(PROJECT_FILE));
  });
});
