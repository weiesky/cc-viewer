import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
