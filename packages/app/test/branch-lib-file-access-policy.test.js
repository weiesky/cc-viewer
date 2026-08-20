/**
 * file-access-policy 分支补强测试
 *
 * 目标:把 server/lib/file-access-policy.js 的 branch 覆盖拉到 >= 95%。
 * 已有 test/file-access-policy.test.js 覆盖主路径;本文件专补未覆盖分支:
 *   - sensitive-prefix(allowlist 内但落在 SENSITIVE_PATH_PREFIXES,项目外)
 *   - sensitive-filename(allowlist 内但匹配 SENSITIVE_FILENAME_PATTERNS,项目外)
 *   - allowlist 内、项目外、所有 denylist 均未命中 → ok(两个 for-loop 穷尽落 ok)
 *   - ~/.claude 子目录里 case 变体 Settings.json(不在 Set、命中正则)→ sensitive-claude-config
 *   - ~/.claude 子目录里非 settings 文件 → 不被子拦
 *   - computeRoots workspace 注入(loadWorkspaces 经 workspaces.json 真实生效)
 *   - reasonToStatus 全部 arm(404/400/400/403)
 *   - bumpWorkspacesVersion / _resetCacheForTests 失效缓存
 *
 * 隔离 / 加载:env-dependent 分支(HOME/CCV_PROJECT_DIR/CCV_LOG_DIR/SENSITIVE_PATH_PREFIXES
 * 均在模块 load 期由 homedir()/env 锁定)必须在【动态 import 之前】把 env 设好。
 * 把 HOME 注册成一个 workspace root(写 workspaces.json),让整个 fake HOME 进 allowlist,
 * 而 CCV_PROJECT_DIR=HOME/project 是其子目录 → HOME 下、项目外的文件可触发 denylist 二段。
 * 用私有 mktemp 目录作 CCV_LOG_DIR,绝不写共享目录;node:test 每文件独立进程,env 改动不外泄。
 */
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';

// tmp root 走 realpath,避免 macOS /var → /private/var symlink 让前缀比对错位。
const TMP = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'ccv-branch-fap-')));
const HOME = join(TMP, 'home');
const CLAUDE = join(HOME, '.claude');
const CLAUDE_SUB = join(CLAUDE, 'sub');
const PROJECT = join(HOME, 'project');
const LOG = join(TMP, 'log');

// 项目外、HOME 内的目录(HOME 是 workspace root,项目是其子目录)
const AWS_DIR = join(HOME, '.aws');
const DOCS_DIR = join(HOME, 'docs');

const AWS_CONFIG = join(AWS_DIR, 'config');       // .aws 前缀,文件名不敏感 → sensitive-prefix
const DOCS_PEM = join(DOCS_DIR, 'server.pem');    // 项目外 + 文件名敏感 → sensitive-filename
const DOCS_PLAIN = join(DOCS_DIR, 'plain.txt');   // 项目外 + 均不命中 → ok
const SETTINGS_CAP = join(CLAUDE_SUB, 'Settings.json'); // 大写 S:不在 Set、命中正则
const CLAUDE_OTHER = join(CLAUDE_SUB, 'other.json');    // .claude 子目录非 settings → ok
const PROJECT_FILE = join(PROJECT, 'a.txt');

mkdirSync(PROJECT, { recursive: true });
mkdirSync(CLAUDE_SUB, { recursive: true });
mkdirSync(LOG, { recursive: true });
mkdirSync(AWS_DIR, { recursive: true });
mkdirSync(DOCS_DIR, { recursive: true });
writeFileSync(AWS_CONFIG, 'X');
writeFileSync(DOCS_PEM, 'X');
writeFileSync(DOCS_PLAIN, 'hello');
writeFileSync(SETTINGS_CAP, '{}');
writeFileSync(CLAUDE_OTHER, '{}');
writeFileSync(PROJECT_FILE, 'x');
// workspaces.json:
//  - HOME           → 把整个 HOME 注册成 allowlist root
//  - ''             → computeRoots.add() 命中 `!raw` 早退分支
//  - 不存在的路径    → add() 内 realpathSync 抛错 → catch 回退 real=raw 分支
//  - HOME (重复)    → add() 命中 seen.has 去重分支
//  - 带尾 sep 的不存在路径 → realpath catch 后 real=raw 仍带尾 sep,使后续 isInsideRoot
//    里的 withSep(root) 命中 `p.endsWith(sep) ? p` 分支
const NONEXIST_WS = join(TMP, 'no-such-workspace-dir');
const TRAILING_SEP_WS = join(TMP, 'ws-trailing-nonexist') + sep;
writeFileSync(join(LOG, 'workspaces.json'), JSON.stringify({
  workspaces: [
    { path: HOME },
    { path: '' },
    { path: NONEXIST_WS },
    { path: TRAILING_SEP_WS },
    { path: HOME },
  ],
}));

