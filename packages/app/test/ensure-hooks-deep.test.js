// Deep coverage for server/lib/ensure-hooks.js — drives the whole ensureHooks()
// main flow plus the exported helpers through a single canonical import so the
// coverage instrumentation credits the real module path. (The sibling
// ensure-hooks.test.js busts the ESM cache with a query string, which makes the
// coverage tool attribute execution to a *different* module URL — hence that
// file's 0% credit and this file's existence.)
//
// 隔离范式：mkdtemp + 在 import 前设 CLAUDE_CONFIG_DIR / CCV_HOOK_TIMEOUT_S；
// 模块只 import 一次（HOOK_TIMEOUT_S 在模块求值期固化），所有用例共用同一份
// timeout=3600 的注入逻辑。afterEach 删 settings.json 隔离每个用例。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// ── 必须在 import 目标模块前设好 env ──────────────────────────────────────
const tmpHome = mkdtempSync(join(tmpdir(), 'ccv-ensure-hooks-deep-'));
process.env.CLAUDE_CONFIG_DIR = tmpHome;
// 定值（非默认、非 0、合法整数）→ 覆盖 IIFE 的 Number/Integer/clamp 三行（29-31），
// 且让所有注入 hook 带 timeout: 3600，便于断言。
process.env.CCV_HOOK_TIMEOUT_S = '3600';

const settingsPath = () => resolve(tmpHome, 'settings.json');
function loadSettings() {
  if (!existsSync(settingsPath())) return null;
  return JSON.parse(readFileSync(settingsPath(), 'utf-8'));
}
function writeSettings(data) {
  mkdirSync(tmpHome, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(data, null, 2));
}

// 真实 bridge 路径（存在 → 不被 stale-purge 当作 stale）
const repoRoot = new URL('../../..', import.meta.url).pathname;
const askPath = `${repoRoot}packages/app/server/lib/ask/ask-bridge.js`;
const permPath = `${repoRoot}packages/app/server/lib/ask/perm-bridge.js`;
const turnEndPath = `${repoRoot}packages/app/server/lib/turn-end-bridge.js`;

let mod;
before(async () => {
  mod = await import('../server/lib/ensure-hooks.js');
});
after(() => { try { rmSync(tmpHome, { recursive: true, force: true }); } catch {} });
beforeEach(() => { try { rmSync(settingsPath(), { force: true }); } catch {} });

describe('ensure-hooks-deep: HOOK_TIMEOUT_S 求值（自定义合法整数）', () => {
  it('CCV_HOOK_TIMEOUT_S=3600 → HOOK_TIMEOUT_S===3600（覆盖 Number/Integer/clamp 行）', () => {
    assert.equal(mod.HOOK_TIMEOUT_S, 3600);
  });
});

describe('ensure-hooks-deep: 全新安装主流程', () => {
  it('无 settings.json → 创建并注入 Ask/Perm/TurnEnd 三处 hook（均带 timeout=3600 + marker + guard）', () => {
    mod.ensureHooks();
    const s = loadSettings();
    assert.ok(s, 'settings.json 必须被创建');
    const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
    const perm = s.hooks.PreToolUse.find(h => h.matcher === '');
    const turnEnd = s.hooks.Stop.find(h => h.hooks?.[0]?.command?.includes('turn-end-bridge.js'));
    for (const [name, h] of [['ask', ask], ['perm', perm], ['turnEnd', turnEnd]]) {
      assert.ok(h, `${name} hook 必须存在`);
      assert.equal(h.hooks[0].timeout, 3600, `${name} timeout=3600`);
      assert.match(h.hooks[0].command, /cc-viewer-managed/);
      assert.match(h.hooks[0].command, /\$CCVIEWER_PORT/);
    }
    assert.match(ask.hooks[0].command, /ask-bridge\.js/);
    assert.match(perm.hooks[0].command, /perm-bridge\.js/);
    assert.match(turnEnd.hooks[0].command, /turn-end-bridge\.js/);
  });

  it('二次 ensureHooks → idempotent，不重写文件', () => {
    mod.ensureHooks();
    const first = readFileSync(settingsPath(), 'utf-8');
    mod.ensureHooks();
    const second = readFileSync(settingsPath(), 'utf-8');
    assert.equal(first, second, '幂等：第二次不动 settings.json');
  });
});

