/**
 * L1 测试隔离铁闸单测 — findcc.js resolveLogDir() 的 NODE_TEST_CONTEXT 守卫。
 *
 * 背景(2026-06-06 事故):测试/探针在无 CCV_LOG_DIR 环境下 import 模块,LOG_DIR 解析到
 * 真实 ~/.claude/cc-viewer,测试清理逻辑把用户数据整树删除。
 * 守卫语义:node:test 环境(NODE_TEST_CONTEXT 存在)且未显式设 CCV_LOG_DIR 时,
 * LOG_DIR 强制解析到进程私有临时目录,绝不落真实用户目录。
 *
 * 全部断言走子进程 canonical import(env 在 import 前注入),不污染本进程模块缓存。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const FINDCC_URL = pathToFileURL(join(REPO_ROOT, 'packages', 'app', 'findcc.js')).href;

/** 子进程 import findcc 并打印 LOG_DIR。envPatch 里值为 undefined 的键会被删除。 */
function probeLogDir(envPatch) {
  const env = { ...process.env };
  // 先剥掉会干扰判定的继承变量,再按 patch 注入
  delete env.CCV_LOG_DIR;
  delete env.NODE_TEST_CONTEXT;
  delete env.CLAUDE_CONFIG_DIR;
  for (const [k, v] of Object.entries(envPatch || {})) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
  const out = execFileSync(process.execPath, ['-e',
    `import(${JSON.stringify(FINDCC_URL)}).then(m => { console.log('LOG_DIR=' + m.LOG_DIR); }).catch(e => { console.error(e); process.exit(1); });`,
  ], { env, encoding: 'utf-8', timeout: 30000 });
  const m = out.match(/LOG_DIR=(.+)/);
  assert.ok(m, '子进程应打印 LOG_DIR,实际输出: ' + out);
  return m[1].trim();
}