// 保存原 env,after 恢复。
const _orig = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
  CCV_PROJECT_DIR: process.env.CCV_PROJECT_DIR,
  CCV_LOG_DIR: process.env.CCV_LOG_DIR,
};
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.CLAUDE_CONFIG_DIR = CLAUDE;
process.env.CCV_PROJECT_DIR = PROJECT;
process.env.CCV_LOG_DIR = LOG;

// 动态 import:env 设置后再加载 policy(模块顶部锁定 homedir()/STARTUP_CWD/roots)。
const policy = await import('../server/lib/file-access-policy.js');
const { isReadAllowed, getAllowedRoots, reasonToStatus, bumpWorkspacesVersion, _resetCacheForTests } = policy;
_resetCacheForTests();

after(() => {
  for (const k of Object.keys(_orig)) {
    if (_orig[k] === undefined) delete process.env[k];
    else process.env[k] = _orig[k];
  }
  try { rmSync(TMP, { recursive: true, force: true }); } catch {}
});

describe('file-access-policy 分支补强: denylist 二段 (allowlist 内 + 项目外)', () => {
  it('~/.aws/config 落 SENSITIVE_PATH_PREFIXES → sensitive-prefix', () => {
    const r = isReadAllowed(AWS_CONFIG);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.reason, 'sensitive-prefix');
  });

  it('项目外 server.pem 匹配 SENSITIVE_FILENAME_PATTERNS → sensitive-filename', () => {
    const r = isReadAllowed(DOCS_PEM);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.reason, 'sensitive-filename');
  });

  it('项目外 plain.txt 不命中任何 denylist → ok(两 for-loop 穷尽后落 ok)', () => {
    const r = isReadAllowed(DOCS_PLAIN);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(typeof r.real === 'string' && r.real.endsWith('plain.txt'));
  });
});

