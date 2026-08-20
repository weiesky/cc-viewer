// Branch-coverage 补强：server/lib/ensure-hooks.js 的 atomic-write 失败路径
// （inner catch 234-236 + outer catch 238-240）。姊妹文件 ensure-hooks.test.js /
// ensure-hooks-deep.test.js 已覆盖主流程 / 升级 / purge / legacy / helper，本文件
// 只补两条 catch 分支 —— 通过制造 mkdirSync / writeFileSync 真实抛错来驱动。
//
// 隔离：私有 mkdtemp 做 CLAUDE_CONFIG_DIR；getClaudeConfigDir() 是调用期读 env，
// 故可在每个用例前改 CLAUDE_CONFIG_DIR，单次 canonical import 即可。
import './_shims/register.mjs';
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, writeFileSync, chmodSync, readFileSync, readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// 必须在 import 目标模块前设好一个合法的初始 CLAUDE_CONFIG_DIR（unset → 86400）
const baseHome = mkdtempSync(join(tmpdir(), 'ccv-branch-ensure-hooks-'));
process.env.CLAUDE_CONFIG_DIR = baseHome;
delete process.env.CCV_HOOK_TIMEOUT_S;

let mod;
const scratch = [];
function freshDir(label) {
  const d = mkdtempSync(join(tmpdir(), `ccv-branch-eh-${label}-`));
  scratch.push(d);
  return d;
}

before(async () => {
  mod = await import('../server/lib/ensure-hooks.js');
});
after(() => {
  process.env.CLAUDE_CONFIG_DIR = baseHome;
  for (const d of scratch) {
    try { chmodSync(d, 0o700); } catch { /* ignore */ }
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  try { rmSync(baseHome, { recursive: true, force: true }); } catch { /* ignore */ }
});
afterEach(() => { process.env.CLAUDE_CONFIG_DIR = baseHome; });

describe('ensure-hooks branch: atomic write 失败 → outer catch（mkdirSync 抛 ENOTDIR）', () => {
  it('claudeDir 的父是一个文件 → mkdirSync 抛错被 outer catch 吞掉，不向上传播', () => {
    const root = freshDir('notdir');
    // 制造一个文件占住 parent 位置；claudeDir = <file>/sub → mkdirSync 必 ENOTDIR
    const filePath = join(root, 'afile');
    writeFileSync(filePath, 'x');
    const claudeDir = join(filePath, 'sub'); // parent 是文件
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    // settings.json 不存在 → settings={} → changed=true → 走到 mkdirSync 抛错
    assert.doesNotThrow(() => mod.ensureHooks(), 'outer catch 必须吞掉 mkdirSync 抛的 ENOTDIR，不能向上抛');
    // 没有任何 settings.json 被写出（mkdir 就失败了）
    assert.equal(existsSync(join(claudeDir, 'settings.json')), false);
  });
});

describe('ensure-hooks branch: tmp 写入失败 → inner catch rethrow → outer catch（只读目录 EACCES）', () => {
  it('claudeDir 只读 + 已有可读 settings.json → writeFileSync(tmp) 抛 EACCES → inner catch 不 unlink 直接 rethrow → outer catch 吞掉', () => {
    const claudeDir = freshDir('readonly');
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    // 预置一个合法可读 settings.json：让 line124 readFileSync 成功（settings 非空），
    // 但故意缺三处 hook → changed=true → 进入 atomic write。
    const settingsPath = resolve(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [], Stop: [] } }));
    const before = readFileSync(settingsPath, 'utf-8');
    // 目录置只读（r-x）：读 settings.json 仍可，但写 tmp 文件 EACCES。
    chmodSync(claudeDir, 0o500);
    let threw = false;
    try {
      assert.doesNotThrow(() => mod.ensureHooks(), 'inner catch rethrow 后须被 outer catch 吞掉');
    } finally {
      // 还原权限以便清理与断言
      try { chmodSync(claudeDir, 0o700); } catch { /* ignore */ threw = true; }
    }
    // 原 settings.json 未被破坏（atomic：tmp 写失败 → 原文件不动）
    assert.equal(readFileSync(settingsPath, 'utf-8'), before, '写失败时原 settings.json 必须保持原样');
    // 不应残留任何 .tmp 文件（tmp 写就失败了，故根本没创建；existsSync(tmpPath) 分支取 false 侧）
    const leftovers = readdirSync(claudeDir).filter(f => f.includes('.tmp.'));
    assert.equal(leftovers.length, 0, '不应残留 .tmp 文件');
    assert.equal(threw, false);
  });
});

