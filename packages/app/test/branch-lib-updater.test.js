// ████████ 数据安全死命令 — 本文件曾是删除用户真实数据的事故真凶(2026-06-06)████████
// 本文件下方对 CACHE_DIR(=join(getClaudeConfigDir(),'cc-viewer'))/CC_SETTINGS_FILE
// 做 rmSync(recursive)/writeFileSync/unlinkSync。CACHE_DIR 派生自 getClaudeConfigDir(),
// 在未锁 CLAUDE_CONFIG_DIR 时会解析到真实 ~/.claude/cc-viewer —— 此前 rmSync(CACHE_DIR,
// {recursive}) 因此把用户 40GB 历史日志整树删除(第 1/4 次事故确证真凶)。
// 死命令:在 CLAUDE_CONFIG_DIR 未锁向进程私有临时目录之前,永远不许对 CACHE_DIR/settings
// 做任何写删,也永远不许 import 任何派生该路径的项目模块。
//
// ████ ESM 静态 import 会被提升(hoist),先于本文件任何语句执行 ████
// 因此「文件顶部赋 process.env 再静态 import ../findcc.js/../server/lib/updater.js」是【无效】的:
// CACHE_DIR 会在 env 生效前用真实 ~/.claude 算出。必须严格遵守以下顺序,禁止改回静态 import:
//   1) 仅 node: 内置模块用静态 import;
//   2) 先 mkdtempSync 私有目录并赋 CLAUDE_CONFIG_DIR(+CCV_LOG_DIR);
//   3) 再用顶层 await 动态 import 项目模块,使 CACHE_DIR 落在私有目录内。
// (这是文件内显式隔离 = 第六层闸,目的:本文件单跑无外部 env 也绝不依赖铁闸独木支撑。)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 隔离段:务必早于任何项目模块 import ──
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-updater-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;   // CACHE_DIR/settings/ensure-hooks 全派生于此,必须先锁

// 隔离段之后才动态 import 项目模块(此时 getClaudeConfigDir() 已返回 __isoDir)
const {
  checkAndUpdate,
  isAnyCcvBusy,
  detectHomebrewInstall,
} = await import('../server/lib/updater.js');
const { getClaudeConfigDir } = await import('../findcc.js');

// 目标：补齐 updater.js 的分支盲点（单跑口径 branch 86.49% → >=95）。
// 已覆盖的 happy path 见 test/updater.test.js；本文件只打剩余分支：
//   - shouldCheck() catch（损坏缓存 JSON，line 89-90 hint）
//   - isAutoUpdateEnabled() catch（损坏 settings JSON，line 78 空 catch）
//   - saveCheckTime() !existsSync(CACHE_DIR) 真臂（目录缺失 → mkdirSync）
//   - isAnyCcvBusy portRange 默认臂 + currentPid 默认臂
//   - detectHomebrewInstall dirOverride||__dirname 默认臂（无参调用）

const CACHE_DIR = join(getClaudeConfigDir(), 'cc-viewer');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CC_SETTINGS_FILE = join(getClaudeConfigDir(), 'settings.json');

// ── 共享文件的备份/还原（与现有 updater.test.js 同一套机制，避免污染真实配置）──
let savedCache = null;
let cacheExisted = false;
let savedSettings = null;
let settingsExisted = false;

function backupCache() {
  try {
    cacheExisted = existsSync(CACHE_FILE);
    if (cacheExisted) savedCache = readFileSync(CACHE_FILE, 'utf-8');
  } catch { }
}

function restoreCache() {
  try {
    if (cacheExisted && savedCache !== null) {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(CACHE_FILE, savedCache);
    } else if (!cacheExisted && existsSync(CACHE_FILE)) {
      unlinkSync(CACHE_FILE);
    }
  } catch { }
  savedCache = null;
  cacheExisted = false;
}

function backupSettings() {
  try {
    settingsExisted = existsSync(CC_SETTINGS_FILE);
    if (settingsExisted) savedSettings = readFileSync(CC_SETTINGS_FILE, 'utf-8');
  } catch { }
}

function restoreSettings() {
  try {
    if (settingsExisted && savedSettings !== null) {
      writeFileSync(CC_SETTINGS_FILE, savedSettings);
    } else if (!settingsExisted && existsSync(CC_SETTINGS_FILE)) {
      unlinkSync(CC_SETTINGS_FILE);
    }
  } catch { }
  savedSettings = null;
  settingsExisted = false;
}

