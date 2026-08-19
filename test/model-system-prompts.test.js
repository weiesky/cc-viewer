import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MODEL_PROMPT_DIR,
  normalizeModelName,
  modelPromptFileName,
  parseModelPromptFileName,
  listModelPrompts,
  readModelPrompt,
  writeModelPrompt,
  deleteModelPrompt,
  matchModelPrompt,
} from '../packages/app/server/lib/model-system-prompts.js';

describe('model-system-prompts: 名称/文件名语法', () => {
  it('normalize: 合法名转大写', () => {
    assert.equal(normalizeModelName('Gemini3'), 'GEMINI3');
    assert.equal(normalizeModelName('opus'), 'OPUS');
    assert.equal(normalizeModelName('gpt-4.1'), 'GPT-4.1');
    assert.equal(normalizeModelName('a_b-c.d'), 'A_B-C.D');
  });

  it('normalize: 非法名 → null(空/首字符非字母数字/路径穿越/超长/_APPEND 结尾/保留名)', () => {
    assert.equal(normalizeModelName(''), null);
    assert.equal(normalizeModelName(null), null);
    assert.equal(normalizeModelName('.hidden'), null);
    assert.equal(normalizeModelName('_x'), null);
    assert.equal(normalizeModelName('a/b'), null);
    assert.equal(normalizeModelName('a\\b'), null);
    assert.equal(normalizeModelName('..'), null);
    assert.equal(normalizeModelName('a'.repeat(65)), null);
    assert.equal(normalizeModelName('X_APPEND'), null);
    assert.equal(normalizeModelName('x_append'), null);
    assert.equal(normalizeModelName('default'), null);
    assert.equal(normalizeModelName('Default'), null);
  });

  it('fileName: 模式编码进后缀', () => {
    assert.equal(modelPromptFileName('Gemini3', 'override'), 'GEMINI3_SYSTEM.md');
    assert.equal(modelPromptFileName('Gemini3', 'append'), 'GEMINI3_APPEND_SYSTEM.md');
    assert.equal(modelPromptFileName('Gemini3', 'whatever'), 'GEMINI3_APPEND_SYSTEM.md');
    assert.throws(() => modelPromptFileName('a/b', 'override'), /invalid/);
  });

  it('parse: 最长后缀优先 round-trip', () => {
    assert.deepEqual(parseModelPromptFileName('GEMINI3_SYSTEM.md'), { name: 'GEMINI3', mode: 'override' });
    assert.deepEqual(parseModelPromptFileName('GEMINI3_APPEND_SYSTEM.md'), { name: 'GEMINI3', mode: 'append' });
    // X_SYSTEM 作为名字:X_SYSTEM_SYSTEM.md 无歧义地解析回来
    assert.deepEqual(parseModelPromptFileName('X_SYSTEM_SYSTEM.md'), { name: 'X_SYSTEM', mode: 'override' });
  });

  it('parse: 空 stem/异类文件/非法 stem → null', () => {
    assert.equal(parseModelPromptFileName('_SYSTEM.md'), null);
    assert.equal(parseModelPromptFileName('_APPEND_SYSTEM.md'), null);
    assert.equal(parseModelPromptFileName('README.md'), null);
    assert.equal(parseModelPromptFileName('notes.txt'), null);
    assert.equal(parseModelPromptFileName('.hidden_SYSTEM.md'), null);
    assert.equal(parseModelPromptFileName(null), null);
  });
});