describe('resolveLogDir 测试隔离铁闸(NODE_TEST_CONTEXT)', () => {
  it('测试环境 + 未设 CCV_LOG_DIR → 强制进程私有临时目录,绝不落用户目录', () => {
    const dir = probeLogDir({ NODE_TEST_CONTEXT: 'child-v8' });
    assert.ok(dir.startsWith(join(tmpdir(), 'cc-viewer-test') + sep),
      `应落在 ${join(tmpdir(), 'cc-viewer-test')} 下,实际: ${dir}`);
    assert.ok(dir.includes('guard-'), '守卫路径应带 guard- 标记: ' + dir);
    assert.ok(!dir.startsWith(join(homedir(), '.claude')), '绝不允许解析到 ~/.claude: ' + dir);
  });

  it('测试环境 + 显式 CCV_LOG_DIR(tmp 下) → 尊重显式值(铁闸不覆盖一次性临时目录)', () => {
    const explicit = mkdtempSync(join(tmpdir(), 'ccv-guard-explicit-'));
    const dir = probeLogDir({ NODE_TEST_CONTEXT: 'child-v8', CCV_LOG_DIR: explicit });
    assert.equal(dir, explicit);
  });

  // ── L1c(2026-07-12 数据丢失事故)：ccv 宿主 shell 会向子进程导出指向真实用户数据目录的
  //    CCV_LOG_DIR；直跑 node --test 继承它后曾把真实 ~/.claude/cc-viewer/system_prompt/ 整树删除。
  //    测试环境下显式 CCV_LOG_DIR 只有落在系统临时目录内才被接受，否则强制守卫目录。 ──
  it('L1c: 测试环境 + 显式 CCV_LOG_DIR 指向真实用户目录 → 强制守卫目录(绝不接受)', () => {
    const real = join(homedir(), '.claude', 'cc-viewer');
    const dir = probeLogDir({ NODE_TEST_CONTEXT: 'child-v8', CCV_LOG_DIR: real });
    assert.notEqual(dir, real, '继承自 ccv 宿主环境的真实数据目录必须被拒绝');
    assert.ok(dir.startsWith(join(tmpdir(), 'cc-viewer-test') + sep), '应强制落守卫目录: ' + dir);
    assert.ok(dir.includes('guard-'), dir);
  });

  it('L1c: 测试环境 + 显式 CCV_LOG_DIR 指向任意非 tmp 目录 → 同样强制守卫目录', () => {
    const outside = join(homedir(), 'ccv-not-a-temp-dir-fixture');
    const dir = probeLogDir({ NODE_TEST_CONTEXT: 'child-v8', CCV_LOG_DIR: outside });
    assert.notEqual(dir, outside);
    assert.ok(dir.startsWith(join(tmpdir(), 'cc-viewer-test') + sep), dir);
  });

  it('L1c: 生产环境(无 NODE_TEST_CONTEXT) + 显式 CCV_LOG_DIR 指向真实目录 → 照常尊重(仅测试环境收紧)', () => {
    const real = join(homedir(), '.claude', 'cc-viewer');
    const dir = probeLogDir({ CCV_LOG_DIR: real });
    assert.equal(dir, real, '生产语义不变：显式配置照常生效');
  });

  it("测试环境 + CCV_LOG_DIR='tmp' 关键字 → 仍走进程私有 tmp(既有语义不回归)", () => {
    const dir = probeLogDir({ NODE_TEST_CONTEXT: 'child-v8', CCV_LOG_DIR: 'tmp' });
    assert.ok(dir.startsWith(join(tmpdir(), 'cc-viewer-test') + sep), dir);
    assert.ok(!dir.includes('guard-'), "'tmp' 关键字路径不该带 guard- 标记(走原分支): " + dir);
  });

  it('生产环境(无 NODE_TEST_CONTEXT)→ 默认语义不变:<claudeConfigDir>/cc-viewer', () => {
    const fakeCfg = mkdtempSync(join(tmpdir(), 'ccv-guard-fakecfg-'));
    const dir = probeLogDir({ CLAUDE_CONFIG_DIR: fakeCfg });
    assert.equal(dir, join(fakeCfg, 'cc-viewer'), '生产默认解析不受守卫影响');
  });
});

/** 子进程 import findcc 并打印 getClaudeConfigDir()。 */
function probeConfigDir(envPatch) {
  const env = { ...process.env };
  delete env.CCV_LOG_DIR;
  delete env.NODE_TEST_CONTEXT;
  delete env.CLAUDE_CONFIG_DIR;
  for (const [k, v] of Object.entries(envPatch || {})) {
    if (v === undefined) delete env[k]; else env[k] = v;
  }
  const out = execFileSync(process.execPath, ['-e',
    `import(${JSON.stringify(FINDCC_URL)}).then(m => { console.log('CFG_DIR=' + m.getClaudeConfigDir()); }).catch(e => { console.error(e); process.exit(1); });`,
  ], { env, encoding: 'utf-8', timeout: 30000 });
  const m = out.match(/CFG_DIR=(.+)/);
  assert.ok(m, '子进程应打印 CFG_DIR,实际输出: ' + out);
  return m[1].trim();
}

