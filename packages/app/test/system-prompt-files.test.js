import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSystemPromptFileArgs,
  readWorkspaceSystemText,
  writeWorkspaceSystemText,
  SYSTEM_PROMPT_FILE,
  APPEND_SYSTEM_PROMPT_FILE,
  DISABLE_AUTO_SYSTEM_PROMPT_ENV,
} from '../server/lib/system-prompt-files.js';
import { setBuiltinDisabled } from '../server/lib/builtin-model-prompts.js';

// 物化目录隔离（materializeDir 惰性读取 env）：避免与其它并行测试文件的 GC 互删。
process.env.CCV_BUILTIN_PROMPT_MATERIALIZE_DIR = mkdtempSync(join(tmpdir(), 'ccv-spf-mat-'));

describe('system-prompt-files: buildSystemPromptFileArgs', () => {
  let dirs = [];
  function mkTmp() {
    const d = mkdtempSync(join(tmpdir(), 'ccv-sysprompt-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs = [];
  });

  it('两者皆无 → 空', () => {
    const dir = mkTmp();
    assert.deepEqual(buildSystemPromptFileArgs(dir, [], {}), { args: [], loaded: [], model: null });
  });

  it('仅 CC_SYSTEM.md → --system-prompt-file (绝对路径)', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    const r = buildSystemPromptFileArgs(dir, [], {});
    assert.deepEqual(r.loaded, [SYSTEM_PROMPT_FILE]);
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
  });

  it('仅 CC_APPEND_SYSTEM.md → --append-system-prompt-file', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'app');
    const r = buildSystemPromptFileArgs(dir, [], {});
    assert.deepEqual(r.loaded, [APPEND_SYSTEM_PROMPT_FILE]);
    assert.deepEqual(r.args, ['--append-system-prompt-file', join(dir, APPEND_SYSTEM_PROMPT_FILE)]);
  });

  it('两者皆有 → replace 在前、append 在后', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'app');
    const r = buildSystemPromptFileArgs(dir, [], {});
    assert.deepEqual(r.loaded, [SYSTEM_PROMPT_FILE, APPEND_SYSTEM_PROMPT_FILE]);
    assert.deepEqual(r.args, [
      '--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE),
      '--append-system-prompt-file', join(dir, APPEND_SYSTEM_PROMPT_FILE),
    ]);
  });

  it('空 CC_SYSTEM.md 跳过', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), '');
    assert.deepEqual(buildSystemPromptFileArgs(dir, [], {}), { args: [], loaded: [], model: null });
  });

  it('空 CC_APPEND_SYSTEM.md 跳过', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), '');
    assert.deepEqual(buildSystemPromptFileArgs(dir, [], {}), { args: [], loaded: [], model: null });
  });

  it('手动 --system-prompt → 跳过 replace 但保留 append', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'app');
    const r = buildSystemPromptFileArgs(dir, ['--system-prompt', 'x'], {});
    assert.deepEqual(r.loaded, [APPEND_SYSTEM_PROMPT_FILE]);
    assert.deepEqual(r.args, ['--append-system-prompt-file', join(dir, APPEND_SYSTEM_PROMPT_FILE)]);
  });

  it('手动 --system-prompt-file → 跳过 replace', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    const r = buildSystemPromptFileArgs(dir, ['--system-prompt-file', '/x'], {});
    assert.deepEqual(r, { args: [], loaded: [], model: null });
  });

  it('手动 --append-system-prompt → 跳过 append 但保留 replace', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'app');
    const r = buildSystemPromptFileArgs(dir, ['--append-system-prompt', 'y'], {});
    assert.deepEqual(r.loaded, [SYSTEM_PROMPT_FILE]);
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
  });

  it('两个手动 flag(= 形态)都传 → 两者皆跳过', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'app');
    const r = buildSystemPromptFileArgs(dir, ['--system-prompt-file=/a', '--append-system-prompt-file=/b'], {});
    assert.deepEqual(r, { args: [], loaded: [], model: null });
  });

  it('CCV_DISABLE_AUTO_SYSTEM_PROMPT=1 全跳过(即使两文件都在)，并携带 suppressed:env', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'app');
    const r = buildSystemPromptFileArgs(dir, [], { [DISABLE_AUTO_SYSTEM_PROMPT_ENV]: '1' });
    assert.deepEqual(r, { args: [], loaded: [], model: null, suppressed: 'env' });
  });

  it('projectDir 为空 → 空', () => {
    assert.deepEqual(buildSystemPromptFileArgs('', [], {}), { args: [], loaded: [], model: null });
    assert.deepEqual(buildSystemPromptFileArgs(undefined, [], {}), { args: [], loaded: [], model: null });
  });

  it('同名为目录(非文件) → 跳过', () => {
    const dir = mkTmp();
    mkdirSync(join(dir, SYSTEM_PROMPT_FILE));
    assert.deepEqual(buildSystemPromptFileArgs(dir, [], {}), { args: [], loaded: [], model: null });
  });

  it('existingArgs 含非字符串项 → 安全忽略(typeof 守卫)，注入照常', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    const r = buildSystemPromptFileArgs(dir, [null, 123, undefined, { a: 1 }], {});
    assert.deepEqual(r.loaded, [SYSTEM_PROMPT_FILE]);
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
  });

  it('路径含空格 → arg 为整段绝对路径', () => {
    const base = mkTmp();
    const dir = join(base, 'a b c');
    mkdirSync(dir);
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    const r = buildSystemPromptFileArgs(dir, [], {});
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
    assert.ok(r.args[1].includes('a b c'));
  });

  // ---- opts.modelId：模型定制条目整体取代默认 sentinel ----
  it('模型命中(override) → 只注入模型文件,默认 sentinel 不参与', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'default-sys');
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'OPUS_SYSTEM.md'), 'opus prompt');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'claude-opus-4-8[1m]' });
    assert.equal(r.model, 'OPUS');
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, 'system_prompt', 'OPUS_SYSTEM.md')]);
    assert.deepEqual(r.loaded, ['system_prompt/OPUS_SYSTEM.md']);
  });

  it('模型命中(append 模式条目) → --append-system-prompt-file', () => {
    const dir = mkTmp();
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'OPUS_APPEND_SYSTEM.md'), 'opus extra');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'claude-opus-4-8' });
    assert.equal(r.model, 'OPUS');
    assert.deepEqual(r.args, ['--append-system-prompt-file', join(dir, 'system_prompt', 'OPUS_APPEND_SYSTEM.md')]);
  });

  it('全局目录命中 → loaded 带 global 前缀', () => {
    const dir = mkTmp();
    const globalDir = join(mkTmp(), 'system_prompt');
    mkdirSync(globalDir);
    writeFileSync(join(globalDir, 'OPUS_SYSTEM.md'), 'g');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'claude-opus-4-8', globalModelDir: globalDir });
    assert.equal(r.model, 'OPUS');
    assert.deepEqual(r.loaded, ['global system_prompt/OPUS_SYSTEM.md']);
  });

  it('工作区条目压过全局条目(即使全局名字更长)', () => {
    const dir = mkTmp();
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'OPUS_SYSTEM.md'), 'ws');
    const globalDir = join(mkTmp(), 'system_prompt');
    mkdirSync(globalDir);
    writeFileSync(join(globalDir, 'OPUS-4_SYSTEM.md'), 'g');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'claude-opus-4-8', globalModelDir: globalDir });
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, 'system_prompt', 'OPUS_SYSTEM.md')]);
  });

  it('模型命中 + 手动同义 flag → 什么都不注入(默认 sentinel 也不回看)，标记 suppressed:manual-flag', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'default-sys');
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'OPUS_SYSTEM.md'), 'opus');
    const r = buildSystemPromptFileArgs(dir, ['--system-prompt', 'x'], {}, { modelId: 'claude-opus-4-8' });
    assert.deepEqual(r, { args: [], loaded: [], model: null, suppressed: 'manual-flag' });
  });

  it('模型未命中 → 回落默认 sentinel 行为，无 suppressed(真·无条目)', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'default-sys');
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'GEMINI3_SYSTEM.md'), 'gem');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'claude-opus-4-8' });
    assert.equal(r.model, null);
    assert.equal(r.suppressed, undefined);
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
  });

  it('kill-switch 压过模型命中，标记 suppressed:env', () => {
    const dir = mkTmp();
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'OPUS_SYSTEM.md'), 'opus');
    const r = buildSystemPromptFileArgs(dir, [], { [DISABLE_AUTO_SYSTEM_PROMPT_ENV]: '1' }, { modelId: 'claude-opus-4-8' });
    assert.deepEqual(r, { args: [], loaded: [], model: null, suppressed: 'env' });
  });

  it('modelId 为 null/缺省 → 完全旧逻辑', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'sys');
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'OPUS_SYSTEM.md'), 'opus');
    const r1 = buildSystemPromptFileArgs(dir, [], {}, { modelId: null });
    const r2 = buildSystemPromptFileArgs(dir, [], {});
    assert.deepEqual(r1.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
    assert.deepEqual(r2.args, r1.args);
  });

  // ---- readWorkspaceSystemText / writeWorkspaceSystemText (偏好「系统文本修改」用) ----
  it('read: 无文件 → 默认 append 空', () => {
    const dir = mkTmp();
    assert.deepEqual(readWorkspaceSystemText(dir), { mode: 'append', text: '' });
  });

  it('read: CC_SYSTEM.md → override + 内容', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'S');
    assert.deepEqual(readWorkspaceSystemText(dir), { mode: 'override', text: 'S' });
  });

  it('read: 仅 CC_APPEND_SYSTEM.md → append + 内容', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'A');
    assert.deepEqual(readWorkspaceSystemText(dir), { mode: 'append', text: 'A' });
  });

  it('read: 两者都在 → 优先 override', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'S');
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'A');
    assert.deepEqual(readWorkspaceSystemText(dir), { mode: 'override', text: 'S' });
  });

  it('read: 空文件视为无 → 默认 append 空', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), '');
    assert.deepEqual(readWorkspaceSystemText(dir), { mode: 'append', text: '' });
  });

  it('read: 无 dir → 默认 append 空', () => {
    assert.deepEqual(readWorkspaceSystemText(''), { mode: 'append', text: '' });
  });

  it('write: override → 写 CC_SYSTEM.md、删 CC_APPEND_SYSTEM.md', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'old-append');
    const r = writeWorkspaceSystemText(dir, 'override', 'hello');
    assert.deepEqual(r, { mode: 'override', written: true, cleared: false });
    assert.equal(readFileSync(join(dir, SYSTEM_PROMPT_FILE), 'utf-8'), 'hello');
    assert.equal(existsSync(join(dir, APPEND_SYSTEM_PROMPT_FILE)), false);
  });

  it('write: append → 写 CC_APPEND_SYSTEM.md、删 CC_SYSTEM.md', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'old-sys');
    const r = writeWorkspaceSystemText(dir, 'append', 'world');
    assert.deepEqual(r, { mode: 'append', written: true, cleared: false });
    assert.equal(readFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'utf-8'), 'world');
    assert.equal(existsSync(join(dir, SYSTEM_PROMPT_FILE)), false);
  });

  it('write: 非 override 模式按默认 append 处理', () => {
    const dir = mkTmp();
    const r = writeWorkspaceSystemText(dir, 'whatever', 'x');
    assert.equal(r.mode, 'append');
    assert.equal(existsSync(join(dir, APPEND_SYSTEM_PROMPT_FILE)), true);
    assert.equal(existsSync(join(dir, SYSTEM_PROMPT_FILE)), false);
  });

  it('write: 空白文本 → 删两份(cleared)', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'a');
    writeFileSync(join(dir, APPEND_SYSTEM_PROMPT_FILE), 'b');
    const r = writeWorkspaceSystemText(dir, 'override', '   \n  ');
    assert.deepEqual(r, { mode: 'override', written: false, cleared: true });
    assert.equal(existsSync(join(dir, SYSTEM_PROMPT_FILE)), false);
    assert.equal(existsSync(join(dir, APPEND_SYSTEM_PROMPT_FILE)), false);
  });

  it('write→read round-trip 保留原文(含换行)', () => {
    const dir = mkTmp();
    const text = 'line1\nline2\n';
    writeWorkspaceSystemText(dir, 'override', text);
    assert.deepEqual(readWorkspaceSystemText(dir), { mode: 'override', text });
  });

  it('write: 无 dir → throw', () => {
    assert.throws(() => writeWorkspaceSystemText('', 'append', 'x'), /no workspace/);
  });
});