describe('ensure-hooks-deep: 升级路径（缺 timeout → merge 补上，保留第三方字段）', () => {
  it('三处 hook 都缺 timeout + 带第三方 if/once 字段 → 升级补 timeout 且保留追加字段', () => {
    const mk = (p) => `[ -n "$CCVIEWER_PORT" ] && node "${p}" || true # cc-viewer-managed`;
    writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: mk(askPath), if: 'cond', once: true }] },
          { matcher: '', hooks: [{ type: 'command', command: mk(permPath), shell: 'bash' }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: mk(turnEndPath) }] },
        ],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
    const perm = s.hooks.PreToolUse.find(h => h.matcher === '');
    const turnEnd = s.hooks.Stop.find(h => h.hooks?.[0]?.command?.includes('turn-end-bridge.js'));
    assert.equal(ask.hooks[0].timeout, 3600);
    assert.equal(ask.hooks[0].if, 'cond', '第三方 if 必须保留');
    assert.equal(ask.hooks[0].once, true, '第三方 once 必须保留');
    assert.equal(perm.hooks[0].timeout, 3600);
    assert.equal(perm.hooks[0].shell, 'bash', '第三方 shell 必须保留');
    assert.equal(turnEnd.hooks[0].timeout, 3600);
  });
});

describe('ensure-hooks-deep: stale-path purge + legacy cleanup', () => {
  it('stale lib/ 路径（marker + 不存在）被 purge 后由主流程重建为 server/lib/', () => {
    const stale = (n) => `[ -n "$CCVIEWER_PORT" ] && node "/abs/old/cc-viewer/lib/${n}" || true # cc-viewer-managed`;
    writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: stale('ask-bridge.js'), timeout: 3600 }] },
          { matcher: '', hooks: [{ type: 'command', command: stale('perm-bridge.js'), timeout: 3600 }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: stale('turn-end-bridge.js'), timeout: 3600 }] },
        ],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    const ask = s.hooks.PreToolUse.filter(h => h.matcher === 'AskUserQuestion');
    assert.equal(ask.length, 1, 'stale 被 purge，主流程重建唯一一条');
    assert.match(ask[0].hooks[0].command, /server\/lib\/ask\/ask-bridge\.js/);
    assert.doesNotMatch(ask[0].hooks[0].command, /old\/cc-viewer\/lib/);
  });

  it('pre-marker era 老 perm entry（matcher=工具列表，无 marker）被 legacy cleanup 删并重建', () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash|Write|Edit', hooks: [{ type: 'command', command: 'node "/abs/old/perm-bridge.js"' }] },
        ],
        Stop: [],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    assert.equal(s.hooks.PreToolUse.find(h => h.matcher === 'Bash|Write|Edit'), undefined, '老 matcher entry 被清');
    const fresh = s.hooks.PreToolUse.find(h => h.matcher === '');
    assert.ok(fresh, '新格式 perm entry 重建');
    assert.match(fresh.hooks[0].command, /server\/lib\/ask\/perm-bridge\.js/);
  });

  it('legacy cleanup：matcher=null 且含 perm-bridge → 删除', () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: null, hooks: [{ type: 'command', command: 'node "/x/perm-bridge.js"' }] },
        ],
        Stop: [],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    assert.equal(s.hooks.PreToolUse.find(h => h.matcher === null), undefined, 'matcher=null perm entry 被清');
  });

  it('legacy cleanup：matcher=Bash 且 command 含 grep + git/npm → 删除（老 git/npm grep hook）', () => {
    writeSettings({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'grep -E "git|npm" foo' }] },
        ],
        Stop: [],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    const stillThere = s.hooks.PreToolUse.find(
      h => h.matcher === 'Bash' && h.hooks?.[0]?.command?.includes('grep'),
    );
    assert.equal(stillThere, undefined, '老 git/npm grep Bash hook 被 legacy cleanup 清除');
  });
});