describe('ensure-hooks branch: 只读目录但 settings.json 缺失（settings={}）→ 同样 inner→outer catch', () => {
  it('只读 claudeDir 且无 settings.json → mkdirSync 既存目录 no-op → writeFileSync(tmp) EACCES → 被吞', () => {
    const claudeDir = freshDir('readonly-empty');
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    chmodSync(claudeDir, 0o500);
    try {
      assert.doesNotThrow(() => mod.ensureHooks(), 'mkdir no-op 后 tmp 写失败须被 outer catch 吞掉');
    } finally {
      try { chmodSync(claudeDir, 0o700); } catch { /* ignore */ }
    }
    assert.equal(existsSync(resolve(claudeDir, 'settings.json')), false, 'tmp 写失败 → settings.json 未生成');
  });
});

// ── 父进程内可达的纯函数 / 主流程分支补强（在 import 期 env=86400 下） ──
describe('ensure-hooks branch: _hookObjEqual 的 `Number(existing.timeout)||0` 左 falsy 臂', () => {
  it('existing 无 timeout（Number(undefined)→NaN→||0=0）vs desired timeout=86400 → 不等', () => {
    // 命中 line47 `Number(existing.timeout) || 0` 的 || 右臂（左侧 NaN falsy）。
    const existing = { type: 'command', command: 'x' }; // 无 timeout
    assert.equal(mod._hookObjEqual(existing, mod._buildHookObj('x')), false);
  });
});

describe('ensure-hooks branch: removeAllManagedHooks 非数组 section / 非数组 entry.hooks 的 continue', () => {
  it('section 非数组（PreToolUse 是字符串）→ continue；Stop 是 null → continue → 返回 0', () => {
    assert.equal(mod.removeAllManagedHooks({ hooks: { PreToolUse: 'oops', Stop: null } }), 0);
  });
  it('entry.hooks 非数组 → 内层 continue（不崩，不计 removed）', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: 'X', hooks: 'not-an-array' }, // entry.hooks 非数组 → continue
          { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: 'node "/ok.js" # cc-viewer-managed' }] },
        ],
        Stop: [],
      },
    };
    const removed = mod.removeAllManagedHooks(settings);
    assert.equal(removed, 1, '仅带 marker 的一条被清，非数组 entry 跳过不崩');
    assert.equal(settings.hooks.PreToolUse.length, 1);
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'X', '非数组 hooks 的 entry 原样保留');
  });
});