describe('file-access-policy 分支补强: ~/.claude 子目录 settings 正则 (case 变体)', () => {
  it('~/.claude/sub/Settings.json(大写 S,不在 Set,命中正则)→ sensitive-claude-config', () => {
    const r = isReadAllowed(SETTINGS_CAP);
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.reason, 'sensitive-claude-config');
  });

  it('~/.claude/sub/other.json(非 settings)→ 不被子拦,落 ok', () => {
    const r = isReadAllowed(CLAUDE_OTHER);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});

describe('file-access-policy 分支补强: computeRoots workspace 注入', () => {
  it('workspaces.json 中的 HOME 被纳入 allowlist roots', () => {
    const raws = getAllowedRoots().map((r) => r.raw);
    assert.ok(raws.includes(HOME), JSON.stringify(raws));
  });

  it('项目内文件仍可读(allowlist 命中 + 项目内豁免)', () => {
    const r = isReadAllowed(PROJECT_FILE);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('add() 跳过空 path、保留不存在路径(realpath catch)、去重重复 HOME', () => {
    _resetCacheForTests();
    const raws = getAllowedRoots().map((r) => r.raw);
    // 空字符串被 `!raw` 早退,不进 roots
    assert.ok(!raws.includes(''), JSON.stringify(raws));
    // HOME 只出现一次(seen 去重)
    assert.equal(raws.filter((r) => r === HOME).length, 1, JSON.stringify(raws));
    // 不存在的 workspace 路径:realpathSync 抛错 → 走 catch real=raw,raw 仍入 roots
    assert.ok(raws.includes(NONEXIST_WS), JSON.stringify(raws));
    // 带尾 sep 的 root 存在(其 real 保留尾 sep),后续 isInsideRoot/withSep 会命中 `? p` 分支
    assert.ok(getAllowedRoots().some((r) => r.real.endsWith(sep)), 'expected a trailing-sep root');
  });

  it('对任意文件调 isReadAllowed 会遍历含尾 sep 的 root → 命中 withSep `? p` 分支', () => {
    _resetCacheForTests();
    // 调用一次即可:allowlist 遍历会对每个 root(含尾 sep 的)做 isInsideRoot → withSep
    const r = isReadAllowed(DOCS_PLAIN);
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it('路径恰等于某 allowlist root(PROJECT 自身)→ isInsideRoot `===` 精确匹配分支', () => {
    const r = isReadAllowed(PROJECT);
    assert.equal(r.ok, true, JSON.stringify(r));
  });
});

describe('file-access-policy 分支补强: reasonToStatus 全 arm', () => {
  it('realpath-failed → 404', () => assert.equal(reasonToStatus('realpath-failed'), 404));
  it('invalid → 400', () => assert.equal(reasonToStatus('invalid'), 400));
  it('null-byte → 400', () => assert.equal(reasonToStatus('null-byte'), 400));
  it('其它 reason → 403', () => assert.equal(reasonToStatus('outside-allowlist'), 403));
  it('undefined → 403(兜底 else)', () => assert.equal(reasonToStatus(undefined), 403));
});

describe('file-access-policy 分支补强: 缓存失效', () => {
  it('getAllowedRoots 二次调用走缓存(同实例)', () => {
    _resetCacheForTests();
    const a = getAllowedRoots();
    const b = getAllowedRoots();
    assert.strictEqual(a, b);
  });

  it('bumpWorkspacesVersion 后 getAllowedRoots 重算(新实例)', () => {
    const a = getAllowedRoots();
    bumpWorkspacesVersion();
    const c = getAllowedRoots();
    assert.notStrictEqual(a, c);
    assert.ok(Array.isArray(c) && c.length > 0);
  });

  it('_resetCacheForTests 后 getAllowedRoots 重算(新实例)', () => {
    const a = getAllowedRoots();
    _resetCacheForTests();
    const b = getAllowedRoots();
    assert.notStrictEqual(a, b);
  });
});

/**
 * getProjectRoot / getClaudeConfigDir / computeRoots 在【调用时】读 env(而非 load 时锁定),
 * 因此可在运行时临时改 env 触发它们的 catch / `|| STARTUP_CWD` 分支。
 * 每个用例自行保存并在末尾恢复 CCV_PROJECT_DIR / CLAUDE_CONFIG_DIR,且最后 _resetCacheForTests
 * + 重设 env,避免污染其它用例(node:test 文件内默认顺序执行)。
 */
describe('file-access-policy 分支补强: 运行时 env 触发 catch / 缺省分支', () => {
  const SAVED_PROJ = process.env.CCV_PROJECT_DIR;
  const SAVED_CLAUDE = process.env.CLAUDE_CONFIG_DIR;
  const restore = () => {
    process.env.CCV_PROJECT_DIR = SAVED_PROJ;
    process.env.CLAUDE_CONFIG_DIR = SAVED_CLAUDE;
  };
  after(restore);

  it('CCV_PROJECT_DIR 指向不存在路径 → getProjectRoot realpath catch(回退 resolve)', () => {
    process.env.CCV_PROJECT_DIR = join(TMP, 'no-such-project-dir');
    try {
      const r = isReadAllowed(DOCS_PLAIN);
      assert.equal(r.ok, true, JSON.stringify(r)); // 仍命中 HOME workspace root
    } finally {
      restore();
    }
  });

  it('CCV_PROJECT_DIR 未设 → getProjectRoot 走 `|| STARTUP_CWD` 缺省分支', () => {
    delete process.env.CCV_PROJECT_DIR;
    try {
      const r = isReadAllowed(DOCS_PLAIN);
      assert.equal(r.ok, true, JSON.stringify(r));
    } finally {
      restore();
    }
  });

  it('CLAUDE_CONFIG_DIR 指向不存在路径 → getClaudeConfigDir realpath catch(claudeReal=null)', () => {
    process.env.CLAUDE_CONFIG_DIR = join(TMP, 'no-such-claude-dir');
    try {
      // claudeReal=null → 跳过 ~/.claude 子拦段;文件落普通 ok
      const r = isReadAllowed(DOCS_PLAIN);
      assert.equal(r.ok, true, JSON.stringify(r));
    } finally {
      restore();
    }
  });

  it('CCV_PROJECT_DIR 未设 → computeRoots 走 `|| STARTUP_CWD` 缺省分支', () => {
    delete process.env.CCV_PROJECT_DIR;
    try {
      _resetCacheForTests();
      const roots = getAllowedRoots();
      assert.ok(Array.isArray(roots) && roots.length > 0);
    } finally {
      restore();
      _resetCacheForTests();
    }
  });
});
