import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { execSync, spawn as realSpawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { t } from '../i18n.js';
import { getClaudeConfigDir } from '../../findcc.js';
import { PACKAGE_JSON } from '../_paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 探测当前 cc-viewer 是否通过 Homebrew 安装。
// brew 的标准布局：<prefix>/Cellar/cc-viewer/<version>/lib/node_modules/cc-viewer/
//   - Apple Silicon 默认 prefix: /opt/homebrew
//   - Intel mac 默认 prefix:    /usr/local
//   - linuxbrew / 自定义 prefix: 任意路径，但 Cellar/cc-viewer 段不变
// 走 realpath 解析符号链接（npm-style bin shim 可能链到 Cellar 里）。
// dirOverride 用于单测注入；realpathImpl 同理。
// 失败安全：realpath 抛出 / 路径不匹配 → 返回 null（让上层走默认 npm 路径，不会误升级）。
export function detectHomebrewInstall(dirOverride, realpathImpl = realpathSync) {
  const dir = dirOverride || __dirname;
  let real;
  try {
    real = realpathImpl(dir);
  } catch {
    real = dir;
  }
  // 用正斜杠规范化 Windows 反斜杠（brew 不在 Windows，但 indexOf 跨平台稳一点）
  const normalized = real.replace(/\\/g, '/');
  const idx = normalized.indexOf('/Cellar/cc-viewer/');
  if (idx === -1) return null;
  // 校验 Cellar 后必须紧跟"版本号样式"目录段：必须以数字开头，仅含数字/字母/. _ - +
  // 防御 dev clone 场景：用户在 /Users/x/projects/Cellar/cc-viewer/lib/... 工作时
  // 不应误判为 brew 安装；同样防御 Time Machine backups 等含此 segment 的非真实安装。
  // 注意：cc-viewer formula 当前没有 `head do` block，所以 brew HEAD install
  // (Cellar/cc-viewer/HEAD-<sha>/) 不会被这里命中。如果未来 formula 加了 head do，
  // 需要把正则放宽为 /^(?:\d[\w.\-+]*|HEAD-[\w.\-+]+)\//，否则 HEAD 用户会被静默
  // 路由到 npm install -g 分支，触发双渠道污染。
  const afterCellar = normalized.slice(idx + '/Cellar/cc-viewer/'.length);
  if (!/^\d[\w.\-+]*\//.test(afterCellar)) return null;
  return normalized.slice(0, idx); // 返回 brew prefix
}

// Detect whether cc-viewer was installed via a pnpm global install (`pnpm add -g`).
// pnpm's global layout: <root>/global/<id>/node_modules/.pnpm/cc-viewer@<version>/node_modules/cc-viewer/
//   - macOS default root:    ~/Library/pnpm (PNPM_HOME)
//   - Linux default root:    ~/.local/share/pnpm
//   - Windows default root:  %LOCALAPPDATA%\pnpm
//   - custom PNPM_HOME / global-dir: any path, but the `.pnpm` virtual-store segment stays fixed.
// Detection key: the `/.pnpm/cc-viewer@` virtual-store segment. npm never creates a `.pnpm`
// directory and the `pkg@<version>`-style segment only occurs inside pnpm-managed trees, so this
// is reliable regardless of where PNPM_HOME lives — a plain `/pnpm/` segment check would misfire
// on `npm i -g --prefix ~/Library/pnpm` installs. The marker covers `pnpm add -g` installs,
// `pnpm dlx` caches, and pnpm projects running cc-viewer from their own node_modules — all of
// them must NOT be upgraded via `npm install -g` (dual-channel pollution). The module's own
// realpath always flows through the virtual store (bin-shim symlinks resolve there too), so no
// PNPM_HOME env read is needed.
// dirOverride is for unit-test injection; realpathImpl likewise.
// Fail-safe: realpath throwing / path mismatch -> null (upstream falls back to the default npm
// path, never an unintended upgrade).
export function detectPnpmGlobalInstall(dirOverride, realpathImpl = realpathSync) {
  const dir = dirOverride || __dirname;
  let real;
  try {
    real = realpathImpl(dir);
  } catch {
    real = dir;
  }
  // Normalize Windows backslashes (forward slashes keep indexOf portable)
  const normalized = real.replace(/\\/g, '/');
  const marker = '/.pnpm/cc-viewer@';
  const idx = normalized.indexOf(marker);
  if (idx === -1) return null;
  // The segment after `cc-viewer@` must be version-shaped (same regex as the brew detector):
  // rejects dev-clone / backup paths that merely contain the literal marker text, and tag-style
  // segments like `cc-viewer@nightly` (pnpm tag installs — same caveat as the brew HEAD comment).
  const after = normalized.slice(idx + marker.length);
  if (!/^\d[\w.\-+]*\//.test(after)) return null;
  // Return the pnpm root (PNPM_HOME / custom global-dir): the path up to the first `/global/`
  // segment; without one (e.g. a dlx cache) strip the trailing `/node_modules` and return that.
  const globalIdx = normalized.indexOf('/global/');
  if (globalIdx !== -1) return normalized.slice(0, globalIdx);
  const preMarker = normalized.slice(0, idx);
  return preMarker.endsWith('/node_modules')
    ? preMarker.slice(0, -'/node_modules'.length)
    : preMarker;
}

const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
const CACHE_DIR = join(getClaudeConfigDir(), 'cc-viewer');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const CC_SETTINGS_FILE = join(getClaudeConfigDir(), 'settings.json');

function getCurrentVersion() {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8'));
  return pkg.version;
}

function parseVersion(ver) {
  const [major, minor, patch] = ver.split('.').map(Number);
  return { major, minor, patch };
}

function isNewer(remote, current) {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  if (r.major !== c.major) return r.major > c.major;
  if (r.minor !== c.minor) return r.minor > c.minor;
  return r.patch > c.patch;
}

// 读取 Claude Code 全局配置，判断是否允许自更新
function isAutoUpdateEnabled() {
  // 环境变量禁用
  if (process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC) return false;

  try {
    if (!existsSync(CC_SETTINGS_FILE)) return true; // 默认启用
    const settings = JSON.parse(readFileSync(CC_SETTINGS_FILE, 'utf-8'));
    // Claude Code 用 autoUpdates: false 显式禁用
    if (settings.autoUpdates === false) return false;
  } catch { }

  return true; // 默认启用
}

function shouldCheck() {
  try {
    if (!existsSync(CACHE_FILE)) return true;
    const data = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    return Date.now() - data.lastCheck > CHECK_INTERVAL;
  } catch {
    return true;
  }
}

function saveCheckTime() {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify({ lastCheck: Date.now() }));
  } catch { }
}

// 判断本机是否有任何 CCV 实例在使用：
//   1. 调用方（当前 server）通过 `busy` 明确告知自己有 SSE client / PTY / SDK session 在跑
//   2. 扫 CCV 端口范围，看是否有**除自己外**的其它 CCV server 实例正在 LISTEN
// 参数 `lsofImpl` 用于单测注入假的 lsof 输出；默认走真 execSync。
// 非 POSIX / 没装 lsof / 超时 → fallback 只看 busy，不强行判忙（避免 Windows 永远升不了级）。
export function isAnyCcvBusy({ currentPid, busy, portRange, lsofImpl } = {}) {
  if (busy) return true;

  const [start, end] = Array.isArray(portRange) && portRange.length === 2 ? portRange : [7008, 7099];
  const pid = typeof currentPid === 'number' ? currentPid : process.pid;
  const runLsof = lsofImpl || ((cmd) => execSync(cmd, { timeout: 2000, encoding: 'utf-8', windowsHide: true }));

  try {
    const out = String(runLsof(`lsof -iTCP:${start}-${end} -sTCP:LISTEN -P -n -Fp`));
    // -Fp 输出每行是 field：p<pid> 是进程标识，f<fd>/cwd/txt 等是其它字段，不能误纳。
    // 防御：(a) 预先剥 CRLF（Windows / 某些管道会带 \r），(b) 用严格正则 ^p\d+$，只认"p + 纯数字"，
    //       拒 `p` 空行 / `p-1` 负值 / `p0` / `p\r` 等畸形；(c) 只保留正整数。
    const lines = out.replace(/\r/g, '').split('\n');
    const pids = lines
      .filter(l => /^p\d+$/.test(l))
      .map(l => Number(l.slice(1)))
      .filter(n => Number.isFinite(n) && n > 0);
    const others = pids.filter(p => p !== pid);
    if (others.length > 0) return true;
  } catch {
    // lsof 不在 / 非 POSIX / 超时 → 放过
  }
  return false;
}

// options:
//   fetchImpl        -- 注入 fetch（默认全局 fetch）
//   spawnImpl        -- 注入 spawn（默认 node:child_process 的 spawn）
//   lsofImpl         -- 注入 lsof exec（默认 execSync）；传给 isAnyCcvBusy
//   dryRun           -- 不真执行 install（spawn 路径直接跳过）
//   busy             -- 本进程是否忙（SSE/PTY/SDK 活跃），由 server.js 调用点组装
//   portRange        -- [start, end]，传给 lsof 扫端口；server.js 里 START_PORT/MAX_PORT
//   brewPrefix       -- 测试注入。语义：任何非 undefined 值（包含 null/string/''）= 显式覆盖，
//                       undefined 或不传 = 走真探测。改用 !== undefined 比 hasOwnProperty 更稳，
//                       避免 caller 用 `{ ...opts, brewPrefix: maybe }` 时 maybe 为 undefined
//                       却被当显式传值，从而绕过自动检测，让 brew 用户被错误地走 npm 路径升级。
//   pnpmRoot         -- 测试注入。语义与 brewPrefix 完全相同：非 undefined = 显式覆盖（含 null/''），
//                       undefined = 走真探测 detectPnpmGlobalInstall()。
//
// 返回 status:
//   disabled | skipped | skipped_test_context | latest | major_available | deferred_busy
//   | brew_managed | pnpm_managed | upgrading_in_background | error
export async function checkAndUpdate(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const spawnImpl = options.spawnImpl || realSpawn;
  const lsofImpl = options.lsofImpl; // undefined → isAnyCcvBusy 走默认
  const dryRun = options.dryRun === true;
  const busy = options.busy === true;
  const portRange = options.portRange;
  // brew 安装 → 跳过 npm install -g（会跟 brew 的 Cellar 打架），改建议 brew upgrade
  const brewPrefix = options.brewPrefix !== undefined
    ? options.brewPrefix
    : detectHomebrewInstall();
  // pnpm 全局安装（pnpm add -g）→ 同样不能 npm install -g：会在 npm 全局前缀残留第二份
  // cc-viewer（双渠道污染），改建议 pnpm add -g cc-viewer@<version>
  const pnpmRoot = options.pnpmRoot !== undefined
    ? options.pnpmRoot
    : detectPnpmGlobalInstall();
  const currentVersion = getCurrentVersion();

  // 跟随 Claude Code 全局配置
  if (!isAutoUpdateEnabled()) {
    return { status: 'disabled', currentVersion, remoteVersion: null };
  }

  if (!shouldCheck()) {
    return { status: 'skipped', currentVersion, remoteVersion: null };
  }

  // ████████ 测试隔离铁闸 L5 —— 绝对不可移除(2026-06-06 数据事故防再犯)████████
  // 单元测试【绝不允许】发送真实网络请求:起真实 server 的测试,启动链的 30s 定时器
  // (server.js startViewer)会走到这里,真打 registry.npmjs.org,同大版本空闲时甚至
  // 触发 detached `npm install` 真实自更新——测试能改写用户的 cc-viewer 安装。
  // 条件说明:
  //  - NODE_TEST_CONTEXT:node:test runner 自动注入,覆盖测试进程及 spread env 子进程;
  //  - NODE_ENV==='test' 兜底:覆盖测试用 spawnSync 起的孙进程(NODE_TEST_CONTEXT 跨代
  //    传递不保证,如 branch-server.test.js 的 runScenario);
  //  - 注入 fetchImpl 的 updater 单测(假网络)不受影响,走正常逻辑;
  //  - 闸位必须在 disabled/skipped 早退【之后】、真实 fetch【之前】:放函数入口会劫持
  //    存量无-fetchImpl 用例对 disabled/skipped 的断言。
  // 守卫单测:test/updater-test-guard.test.js。
  if ((process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test') && !options.fetchImpl) {
    return { status: 'skipped_test_context', currentVersion, remoteVersion: null };
  }
  // ████████████████████████████████████████████████████████████████████████████

  try {
    const res = await fetchImpl('https://registry.npmjs.org/cc-viewer');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const remoteVersion = data['dist-tags']?.latest;

    // saveCheckTime 在所有分支前统一记录：4h 节流既避免 npm fetch 频繁，
    // 也覆盖 brew_managed / pnpm_managed banner 的提示频率（stderr 一行 + SSE 一次足够，4h 后再提）。
    // 故意不为 brew_managed / pnpm_managed 单独提速：banner 刷屏比慢提示更扰人，stderr 仍是侧通道。
    saveCheckTime();

    if (!remoteVersion) {
      return { status: 'error', currentVersion, remoteVersion: null, error: 'No version found' };
    }

    if (!isNewer(remoteVersion, currentVersion)) {
      return { status: 'latest', currentVersion, remoteVersion };
    }

    const remote = parseVersion(remoteVersion);
    const current = parseVersion(currentVersion);

    // brew 安装：不能 npm install -g（会跟 Cellar 打架，残留双安装）→ 提示 brew upgrade。
    // 必须放在 major_available 之前——否则 brew 用户跨大版本时会被引导跑 npm i -g，
    // 触发我们正想杜绝的"双渠道污染"。`brew upgrade cc-viewer` 跨大版本同样能用，
    // brew_managed 文案适用所有版本差。
    if (brewPrefix) {
      console.error(`[CC Viewer] ${t('update.brewManaged', { version: remoteVersion })}`);
      return { status: 'brew_managed', currentVersion, remoteVersion, brewPrefix };
    }

    // pnpm 全局安装：不能 npm install -g（会在 npm 全局前缀造出第二份，双渠道污染）
    // → 提示 pnpm add -g cc-viewer@<version>。同样必须放在 major_available 之前，
    // 否则 pnpm 用户跨大版本时会被引导跑 npm i -g，触发我们正想杜绝的双渠道污染。
    if (pnpmRoot) {
      console.error(`[CC Viewer] ${t('update.pnpmManaged', { version: remoteVersion })}`);
      return { status: 'pnpm_managed', currentVersion, remoteVersion, pnpmRoot };
    }

    // 跨大版本：仅提示
    if (remote.major !== current.major) {
      console.error(`[CC Viewer] ${t('update.majorAvailable', { version: remoteVersion })}`);
      return { status: 'major_available', currentVersion, remoteVersion };
    }

    // 同大版本：查忙
    if (isAnyCcvBusy({ currentPid: process.pid, busy, portRange, lsofImpl })) {
      // 有人在用 → 不升，避免卡顿；下次启动再重试。Banner 仍会广播（见 server.js 调用点）。
      return { status: 'deferred_busy', currentVersion, remoteVersion };
    }

    // 空闲 → detached spawn 后台跑 npm install；立即返回，不阻塞事件循环。
    // Windows 下 `npm` 实际是 `npm.cmd`，Node spawn **不带 shell** 不会自动解析 .cmd 扩展名，会 ENOENT。
    // 用 `shell: process.platform === 'win32'` 条件启用 shell 模式跨平台兜底。
    console.error(`[CC Viewer] ${t('update.updating', { version: remoteVersion })} (background)`);
    if (!dryRun) {
      try {
        const child = spawnImpl(
          'npm',
          ['install', '-g', `cc-viewer@${remoteVersion}`, '--no-audit', '--no-fund'],
          // windowsHide：Windows 下 shell 模式经 cmd.exe 跑 npm.cmd（console-subsystem），
          // 不隐藏会在后台更新期间常驻一个可见控制台窗口；POSIX 上为 no-op。
          { detached: true, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true }
        );
        if (child && typeof child.unref === 'function') child.unref();
      } catch (err) {
        console.error(`[CC Viewer] ${t('update.failed', { error: err.message })}`);
        return { status: 'error', currentVersion, remoteVersion, error: err.message };
      }
    }
    return { status: 'upgrading_in_background', currentVersion, remoteVersion };
  } catch (err) {
    saveCheckTime();
    return { status: 'error', currentVersion, remoteVersion: null, error: err.message };
  }
}