describe('model-system-prompts: 读写/列表/匹配', () => {
  let dirs = [];
  function mkTmp() {
    const d = mkdtempSync(join(tmpdir(), 'ccv-modelprompt-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => {
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
    dirs = [];
  });

  it('write: 自动建目录、名字大写化落盘', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    const r = writeModelPrompt(dir, 'Gemini3', 'override', 'hello');
    assert.deepEqual(r, { name: 'GEMINI3', mode: 'override', written: true, cleared: false });
    assert.equal(readFileSync(join(dir, 'GEMINI3_SYSTEM.md'), 'utf-8'), 'hello');
  });

  it('write: 切换模式 → 旧模式文件被删', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'opus', 'override', 'a');
    writeModelPrompt(dir, 'opus', 'append', 'b');
    assert.equal(existsSync(join(dir, 'OPUS_SYSTEM.md')), false);
    assert.equal(readFileSync(join(dir, 'OPUS_APPEND_SYSTEM.md'), 'utf-8'), 'b');
  });

  it('write: 空文本 → 删全部变体(cleared)', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'OPUS_SYSTEM.md'), 'a');
    writeFileSync(join(dir, 'OPUS_APPEND_SYSTEM.md'), 'b');
    const r = writeModelPrompt(dir, 'opus', 'override', '  \n ');
    assert.equal(r.cleared, true);
    assert.equal(existsSync(join(dir, 'OPUS_SYSTEM.md')), false);
    assert.equal(existsSync(join(dir, 'OPUS_APPEND_SYSTEM.md')), false);
  });

  it('write: 非法名 → throw；无 dir → throw', () => {
    assert.throws(() => writeModelPrompt(join(mkTmp(), 'x'), 'a/b', 'override', 't'), /invalid/);
    assert.throws(() => writeModelPrompt('', 'opus', 'override', 't'), /no target/);
  });

  it('delete: 删两种模式与大小写变体', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Opus_SYSTEM.md'), 'a');       // 手工制造的大小写变体
    writeFileSync(join(dir, 'OPUS_APPEND_SYSTEM.md'), 'b');
    const r = deleteModelPrompt(dir, 'opus');
    assert.equal(r.deleted, true);
    assert.equal(existsSync(join(dir, 'Opus_SYSTEM.md')), false);
    assert.equal(existsSync(join(dir, 'OPUS_APPEND_SYSTEM.md')), false);
    assert.deepEqual(deleteModelPrompt(dir, 'opus'), { deleted: false });
  });

  it('list: 跳过空文件/异类文件；目录缺失 → []', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'OPUS_SYSTEM.md'), 'a');
    writeFileSync(join(dir, 'EMPTY_SYSTEM.md'), '');
    writeFileSync(join(dir, 'README.md'), 'readme');
    const r = listModelPrompts(dir);
    assert.deepEqual(r.map((e) => e.name), ['OPUS']);
    assert.deepEqual(listModelPrompts(join(mkTmp(), 'nope')), []);
    assert.deepEqual(listModelPrompts(''), []);
  });

  it('list: 同名两模式并存 → override 压过 append', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'OPUS_SYSTEM.md'), 'a');
    writeFileSync(join(dir, 'OPUS_APPEND_SYSTEM.md'), 'b');
    const r = listModelPrompts(dir);
    assert.equal(r.length, 1);
    assert.equal(r[0].mode, 'override');
  });

  it('read: 返回生效文件内容；不存在 → null', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'Gemini3', 'append', 'text');
    assert.deepEqual(readModelPrompt(dir, 'gemini3'), { name: 'GEMINI3', mode: 'append', text: 'text' });
    assert.equal(readModelPrompt(dir, 'opus'), null);
    assert.equal(readModelPrompt(dir, 'a/b'), null);
  });

  it('match: 大小写不敏感子串命中(名字大写、id 小写混合)', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'opus', 'override', 'x');
    const r = matchModelPrompt('claude-OPUS-4-8[1m]', [{ dir, scope: 'workspace' }]);
    assert.equal(r.name, 'OPUS');
    assert.equal(r.scope, 'workspace');
    assert.equal(r.path, join(dir, 'OPUS_SYSTEM.md'));
  });

  it('match: 同 scope 最长名字胜出', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'opus', 'override', 'short');
    writeModelPrompt(dir, 'opus-4', 'append', 'long');
    const r = matchModelPrompt('claude-opus-4-8', [{ dir, scope: 'global' }]);
    assert.equal(r.name, 'OPUS-4');
    assert.equal(r.mode, 'append');
  });

  it('match: 工作区短路全局(全局名字更长也不看)', () => {
    const wsDir = join(mkTmp(), MODEL_PROMPT_DIR);
    const gDir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(wsDir, 'opus', 'override', 'ws');
    writeModelPrompt(gDir, 'opus-4-8', 'override', 'g');
    const r = matchModelPrompt('claude-opus-4-8', [
      { dir: wsDir, scope: 'workspace' },
      { dir: gDir, scope: 'global' },
    ]);
    assert.equal(r.scope, 'workspace');
    assert.equal(r.name, 'OPUS');
  });

  it('match: 工作区无命中 → 落到全局', () => {
    const wsDir = join(mkTmp(), MODEL_PROMPT_DIR);
    const gDir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(gDir, 'gemini3', 'append', 'g');
    const r = matchModelPrompt('Gemini3-pro', [
      { dir: wsDir, scope: 'workspace' },
      { dir: gDir, scope: 'global' },
    ]);
    assert.equal(r.scope, 'global');
    assert.equal(r.name, 'GEMINI3');
  });

  it('match: modelId 空/无候选 → null', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'opus', 'override', 'x');
    assert.equal(matchModelPrompt(null, [{ dir, scope: 'global' }]), null);
    assert.equal(matchModelPrompt('', [{ dir, scope: 'global' }]), null);
    assert.equal(matchModelPrompt('claude-opus-4-8', null), null);
    assert.equal(matchModelPrompt('claude-sonnet-5', [{ dir, scope: 'global' }]), null);
    // 候选缺 dir / 为 null → 安全跳过
    assert.equal(matchModelPrompt('claude-opus-4-8', [{ scope: 'global' }]), null);
    assert.equal(matchModelPrompt('claude-opus-4-8', [null, { dir, scope: 'global' }])?.name, 'OPUS');
  });

  it('match: 裸 k3 经别名展开命中 KIMI 与 KIMI-K3（最长名字优先）', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'kimi', 'override', 'kimi');
    writeModelPrompt(dir, 'kimi-k3', 'override', 'kimi-k3');
    const r = matchModelPrompt('k3', [{ dir, scope: 'global' }]);
    // 两个条目都能命中（kimi-k3 ⊃ kimi 都被裸 k3 的别名展开覆盖），最长名字胜出
    assert.equal(r.name, 'KIMI-K3');
    assert.equal(r.mode, 'override');
  });

  it('match: 裸 k3 只命中 kimi 家族，不误中 opus / sonnet', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'opus', 'override', 'x');
    writeModelPrompt(dir, 'sonnet', 'override', 'y');
    assert.equal(matchModelPrompt('k3', [{ dir, scope: 'global' }]), null);
  });

  it('match: 完整拼写 kimi-k3 行为不变（别名不破坏正向匹配）', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'kimi', 'override', 'x');
    const r = matchModelPrompt('kimi-k3', [{ dir, scope: 'global' }]);
    assert.equal(r.name, 'KIMI');
  });
});