// 写一份启用自更新的 settings（删除 autoUpdates 阻断键）
function enableAutoUpdates() {
  try {
    let settings = {};
    if (existsSync(CC_SETTINGS_FILE)) {
      settings = JSON.parse(readFileSync(CC_SETTINGS_FILE, 'utf-8'));
    }
    delete settings.autoUpdates;
    mkdirSync(getClaudeConfigDir(), { recursive: true });
    writeFileSync(CC_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch { }
}

function readPkgRemoteBump() {
  const pkgPath = join(import.meta.dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  return { pkg, remote: `${maj}.${min}.${pat + 1}` };
}

// ─── shouldCheck() catch 臂：缓存文件存在但 JSON 损坏 → 回退 true（继续检查）───
// 这条 catch（line 88-90）是 hint 指出的唯一 uncovered 行。
describe('updater 分支 — shouldCheck 损坏缓存回退', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    enableAutoUpdates();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
  });

  it('缓存文件存在但内容非法 JSON → shouldCheck 走 catch 返回 true，继续 fetch', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    // 写入无法被 JSON.parse 解析的内容 → JSON.parse 抛错 → catch → return true
    writeFileSync(CACHE_FILE, '{ this is not valid json ::: ');

    const { pkg, remote } = readPkgRemoteBump();
    // shouldCheck 必须返回 true 才会进入 fetch 分支；用 latest 短路（不真升级）
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: pkg.version } }; } }),
      dryRun: true,
      brewPrefix: null,
    });
    // 走到了 fetch（说明 shouldCheck 返回 true），且 remote == current → latest
    assert.equal(result.status, 'latest');
    assert.equal(result.remoteVersion, pkg.version);
  });
});

// ─── isAutoUpdateEnabled() catch 臂：settings.json 存在但 JSON 损坏 → 空 catch → 默认启用 ───
describe('updater 分支 — isAutoUpdateEnabled 损坏 settings 容错', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
  });

  it('settings.json 非法 JSON → 吞掉异常按默认启用，流程继续到 skipped', async () => {
    mkdirSync(getClaudeConfigDir(), { recursive: true });
    // 损坏 settings → JSON.parse 抛 → 空 catch → 不 return false → 末尾默认 return true
    writeFileSync(CC_SETTINGS_FILE, '<<<not-json>>>');
    // 缓存新鲜 → isAutoUpdateEnabled 通过后命中 shouldCheck 的 false 分支 → skipped
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: Date.now() }));

    const result = await checkAndUpdate({ brewPrefix: null });
    // 没有被判 disabled（说明默认启用生效），且因缓存新鲜而 skipped
    assert.equal(result.status, 'skipped');
    assert.equal(result.remoteVersion, null);
  });
});

// ─── saveCheckTime() 的 !existsSync(CACHE_DIR) 真臂：目录缺失 → 触发 mkdirSync ───
// 通过删除整个 cc-viewer 缓存目录，使 fetch 成功路径里调用的 saveCheckTime 走建目录分支。
describe('updater 分支 — saveCheckTime 缺目录时建目录', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    enableAutoUpdates();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
  });

  it('缓存目录不存在时 saveCheckTime 会 mkdirSync 并写入', async () => {
    // 删除整个缓存目录（含 update-check.json）→ shouldCheck 因 !existsSync(CACHE_FILE) 返回 true
    // → 进入 fetch → saveCheckTime 命中 !existsSync(CACHE_DIR) 真臂
    try { rmSync(CACHE_DIR, { recursive: true, force: true }); } catch { }
    assert.equal(existsSync(CACHE_FILE), false, '前置：缓存目录应已清空');

    const { pkg } = readPkgRemoteBump();
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: pkg.version } }; } }),
      dryRun: true,
      brewPrefix: null,
    });
    assert.equal(result.status, 'latest');
    // saveCheckTime 应已重建目录并写入缓存
    assert.equal(existsSync(CACHE_FILE), true, 'saveCheckTime 应已重建缓存文件');
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    assert.ok(typeof data.lastCheck === 'number' && data.lastCheck > 0);
  });
});

