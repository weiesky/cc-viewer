// Unit tests for server/lib/ensure-hooks.js — focus on the v3 timeout-field migration
// (P0 root-cause fix for "Claude Code 10min 后 SIGTERM ask-bridge → TUI 接管").
//
// 记账根治（T9）：本文件曾用 url.searchParams.set('t',...) query-busting 做 freshImport，
// 让每个用例拿到一份「按当前 env 重新求值 HOOK_TIMEOUT_S」的新模块。但 query-busting 把
// V8 覆盖记到非 canonical 的 `...ensure-hooks.js?t=0.53` URL；多进程合并时本文件进程里
// canonical 路径几乎 0 覆盖的数据会把姊妹文件 ensure-hooks-deep 的高覆盖冲掉，全量报告
// 退回 ~29%。改法：
//   - 主流程 / 纯函数 / 升级 / purge / legacy / removeAll 等「与具体 timeout 值无关」的断言
//     合到一个 canonical 单次 import 块（env 先设为 unset → HOOK_TIMEOUT_S=86400）；
//   - 真正需要在「模块求值期」拿到不同 CCV_HOOK_TIMEOUT_S 的断言（=0 / =3600 / =abc /
//     小数 / 负数 / clamp / 缺失-vs-0 相等）改用子进程 canonical import 求值，断言意图全保留。
// 子进程覆盖不计入父进程报告，但无所谓：主块的 canonical import 已覆盖这些行，子进程只是
// 复核分支行为，且不再污染 canonical 记账。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// 必须在 import ensure-hooks 之前设置 CLAUDE_CONFIG_DIR + 固定 CCV_HOOK_TIMEOUT_S（unset → 86400）
const tmpHome = mkdtempSync(join(tmpdir(), 'ccv-ensure-hooks-test-'));
process.env.CLAUDE_CONFIG_DIR = tmpHome;
delete process.env.CCV_HOOK_TIMEOUT_S; // 主块固定走默认 86400

const MODULE_PATH = fileURLToPath(new URL('../packages/app/server/lib/ensure-hooks.js', import.meta.url));
const settingsPath = () => resolve(tmpHome, 'settings.json');

function loadSettings() {
  if (!existsSync(settingsPath())) return null;
  return JSON.parse(readFileSync(settingsPath(), 'utf-8'));
}
function writeSettings(data) {
  mkdirSync(tmpHome, { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(data, null, 2));
}
function cleanup() { try { rmSync(settingsPath(), { force: true }); } catch {} }

// 子进程 canonical import：在指定 CCV_HOOK_TIMEOUT_S 下求值模块，回传 evalProbe() 的 JSON。
// probeBody 是一段 module 代码，可用已 import 的 { ensureHooks, HOOK_TIMEOUT_S, _buildHookObj,
// _hookObjEqual, removeAllManagedHooks }，把要断言的值 process.stdout.write(JSON.stringify(...))。
function runInSubprocess(envOver, probeBody) {
  const home = mkdtempSync(join(tmpdir(), 'ccv-ensure-hooks-sub-'));
  const code = `
import { ensureHooks, HOOK_TIMEOUT_S, _buildHookObj, _hookObjEqual, removeAllManagedHooks } from ${JSON.stringify(MODULE_PATH)};
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const settingsPath = resolve(process.env.CLAUDE_CONFIG_DIR, 'settings.json');
const loadSettings = () => existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : null;
${probeBody}
`;
  const env = { ...process.env, CLAUDE_CONFIG_DIR: home };
  delete env.CCV_HOOK_TIMEOUT_S;
  for (const [k, v] of Object.entries(envOver)) {
    if (v === undefined) delete env[k]; else env[k] = String(v);
  }
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf-8' });
    // ensureHooks() 会向 stdout 打 `[cc-viewer] updated ...` 日志，故只取最后一行非空 JSON。
    const lastLine = out.trim().split('\n').filter(Boolean).pop();
    return JSON.parse(lastLine);
  } finally {
    try { rmSync(home, { recursive: true, force: true }); } catch {}
  }
}