describe('system-prompt-files: 内置 preset fallback', () => {
  let dirs = [];
  function mkTmp() {
    const d = mkdtempSync(join(tmpdir(), 'ccv-sysprompt-builtin-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs = [];
  });

  it('无用户文件 → 内置命中取代 sentinel（model/loaded 标签，物化无边界标记）', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'default-sys');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'k3' });
    assert.equal(r.model, 'KIMI-K3');
    assert.deepEqual(r.loaded, ['builtin:KIMI-K3']);
    assert.equal(r.args[0], '--system-prompt-file');
    assert.ok(r.args[1].includes('kimi-k3-') && r.args[1].endsWith('.md'));
    assert.ok(existsSync(r.args[1]));
    assert.ok(!r.args.includes(join(dir, SYSTEM_PROMPT_FILE)), 'sentinel 被内置取代');
    const text = readFileSync(r.args[1], 'utf-8');
    assert.ok(!text.includes('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'), '物化文本不应含边界标记');
    assert.ok(text.includes('${'), '模板变量应保持字面量待渲染管线替换');
  });

  it('工作区用户文件优先于内置（行为零变化）', () => {
    const dir = mkTmp();
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'K3_SYSTEM.md'), 'mine');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'k3' });
    assert.equal(r.model, 'K3');
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, 'system_prompt', 'K3_SYSTEM.md')]);
  });

  it('全局用户文件同样优先于内置', () => {
    const dir = mkTmp();
    const g = mkTmp();
    writeFileSync(join(g, 'KIMI_SYSTEM.md'), 'mine-global');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'k3', globalModelDir: g });
    assert.equal(r.model, 'KIMI');
    assert.deepEqual(r.args, ['--system-prompt-file', join(g, 'KIMI_SYSTEM.md')]);
  });

  it('global 墓碑禁用 → 回落 sentinel 且带 builtinDisabled', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'default-sys');
    const g = mkTmp();
    setBuiltinDisabled(g, 'KIMI-K3', true);
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'k3', globalModelDir: g });
    assert.equal(r.model, null);
    assert.equal(r.builtinDisabled, 'KIMI-K3');
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
  });

  it('workspace 墓碑禁用（无 sentinel 时落空）', () => {
    const dir = mkTmp();
    setBuiltinDisabled(join(dir, 'system_prompt'), 'KIMI-K3', true);
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'k3' });
    assert.equal(r.builtinDisabled, 'KIMI-K3');
    assert.equal(r.model, null);
    assert.deepEqual(r.args, []);
  });

  it('k3[1m] 后缀场景：用户文件仍胜内置（两层同语义，优先级不破口）', () => {
    // env 直传带 [1m] 后缀的裸 k3 时，用户层若不做后缀剥离会静默 miss、内置反客为主——
    // matchModelPrompt 与 matchBuiltinModelPrompt 必须同语义（同经 expandModelIdVariants）。
    const dir = mkTmp();
    mkdirSync(join(dir, 'system_prompt'));
    writeFileSync(join(dir, 'system_prompt', 'KIMI-K3_SYSTEM.md'), 'mine');
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'k3[1m]' });
    assert.equal(r.model, 'KIMI-K3');
    assert.deepEqual(r.args, ['--system-prompt-file', join(dir, 'system_prompt', 'KIMI-K3_SYSTEM.md')]);
  });

  it('内置命中 + 手动同义 flag → suppressed:manual-flag（不注入、不物化）', () => {
    const dir = mkTmp();
    const matDir = process.env.CCV_BUILTIN_PROMPT_MATERIALIZE_DIR;
    const before = new Set(readdirSync(matDir));
    const r = buildSystemPromptFileArgs(dir, ['--system-prompt', 'x'], {}, { modelId: 'k3' });
    assert.deepEqual(r, { args: [], loaded: [], model: null, suppressed: 'manual-flag' });
    const after = readdirSync(matDir);
    assert.deepEqual(after.filter((f) => !before.has(f)), [], '手动抑制不得物化 tmp 文件');
  });

  it('kill-switch 压过内置命中', () => {
    const dir = mkTmp();
    const r = buildSystemPromptFileArgs(dir, [], { [DISABLE_AUTO_SYSTEM_PROMPT_ENV]: '1' }, { modelId: 'k3' });
    assert.deepEqual(r, { args: [], loaded: [], model: null, suppressed: 'env' });
  });

  it('无匹配模型（gpt-5）→ 内置层不介入，无 matched/builtinDisabled 字段', () => {
    const dir = mkTmp();
    const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'gpt-5' });
    assert.deepEqual(r, { args: [], loaded: [], model: null });
  });
});

describe('system-prompt-files: 内置层故障降级', () => {
  let dirs = [];
  function mkTmp() {
    const d = mkdtempSync(join(tmpdir(), 'ccv-sysprompt-fault-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs = [];
  });

  it('物化目录不可创建（指向普通文件）→ 不 throw，回落 sentinel', () => {
    const dir = mkTmp();
    writeFileSync(join(dir, SYSTEM_PROMPT_FILE), 'default-sys');
    const blocker = join(mkTmp(), 'not-a-dir');
    writeFileSync(blocker, 'x');
    const saved = process.env.CCV_BUILTIN_PROMPT_MATERIALIZE_DIR;
    process.env.CCV_BUILTIN_PROMPT_MATERIALIZE_DIR = blocker; // mkdirSync 必抛
    try {
      const r = buildSystemPromptFileArgs(dir, [], {}, { modelId: 'k3' });
      assert.equal(r.model, null);
      assert.equal(r.builtinDisabled, undefined);
      assert.deepEqual(r.args, ['--system-prompt-file', join(dir, SYSTEM_PROMPT_FILE)]);
    } finally {
      process.env.CCV_BUILTIN_PROMPT_MATERIALIZE_DIR = saved;
    }
  });
});