describe('ensure-hooks-deep: 与第三方 hook 共存', () => {
  it('用户自有 Bash hook（非 cc-viewer）保留不动', () => {
    writeSettings({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'audit.sh' }] }],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    const mine = s.hooks.PreToolUse.find(h => h.matcher === 'Bash' && h.hooks?.[0]?.command === 'echo mine');
    assert.ok(mine, '用户 Bash hook 保留');
    const audit = s.hooks.Stop.find(h => h.hooks?.[0]?.command === 'audit.sh');
    assert.ok(audit, '用户 Stop hook 保留');
    assert.equal(audit.hooks[0].timeout, undefined, '不给用户 hook 加 timeout');
  });

  it('settings.json malformed → 跳过注入，不抛（外层 catch 吞掉，文件保持原样）', () => {
    writeSettings({}); // 占位
    writeFileSync(settingsPath(), '{ this is not json');
    mod.ensureHooks(); // 必须不抛
    // 文件未被改写（注入被跳过）
    assert.equal(readFileSync(settingsPath(), 'utf-8'), '{ this is not json');
  });
});

describe('ensure-hooks-deep: 导出的纯函数 helper', () => {
  it('_buildHookObj 带 timeout 字段（HOOK_TIMEOUT_S>0）', () => {
    assert.deepEqual(mod._buildHookObj('cmd'), { type: 'command', command: 'cmd', timeout: 3600 });
  });

  it('_hookObjEqual：command 相同 + timeout 相同 → true', () => {
    assert.equal(mod._hookObjEqual({ type: 'command', command: 'c', timeout: 3600 }, mod._buildHookObj('c')), true);
  });
  it('_hookObjEqual：existing 为 null/undefined → false', () => {
    assert.equal(mod._hookObjEqual(null, mod._buildHookObj('c')), false);
    assert.equal(mod._hookObjEqual(undefined, mod._buildHookObj('c')), false);
  });
  it('_hookObjEqual：type 不同 → false', () => {
    assert.equal(mod._hookObjEqual({ type: 'other', command: 'c', timeout: 3600 }, mod._buildHookObj('c')), false);
  });
  it('_hookObjEqual：command 不同 → false', () => {
    assert.equal(mod._hookObjEqual({ type: 'command', command: 'x', timeout: 3600 }, mod._buildHookObj('c')), false);
  });
  it('_hookObjEqual：timeout 不同 → false', () => {
    assert.equal(mod._hookObjEqual({ type: 'command', command: 'c', timeout: 999 }, mod._buildHookObj('c')), false);
  });

  it('removeAllManagedHooks：清所有带 marker 的 entry（Pre+Stop+SessionStart），第三方保留', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'node "/ok.js" # cc-viewer-managed' }] },
          { matcher: 'Read', hooks: [{ type: 'command', command: 'node "/third.js"' }] },
        ],
        Stop: [
          { hooks: [{ type: 'command', command: 'node "/t.js" # cc-viewer-managed' }] },
        ],
        SessionStart: [
          { hooks: [{ type: 'command', command: 'node "/s.js" # cc-viewer-managed' }] },
          { matcher: 'startup', hooks: [{ type: 'command', command: 'node "/user-own.js"' }] },
        ],
      },
    };
    const removed = mod.removeAllManagedHooks(settings);
    assert.equal(removed, 3);
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'Read');
    assert.equal(settings.hooks.Stop.length, 0);
    assert.equal(settings.hooks.SessionStart.length, 1, '第三方 SessionStart 条目保留');
    assert.equal(settings.hooks.SessionStart[0].matcher, 'startup');
  });

  it('stale session-start-bridge 路径被 purge 后由主流程重建', () => {
    writeSettings({
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: '[ -n "$CCVIEWER_PORT" ] && node "/abs/old/lib/session-start-bridge.js" || true # cc-viewer-managed', timeout: 3600 }] },
        ],
      },
    });
    mod.ensureHooks();
    const s = loadSettings();
    const entries = s.hooks.SessionStart.filter(h => (h.hooks?.[0]?.command || '').includes('session-start-bridge.js'));
    assert.equal(entries.length, 1, 'stale 条目被 purge，重建唯一一条');
    assert.match(entries[0].hooks[0].command, /server\/lib\/session-start-bridge\.js|server\\lib\\session-start-bridge\.js/);
  });

  it('removeAllManagedHooks：无 hooks key / 非数组 section → 返回 0，不崩', () => {
    assert.equal(mod.removeAllManagedHooks({}), 0);
    assert.equal(mod.removeAllManagedHooks({ hooks: { PreToolUse: 'oops', Stop: null } }), 0);
  });
});