// ── 主块：canonical 单次 import（env=default 86400），覆盖全部「与 timeout 值无关」的逻辑 ──
let mod;
const repoRoot = new URL('..', import.meta.url).pathname;
const askPath = `${repoRoot}server/lib/ask-bridge.js`;
const permPath = `${repoRoot}server/lib/perm-bridge.js`;
const turnEndPath = `${repoRoot}server/lib/turn-end-bridge.js`;

describe('lib/ensure-hooks.js — timeout field v3 migration (canonical import)', () => {
  before(async () => { mod = await import('../packages/app/server/lib/ensure-hooks.js'); });
  beforeEach(() => cleanup());
  after(() => { try { rmSync(tmpHome, { recursive: true, force: true }); } catch {} });

  describe('fresh install: 注入 hook 自带 timeout: 86400', () => {
    it('Ask / Perm / TurnEnd 三处 hook 都含 timeout: 86400', () => {
      mod.ensureHooks();
      const s = loadSettings();
      assert.ok(s, 'settings.json must be created');
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      const perm = s.hooks.PreToolUse.find(h => h.matcher === '');
      const turnEnd = s.hooks.Stop[0];
      assert.equal(ask.hooks[0].timeout, 86400, 'AskUserQuestion hook 必须有 timeout=86400（防 Claude Code 10min 中断）');
      assert.equal(perm.hooks[0].timeout, 86400, 'Permission hook 必须有 timeout=86400');
      assert.equal(turnEnd.hooks[0].timeout, 86400, 'Stop hook 必须有 timeout=86400');
    });

    it('hook command 字符串保持包含 ask-bridge.js / perm-bridge.js / turn-end-bridge.js + CCVIEWER_PORT guard', () => {
      mod.ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      assert.match(ask.hooks[0].command, /ask-bridge\.js/);
      assert.match(ask.hooks[0].command, /CCVIEWER_PORT/);
      assert.match(ask.hooks[0].command, /cc-viewer-managed/);
    });

    it('SessionStart hook 注入（/resume 会话切换信号）：无 matcher、带 guard/marker/timeout，幂等', () => {
      mod.ensureHooks();
      const s = loadSettings();
      assert.ok(Array.isArray(s.hooks.SessionStart), 'SessionStart 段被创建');
      const entry = s.hooks.SessionStart.find(h => (h.hooks?.[0]?.command || '').includes('session-start-bridge.js'));
      assert.ok(entry, 'session-start-bridge 条目存在');
      assert.equal(entry.matcher, undefined, '无 matcher = 覆盖全部 source，服务端按 source 门控');
      assert.match(entry.hooks[0].command, /CCVIEWER_PORT/);
      assert.match(entry.hooks[0].command, /cc-viewer-managed/);
      assert.equal(entry.hooks[0].timeout, 86400);
      // Idempotent: a second run must not duplicate the entry.
      mod.ensureHooks();
      const s2 = loadSettings();
      const count = s2.hooks.SessionStart.filter(h => (h.hooks?.[0]?.command || '').includes('session-start-bridge.js')).length;
      assert.equal(count, 1, '重复运行不重复注入');
    });

    it('用户在 SessionStart 已有第三方 hook → 不被破坏', () => {
      writeSettings({ hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo my-own-hook' }] }] } });
      mod.ensureHooks();
      const s = loadSettings();
      const mine = s.hooks.SessionStart.find(h => (h.hooks?.[0]?.command || '').includes('my-own-hook'));
      assert.ok(mine, '第三方 SessionStart hook 原样保留');
      assert.equal(mine.matcher, 'startup');
      assert.ok(s.hooks.SessionStart.some(h => (h.hooks?.[0]?.command || '').includes('session-start-bridge.js')));
    });
  });

  describe('upgrade path: 老用户已有缺 timeout 的 hook → 必须被重写', () => {
    it('已有 AskUserQuestion hook 缺 timeout → ensureHooks 必须把 timeout 加上（核心升级保证）', () => {
      const oldCmd = `[ -n "$CCVIEWER_PORT" ] && node "${askPath}" || true # cc-viewer-managed`;
      writeSettings({
        hooks: {
          PreToolUse: [
            { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: oldCmd }] },
          ],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      assert.equal(ask.hooks[0].timeout, 86400,
        '老 hook（缺 timeout）必须被升级。若 idempotent 比较只看 command 字符串会让此用例失败 → bug 修不到。');
    });

    it('已有 hook 含正确 timeout=86400 → ensureHooks idempotent 不重写', () => {
      mod.ensureHooks(); // 首次注入
      const before = readFileSync(settingsPath(), 'utf-8');
      mod.ensureHooks(); // 二次调用应 no-op
      const after = readFileSync(settingsPath(), 'utf-8');
      assert.equal(before, after, 'idempotent: 二次 ensureHooks 必须不动 settings.json');
    });
  });

  describe('与第三方 hook 共存', () => {
    it('已有用户自定义 hook (非 cc-viewer) → ensureHooks 不破坏它', () => {
      writeSettings({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo "my own hook"' }] },
          ],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const mine = s.hooks.PreToolUse.find(h => h.matcher === 'Bash');
      assert.ok(mine, '用户的 Bash hook 必须保留');
      assert.equal(mine.hooks[0].command, 'echo "my own hook"');
    });

    it('用户在 Stop 数组有自定义 hook → ensureHooks 不破坏它', () => {
      writeSettings({
        hooks: {
          PreToolUse: [],
          Stop: [
            { hooks: [{ type: 'command', command: 'audit-log.sh' }] },
          ],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const audit = s.hooks.Stop.find(h => h.hooks?.[0]?.command === 'audit-log.sh');
      assert.ok(audit, '用户的 Stop audit-log hook 必须保留');
      assert.equal(audit.hooks[0].timeout, undefined, '不能给用户的 hook 加 timeout');
      const turnEnd = s.hooks.Stop.find(h => h.hooks?.[0]?.command?.includes('turn-end-bridge.js'));
      assert.ok(turnEnd, 'cc-viewer 自己的 turn-end hook 必须并存');
    });
  });

  describe('对称升级路径：perm / turn-end 缺 timeout → 自动升级', () => {
    it('perm-bridge hook 缺 timeout → ensureHooks 必须加上', () => {
      const oldCmd = `[ -n "$CCVIEWER_PORT" ] && node "${permPath}" || true # cc-viewer-managed`;
      writeSettings({
        hooks: {
          PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: oldCmd }] }],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const perm = s.hooks.PreToolUse.find(h => h.matcher === '');
      assert.equal(perm.hooks[0].timeout, 86400);
    });

    it('turn-end-bridge hook 缺 timeout → ensureHooks 必须加上', () => {
      const oldCmd = `[ -n "$CCVIEWER_PORT" ] && node "${turnEndPath}" || true # cc-viewer-managed`;
      writeSettings({
        hooks: {
          PreToolUse: [],
          Stop: [{ hooks: [{ type: 'command', command: oldCmd }] }],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const turnEnd = s.hooks.Stop.find(h => h.hooks?.[0]?.command?.includes('turn-end-bridge.js'));
      assert.equal(turnEnd.hooks[0].timeout, 86400);
    });
  });

  describe('错值 timeout 被纠正', () => {
    it('已有 timeout=999 (用户手编 / 老版本残留) → ensureHooks 改回当前 HOOK_TIMEOUT_S', () => {
      const cmd = `[ -n "$CCVIEWER_PORT" ] && node "${askPath}" || true # cc-viewer-managed`;
      writeSettings({
        hooks: {
          PreToolUse: [
            { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: cmd, timeout: 999 }] },
          ],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      assert.equal(ask.hooks[0].timeout, 86400, '错值必须被改回当前默认值');
    });
  });

  describe('merge 而非 replace：保留第三方追加字段', () => {
    it('已有 hook 带 if/once/async 等 schema 合法字段 → rewrite 时必须保留', () => {
      const cmd = `[ -n "$CCVIEWER_PORT" ] && node "${askPath}" || true # cc-viewer-managed`;
      writeSettings({
        hooks: {
          PreToolUse: [{
            matcher: 'AskUserQuestion',
            hooks: [{
              type: 'command',
              command: cmd,
              if: 'some condition',
              once: true,
              shell: 'bash',
            }],
          }],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      const h = ask.hooks[0];
      assert.equal(h.timeout, 86400, 'timeout 必须被加上');
      assert.equal(h.if, 'some condition', '第三方 if 字段必须保留');
      assert.equal(h.once, true, '第三方 once 字段必须保留');
      assert.equal(h.shell, 'bash', '第三方 shell 字段必须保留');
    });
  });

  describe('_hookObjEqual 单元测试（边界，与 timeout 值无关的支）', () => {
    it('undefined / null existing → false', () => {
      assert.equal(mod._hookObjEqual(undefined, mod._buildHookObj('cmd')), false);
      assert.equal(mod._hookObjEqual(null, mod._buildHookObj('cmd')), false);
    });

    it('command 不同 → false', () => {
      const a = { type: 'command', command: 'a', timeout: 86400 };
      const b = mod._buildHookObj('b');
      assert.equal(mod._hookObjEqual(a, b), false);
    });

    it('type 不同 → false', () => {
      const a = { type: 'other', command: 'x', timeout: 86400 };
      assert.equal(mod._hookObjEqual(a, mod._buildHookObj('x')), false);
    });

    it('字符串 timeout "86400" vs 数字 86400 → Number() 转换后相等', () => {
      const existing = { type: 'command', command: 'x', timeout: '86400' };
      assert.equal(mod._hookObjEqual(existing, mod._buildHookObj('x')), true, 'Number() 对字符串数字转换应让两者相等');
    });

    it('timeout 不同 → false', () => {
      const existing = { type: 'command', command: 'x', timeout: 999 };
      assert.equal(mod._hookObjEqual(existing, mod._buildHookObj('x')), false);
    });
  });

  describe('stale-path purge: lib/ → server/lib/ 升级路径', () => {
    it('老 entry 含 cc-viewer/lib/ask-bridge.js（无 server/）且带 marker → 被清除并重建为 server/lib/', () => {
      writeSettings({
        hooks: {
          PreToolUse: [
            {
              matcher: 'AskUserQuestion',
              hooks: [{
                type: 'command',
                command: '[ -n "$CCVIEWER_PORT" ] && node "/abs/cc-viewer/lib/ask-bridge.js" || true # cc-viewer-managed',
                timeout: 86400,
              }],
            },
            {
              matcher: '',
              hooks: [{
                type: 'command',
                command: '[ -n "$CCVIEWER_PORT" ] && node "/abs/cc-viewer/lib/perm-bridge.js" || true # cc-viewer-managed',
                timeout: 86400,
              }],
            },
          ],
          Stop: [
            {
              hooks: [{
                type: 'command',
                command: '[ -n "$CCVIEWER_PORT" ] && node "/abs/cc-viewer/lib/turn-end-bridge.js" || true # cc-viewer-managed',
                timeout: 86400,
              }],
            },
          ],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      const perm = s.hooks.PreToolUse.find(h => h.matcher === '');
      const turnEnd = s.hooks.Stop[0];
      assert.match(ask.hooks[0].command, /server\/lib\/ask-bridge\.js/, 'ask path 应升级为 server/lib/');
      assert.doesNotMatch(ask.hooks[0].command, /cc-viewer\/lib\/ask-bridge\.js/, 'stale lib/ 路径应被清除');
      assert.match(perm.hooks[0].command, /server\/lib\/perm-bridge\.js/);
      assert.match(turnEnd.hooks[0].command, /server\/lib\/turn-end-bridge\.js/);
    });

    it('purge 仅命中带 cc-viewer-managed marker 的条目，未带 marker 的同名路径 entry 不动', () => {
      writeSettings({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Read',
              hooks: [{
                type: 'command',
                command: 'node "/some/third-party/cc-viewer/lib/ask-bridge.js"',
              }],
            },
          ],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const thirdParty = s.hooks.PreToolUse.find(h => h.matcher === 'Read');
      assert.ok(thirdParty, '未带 marker 的 Read entry 必须保留');
      assert.equal(
        thirdParty.hooks[0].command,
        'node "/some/third-party/cc-viewer/lib/ask-bridge.js"',
        '第三方 command 不能被改写'
      );
    });

    // P1-5: pre-marker era (1.6.215 之前) — 无 marker / 无 CCVIEWER_PORT guard / 老 matcher
    it('pre-marker era 老 perm-bridge entry（matcher=Bash|Write|...）被 legacy cleanup 删除并由主流程重建', () => {
      writeSettings({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash|Write|Edit|NotebookEdit',
              hooks: [{
                type: 'command',
                command: 'node "/abs/cc-viewer/lib/perm-bridge.js"',
              }],
            },
          ],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const oldEntry = s.hooks.PreToolUse.find(h => h.matcher === 'Bash|Write|Edit|NotebookEdit');
      assert.equal(oldEntry, undefined, 'pre-marker era 老 matcher entry 必须被清除');
      const fresh = s.hooks.PreToolUse.find(h => h.matcher === '');
      assert.ok(fresh, '新格式 perm-bridge entry 必须被重新插入');
      assert.match(fresh.hooks[0].command, /server\/lib\/perm-bridge\.js/);
      assert.match(fresh.hooks[0].command, /# cc-viewer-managed/);
      assert.match(fresh.hooks[0].command, /\$CCVIEWER_PORT/);
    });

    // Boundary: 同 matcher 一 stale 一 fresh 共存 — fresh 必须保留，stale 必须 purge
    it('同 matcher 一 stale 一 fresh 共存：stale 被 purge，fresh 保留', () => {
      writeSettings({
        hooks: {
          PreToolUse: [
            {
              matcher: 'AskUserQuestion',
              hooks: [{
                type: 'command',
                command: '[ -n "$CCVIEWER_PORT" ] && node "/nonexistent/cc-viewer/lib/ask-bridge.js" || true # cc-viewer-managed',
                timeout: 86400,
              }],
            },
          ],
          Stop: [],
        },
      });
      mod.ensureHooks();
      const s = loadSettings();
      const asks = s.hooks.PreToolUse.filter(h => h.matcher === 'AskUserQuestion');
      assert.equal(asks.length, 1, '应该只有一条 AskUserQuestion entry');
      assert.match(asks[0].hooks[0].command, /server\/lib\/ask-bridge\.js/);
      assert.doesNotMatch(asks[0].hooks[0].command, /nonexistent/);
    });

    // Boundary: settings.json 完全无 hooks key — _purge 不崩
    it('settings 无 hooks key → ensureHooks 不崩，正常初始化', () => {
      writeSettings({});
      mod.ensureHooks();
      const s = loadSettings();
      assert.ok(Array.isArray(s.hooks.PreToolUse));
      assert.ok(Array.isArray(s.hooks.Stop));
      assert.ok(s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion'));
    });
  });

  describe('removeAllManagedHooks: uninstall 路径', () => {
    it('清除所有带 cc-viewer-managed marker 的 entry（Pre + Stop），不论 path 状态', () => {
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'AskUserQuestion',
              hooks: [{ type: 'command', command: 'node "/path/ok.js" # cc-viewer-managed', timeout: 86400 }],
            },
            {
              matcher: 'Read',
              hooks: [{ type: 'command', command: 'node "/some-third-party.js"' }],  // 无 marker
            },
          ],
          Stop: [
            { hooks: [{ type: 'command', command: 'node "/another.js" # cc-viewer-managed' }] },
          ],
        },
      };
      const removed = mod.removeAllManagedHooks(settings);
      assert.equal(removed, 2, '2 条 cc-viewer-managed entry 必须被清除');
      assert.equal(settings.hooks.PreToolUse.length, 1, '仅第三方 Read entry 留下');
      assert.equal(settings.hooks.PreToolUse[0].matcher, 'Read');
      assert.equal(settings.hooks.Stop.length, 0, 'Stop section 全清');
    });
  });
});

// ── env 变体块：必须在「模块求值期」拿到不同 CCV_HOOK_TIMEOUT_S，改用子进程 canonical import ──
// （断言意图与旧 query-busting 版本一一对应；子进程覆盖不计入父报告，但主块已覆盖这些行。）
describe('lib/ensure-hooks.js — CCV_HOOK_TIMEOUT_S env 变体（子进程 canonical import）', () => {
  it('CCV_HOOK_TIMEOUT_S=0 时不写 timeout 字段（回退到原 Claude Code 10min 行为）', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '0' }, `
      ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      process.stdout.write(JSON.stringify({ timeout: ask.hooks[0].timeout ?? null, HOOK_TIMEOUT_S }));
    `);
    assert.equal(r.timeout, null, 'timeout 字段必须不存在');
    assert.equal(r.HOOK_TIMEOUT_S, 0);
  });

  it('CCV_HOOK_TIMEOUT_S=3600 自定义值（1h）正确生效', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '3600' }, `
      ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      process.stdout.write(JSON.stringify({ timeout: ask.hooks[0].timeout }));
    `);
    assert.equal(r.timeout, 3600);
  });

  it('CCV_HOOK_TIMEOUT_S 非法值（"abc"） → fallback 默认 86400', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: 'abc' }, `
      ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      process.stdout.write(JSON.stringify({ timeout: ask.hooks[0].timeout }));
    `);
    assert.equal(r.timeout, 86400);
  });

  it('CCV_HOOK_TIMEOUT_S=0 时 rewrite 必须 delete 老 timeout 字段', () => {
    // 预置一条带 timeout=86400 的 cc-viewer-managed ask hook，子进程内以 =0 求值后必须清掉。
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '0' }, `
      import { writeFileSync, mkdirSync } from 'node:fs';
      import { resolve as _resolve } from 'node:path';
      const repoRoot = ${JSON.stringify(repoRoot)};
      const askPath = repoRoot + 'server/lib/ask-bridge.js';
      const cmd = '[ -n "$CCVIEWER_PORT" ] && node "' + askPath + '" || true # cc-viewer-managed';
      mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
      writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: cmd, timeout: 86400 }] }], Stop: [] } }));
      ensureHooks();
      const s = loadSettings();
      const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
      process.stdout.write(JSON.stringify({ timeout: ask.hooks[0].timeout ?? null }));
    `);
    assert.equal(r.timeout, null, 'CCV_HOOK_TIMEOUT_S=0 必须清掉老 timeout 字段');
  });

  it('_hookObjEqual: timeout 缺失 vs 0 → 都视为 0 → 相等（CCV_HOOK_TIMEOUT_S=0）', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '0' }, `
      const existing = { type: 'command', command: 'x' }; // 无 timeout
      const desired = _buildHookObj('x'); // 也无 timeout (HOOK_TIMEOUT_S=0)
      process.stdout.write(JSON.stringify({ eq: _hookObjEqual(existing, desired) }));
    `);
    assert.equal(r.eq, true);
  });

  it('小数 0.5 → fallback 默认（防 0.5 → 500ms 让 hook 半秒就超时）', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '0.5' }, `process.stdout.write(JSON.stringify({ t: HOOK_TIMEOUT_S }));`);
    assert.equal(r.t, 86400, '小数必须 fallback 默认 86400');
  });

  it('负数 → fallback 默认', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '-1' }, `process.stdout.write(JSON.stringify({ t: HOOK_TIMEOUT_S }));`);
    assert.equal(r.t, 86400);
  });

  it('超过 7 天硬上限 → 被 clamp 到 7d (604800s)', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '99999999' }, `process.stdout.write(JSON.stringify({ t: HOOK_TIMEOUT_S }));`);
    assert.equal(r.t, 7 * 86400, '极大值必须被 clamp 防 setTimeout 2^31 退化');
  });

  it('正常 < 7d 整数原样接受', () => {
    const r = runInSubprocess({ CCV_HOOK_TIMEOUT_S: '3600' }, `process.stdout.write(JSON.stringify({ t: HOOK_TIMEOUT_S }));`);
    assert.equal(r.t, 3600);
  });
});