describe('ensure-hooks branch: ensureHooks 驱动 _purgeStaleManagedHooks 的 continue 臂 + `command || \'\'`', () => {
  it('PreToolUse 中存在 entry.hooks 非数组 + entry.hooks[0] 无 command（命中 _purge 内层 continue 与 legacy 循环 `||\'\'`）', () => {
    const claudeDir = freshDir('purge-arms');
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    const settingsPath = resolve(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          // entry.hooks 非数组 → _purge 内层 `if(!Array.isArray(hooks)) continue`（L87）
          { matcher: 'Foo', hooks: { not: 'array' } },
          // entry 的 hooks[0] 无 command → legacy 循环 `h.hooks?.[0]?.command || ''`（L165）取 '' 右臂
          { matcher: 'Bar', hooks: [{ type: 'command' }] },
        ],
        // Stop section 缺失 → _purge 顶层 `if(!Array.isArray(arr)) continue`（L83）走 Stop 这一轮
        // （主流程稍后会补建 Stop 数组）
      },
    }));
    assert.doesNotThrow(() => mod.ensureHooks());
    const s = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    // 第三方非 cc-viewer 条目都应保留
    assert.ok(s.hooks.PreToolUse.find(h => h.matcher === 'Foo'), 'Foo entry 保留');
    assert.ok(s.hooks.PreToolUse.find(h => h.matcher === 'Bar'), 'Bar entry 保留');
    // cc-viewer 自己的三处仍被注入
    assert.ok(s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion'));
    assert.ok(s.hooks.PreToolUse.find(h => h.matcher === ''));
    assert.ok(Array.isArray(s.hooks.Stop));
  });

  it('Stop entry 的 hooks[0] 无 command → turnEnd find 的 `cmd || \'\'`（L202）取 \'\' 右臂', () => {
    const claudeDir = freshDir('stop-nocmd');
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    const settingsPath = resolve(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [],
        Stop: [{ hooks: [{ type: 'command' }] }], // 无 command → cmd='' → includes 失败 → 不匹配
      },
    }));
    assert.doesNotThrow(() => mod.ensureHooks());
    const s = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    // 用户的无 command Stop entry 保留 + cc-viewer turn-end 追加
    assert.equal(s.hooks.Stop.length, 2, '保留用户 entry + 追加 turn-end');
    assert.ok(s.hooks.Stop.find(h => h.hooks?.[0]?.command?.includes('turn-end-bridge.js')));
  });
});

describe('ensure-hooks branch: 带 marker 但无 `node "..."` 的 command → _extractNodeTargetPath 返回 null 链路', () => {
  it('AskUserQuestion entry 的 command 含 marker 但无 node 路径 → _looksStaleManagedCommand `!target` (L75) + `m?:null` (L63) → 保守不当作 stale，不被 purge', () => {
    const claudeDir = freshDir('marker-nonode');
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    const settingsPath = resolve(claudeDir, 'settings.json');
    // command 含 marker 触发 L73 后半的 includes(marker)=true → 调 _extractNodeTargetPath；
    // 但无 `node "..."` 子串 → m 为 null → L63 取 `:null` → L75 `!target` → return false（不 stale）。
    // 用一个不会被 legacy cleanup 删的 matcher（非 ''、不含 perm-bridge/grep）。
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'CustomTool', hooks: [{ type: 'command', command: 'echo hi # cc-viewer-managed' }] },
        ],
        Stop: [],
      },
    }));
    assert.doesNotThrow(() => mod.ensureHooks());
    const s = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const kept = s.hooks.PreToolUse.find(h => h.matcher === 'CustomTool');
    assert.ok(kept, '无 node 路径的 marker 条目格式不匹配 → 保守不当 stale，必须保留');
    assert.equal(kept.hooks[0].command, 'echo hi # cc-viewer-managed', 'command 不被改写');
  });
});

describe('ensure-hooks branch: 既有 AskUserQuestion entry 的 hooks 为空数组 → _mergeHookObj `existing || {}` (L53) 左 falsy', () => {
  it('askExisting.hooks=[] → hooks?.[0]=undefined → _hookObjEqual(undefined,...)=false → _mergeHookObj(undefined, desired) 命中 `|| {}` 臂', () => {
    const claudeDir = freshDir('empty-hooks');
    process.env.CLAUDE_CONFIG_DIR = claudeDir;
    const settingsPath = resolve(claudeDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'AskUserQuestion', hooks: [] }, // 空数组 → [0]=undefined → existing falsy
        ],
        Stop: [],
      },
    }));
    assert.doesNotThrow(() => mod.ensureHooks());
    const s = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const ask = s.hooks.PreToolUse.find(h => h.matcher === 'AskUserQuestion');
    assert.ok(ask, 'AskUserQuestion entry 仍在');
    // merge 后 hooks[0] 被填成完整 desired（含 command + timeout）
    assert.equal(ask.hooks.length, 1, '空 hooks 被替换为单条 desired');
    assert.match(ask.hooks[0].command, /ask-bridge\.js/);
    assert.equal(ask.hooks[0].timeout, 86400, '默认 env 下 timeout=86400');
    assert.equal(ask.hooks[0].type, 'command');
  });
});