// ─── isAnyCcvBusy：portRange 默认臂 + currentPid 默认臂（不传任何参数 → 走 process.pid / [7008,7099]）───
describe('updater 分支 — isAnyCcvBusy 默认参数臂', () => {
  it('不传 portRange / currentPid 时使用默认端口窗与 process.pid（lsof 注入空 → false）', () => {
    let receivedCmd = null;
    // 只注入 lsofImpl，省略 currentPid + portRange，逼出两条默认臂：
    //   - portRange 非数组 → [7008, 7099]
    //   - currentPid 非 number → process.pid
    const result = isAnyCcvBusy({
      lsofImpl: (cmd) => { receivedCmd = cmd; return ''; },
    });
    assert.equal(result, false, '只有自己一个进程时不应判忙');
    assert.ok(receivedCmd.includes('7008-7099'), `应使用默认端口窗 7008-7099: ${receivedCmd}`);
  });

  it('portRange 长度非 2 时回退默认端口窗', () => {
    let receivedCmd = null;
    // 传单元素数组 → length !== 2 → 默认臂
    isAnyCcvBusy({
      currentPid: 100,
      portRange: [9000],
      lsofImpl: (cmd) => { receivedCmd = cmd; return ''; },
    });
    assert.ok(receivedCmd.includes('7008-7099'), `length!=2 应回退默认窗: ${receivedCmd}`);
  });

  it('默认端口窗 + 注入空 lsof → 不抛异常且返回布尔（不探测用户真实端口）', () => {
    // 隔离要求:绝不能让 isAnyCcvBusy 走真 execSync(lsof) 去扫用户真实端口窗 7008-7099。
    // 注入 lsofImpl 假实现(返回空)逼出全默认臂(portRange=[7008,7099]、pid=process.pid),
    // 既覆盖默认分支,又不触碰真实系统端口。关键是不抛异常,且返回布尔。
    const result = isAnyCcvBusy({ lsofImpl: () => '' });
    assert.equal(typeof result, 'boolean');
    assert.equal(result, false, '注入空 lsof 输出时不应判忙');
  });
});

// ─── isNewer 的 minor 比较臂：major 相等、minor 不同 → 命中 line 64 `return r.minor > c.minor` ───
// 现有测试只有 patch bump（minor 相等→落到 patch）与 major bump（在 line 63 就 return），
// 从不触发 minor 差异分支。用一次 minor bump 走通 line 64 真臂。
describe('updater 分支 — isNewer minor 差异臂', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    enableAutoUpdates();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
  });

  it('同 major、minor 升一级 → isNewer 经 line 64 判定为新，走后台升级', async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: 0 }));

    const pkgPath = join(import.meta.dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const [maj, min] = pkg.version.split('.').map(Number);
    const remote = `${maj}.${min + 1}.0`; // 同大版本、minor 更高

    let spawnCalled = false;
    const result = await checkAndUpdate({
      fetchImpl: async () => ({ ok: true, async json() { return { 'dist-tags': { latest: remote } }; } }),
      busy: false,
      lsofImpl: () => '',
      brewPrefix: null,
      spawnImpl: () => { spawnCalled = true; return { unref() {} }; },
    });
    // minor 更高被判 newer，且同大版本 → 进入空闲后台升级分支
    assert.equal(result.status, 'upgrading_in_background');
    assert.equal(result.remoteVersion, remote);
    assert.equal(spawnCalled, true);
  });
});

// ─── isAutoUpdateEnabled 的 !existsSync(CC_SETTINGS_FILE) 真臂：settings 文件缺失 → 默认启用 ───
describe('updater 分支 — isAutoUpdateEnabled settings 缺失默认启用', () => {
  let origEnv;

  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    backupSettings();
    backupCache();
  });

  afterEach(() => {
    restoreCache();
    restoreSettings();
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
    else process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = origEnv;
  });

  it('settings.json 不存在 → 命中 !existsSync 真臂返回 true（默认启用），流程继续', async () => {
    // 删除 settings 文件 → isAutoUpdateEnabled 走 `if (!existsSync) return true`
    try { if (existsSync(CC_SETTINGS_FILE)) unlinkSync(CC_SETTINGS_FILE); } catch { }
    assert.equal(existsSync(CC_SETTINGS_FILE), false, '前置：settings 应已删除');
    // 缓存新鲜 → 通过启用判定后命中 shouldCheck false 分支 → skipped
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: Date.now() }));

    const result = await checkAndUpdate({ brewPrefix: null });
    // 没被判 disabled（说明缺文件时默认启用），缓存新鲜 → skipped
    assert.equal(result.status, 'skipped');
    assert.equal(result.remoteVersion, null);
  });
});

// ─── detectHomebrewInstall：dirOverride||__dirname 默认臂（无参 → 用模块 __dirname）───
describe('updater 分支 — detectHomebrewInstall 默认 dir 臂', () => {
  it('无参调用使用模块自身 __dirname（当前为 npm-global 安装 → null）', () => {
    // 不传 dirOverride → dir = __dirname（走 || 右臂）；测试宿主是 npm-global，非 brew → null
    const result = detectHomebrewInstall();
    assert.equal(result, null, '当前测试环境非 brew 安装，应返回 null');
  });

  it('空字符串 dirOverride 也走默认臂（falsy → __dirname）', () => {
    // '' 是 falsy → dirOverride || __dirname 取右臂
    const result = detectHomebrewInstall('');
    assert.equal(result, null);
  });
});