describe('getClaudeConfigDir 测试隔离铁闸 L1b(NODE_TEST_CONTEXT)', () => {
  // 背景:updater 的 CACHE_DIR=join(getClaudeConfigDir(),'cc-viewer') 不受 CCV_LOG_DIR 管辖,
  // 测试 rmSync(CACHE_DIR) 曾删除真实 ~/.claude/cc-viewer(2026-06-06 事故确证真凶)。
  it('测试环境 + 未设 CLAUDE_CONFIG_DIR → 强制进程私有目录,绝不解析到真实 ~/.claude', () => {
    const dir = probeConfigDir({ NODE_TEST_CONTEXT: 'child-v8' });
    assert.ok(dir.startsWith(join(tmpdir(), 'cc-viewer-test') + sep), dir);
    assert.ok(dir.includes('guard-cfg-'), '守卫路径应带 guard-cfg- 标记: ' + dir);
    assert.ok(!dir.startsWith(join(homedir(), '.claude')), '绝不允许解析到 ~/.claude: ' + dir);
  });

  it('测试环境 + 显式 CLAUDE_CONFIG_DIR(tmp 下) → 尊重显式值', () => {
    const explicit = mkdtempSync(join(tmpdir(), 'ccv-guard-cfg-explicit-'));
    const dir = probeConfigDir({ NODE_TEST_CONTEXT: 'child-v8', CLAUDE_CONFIG_DIR: explicit });
    assert.equal(dir, explicit);
  });

  // ── L1d(与 L1c 对称)：显式 CLAUDE_CONFIG_DIR 指向真实 ~/.claude 时，updater CACHE_DIR 等
  //    派生路径会重新指回真实用户数据（2026-06-06 事故同一漏洞类）。测试环境一律拒绝非 tmp 目录。 ──
  it('L1d: 测试环境 + 显式 CLAUDE_CONFIG_DIR 指向真实 ~/.claude → 强制守卫目录', () => {
    const real = join(homedir(), '.claude');
    const dir = probeConfigDir({ NODE_TEST_CONTEXT: 'child-v8', CLAUDE_CONFIG_DIR: real });
    assert.notEqual(dir, real);
    assert.ok(dir.startsWith(join(tmpdir(), 'cc-viewer-test') + sep), dir);
    assert.ok(dir.includes('guard-cfg-'), dir);
  });

  it('L1d: 生产环境 + 显式 CLAUDE_CONFIG_DIR → 照常尊重(仅测试环境收紧)', () => {
    const real = join(homedir(), '.claude');
    const dir = probeConfigDir({ CLAUDE_CONFIG_DIR: real });
    assert.equal(dir, real);
  });

  it('生产环境 → 默认 ~/.claude 不变', () => {
    const dir = probeConfigDir({});
    assert.equal(dir, join(homedir(), '.claude'), '生产默认解析不受守卫影响');
  });

  it('L1×L1b 跨闸一致性:同一子进程内两闸的 guard 路径由同一 pid-threadId 派生', () => {
    // 真正的跨闸断言(评审 P1 修正:旧版只调 L1b 两次,恒真):同一进程里
    // LOG_DIR(L1)与 getClaudeConfigDir()(L1b)必须共享 <pid>-<threadId> 后缀,
    // 保证 updater 等模块在一个测试进程内看到的两类路径互相隔离但派生一致。
    const env = (() => { const e = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' }; delete e.CLAUDE_CONFIG_DIR; delete e.CCV_LOG_DIR; return e; })();
    const out = execFileSync(process.execPath, ['-e',
      `import(${JSON.stringify(FINDCC_URL)}).then(m => { console.log('LOG=' + m.LOG_DIR); console.log('CFG=' + m.getClaudeConfigDir()); });`,
    ], { env, encoding: 'utf-8', timeout: 30000 });
    const log = out.match(/LOG=(.+)/)[1].trim();
    const cfg = out.match(/CFG=(.+)/)[1].trim();
    const root = join(tmpdir(), 'cc-viewer-test') + sep;
    assert.ok(log.startsWith(root) && cfg.startsWith(root), `两闸都必须落守卫根下: LOG=${log} CFG=${cfg}`);
    const logSuffix = log.match(/guard-(\d+-\d+)$/)?.[1];
    const cfgSuffix = cfg.match(/guard-cfg-(\d+-\d+)$/)?.[1];
    assert.ok(logSuffix && cfgSuffix, `两闸路径都应带 pid-threadId 后缀: LOG=${log} CFG=${cfg}`);
    assert.equal(logSuffix, cfgSuffix, '同进程两闸必须由同一 pid-threadId 派生');
    assert.notEqual(log, cfg, '两闸路径必须互相隔离(LOG_DIR 不等于 configDir)');
  });
});
