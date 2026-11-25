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
  modelIdTokens,
  modelIdSegments,
  matchSegments,
} from '../server/lib/model-system-prompts.js';

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

  it('match: k3 系列别称经别名展开命中 KIMI-K3，lookalike 不误命中', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'kimi', 'override', 'kimi');
    writeModelPrompt(dir, 'kimi-k3', 'override', 'kimi-k3');
    for (const modelId of ['k3', 'K3', 'k3[1m]', 'k3.1-pro', 'k3.1-pro-highspeed', 'K3.1-PRO-HIGHSPEED', 'k3-pro', 'k3.1-pro[1m]']) {
      const r = matchModelPrompt(modelId, [{ dir, scope: 'global' }]);
      assert.equal(r?.name, 'KIMI-K3', modelId);
      assert.equal(r?.mode, 'override', modelId);
    }
    assert.equal(matchModelPrompt('k30', [{ dir, scope: 'global' }]), null);
    assert.equal(matchModelPrompt('k3pro', [{ dir, scope: 'global' }]), null);
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

  it('match: 带厂商前缀与版本跳变仍命中家族条目（段匹配，版本不否决）', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'deepseek-v4-flash', 'override', 'x');
    // 厂商前缀 + 版本跳变（V4 → V4.1）：旧纯子串在此落空，段匹配命中家族。
    const r = matchModelPrompt('vendor/DeepSeek-V4.1-Flash-1017', [{ dir, scope: 'global' }]);
    assert.equal(r?.name, 'DEEPSEEK-V4-FLASH');
  });

  it('match: 版本对不上仍落回家族（不否决、不掉兜底）', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'glm-5.2', 'override', 'a');
    writeModelPrompt(dir, 'glm-5.3', 'override', 'b');
    // GLM-5.4 家族里没有精确条目：落到同主线的最新成员 GLM-5.3，而非更旧的 5.2 或兜底。
    const r = matchModelPrompt('antchat/GLM-5.4', [{ dir, scope: 'global' }]);
    assert.equal(r?.name, 'GLM-5.3');
  });

  it('match: 段匹配全 miss 时回退旧子串（保住官方用户非规范命名）', () => {
    const dir = join(mkTmp(), MODEL_PROMPT_DIR);
    writeModelPrompt(dir, 'opu', 'override', 'x'); // 部分 ident 子串，段匹配无法命中
    const r = matchModelPrompt('claude-opus-4-8[1m]', [{ dir, scope: 'global' }]);
    assert.equal(r?.name, 'OPU');
  });
});

describe('model-system-prompts: 分词/段匹配纯函数', () => {
  it('tokens: 版本拆分量、字母串保留、其余字符为分隔', () => {
    assert.deepEqual(modelIdTokens('vendor/DeepSeek-V4.1-Flash-1017'), ['vendor', 'deepseek', 'v', '4', '1', 'flash', '1017']);
    assert.deepEqual(modelIdTokens('glink/Qwen3.8-2.4T-A95B:glink_domestic'), ['glink', 'qwen', '3', '8', '2', '4', 't', 'a', '95', 'b', 'glink', 'domestic']);
    assert.deepEqual(modelIdTokens('claude-opus-4-8[1m]'), ['claude', 'opus', '4', '8']); // [1m] 后缀被剥
    assert.deepEqual(modelIdTokens(''), []);
    assert.deepEqual(modelIdTokens(null), []);
  });

  it('segments: ident 与其后连续数字合并为一段', () => {
    assert.deepEqual(modelIdSegments(modelIdTokens('deepseek-v4-flash')), [
      { ident: 'deepseek', nums: [] },
      { ident: 'v', nums: ['4'] },
      { ident: 'flash', nums: [] },
    ]);
    assert.deepEqual(modelIdSegments(modelIdTokens('glm-5.3')), [{ ident: 'glm', nums: ['5', '3'] }]);
    // 前导纯数字自成一段（ident:null）
    assert.deepEqual(modelIdSegments(['4', '8'])[0], { ident: null, nums: ['4'] });
  });

  it('matchSegments: ident 锁家族、版本不否决，返回贴近度得分', () => {
    const seg = (s) => modelIdSegments(modelIdTokens(s));
    // 命中 + 前缀（id 版本更长）
    assert.equal(matchSegments(seg('deepseek-v4-flash'), seg('vendor/DeepSeek-V4.1-Flash-1017'))?.matched, true);
    // ident 链断裂 → miss（flash ≠ pro）
    assert.equal(matchSegments(seg('deepseek-v4-flash'), seg('vendor/DeepSeek-V4.1-Pro')), null);
    // 首段无 ident（纯数字 entry）→ miss
    assert.equal(matchSegments(seg('4-8'), seg('claude-opus-4-8')), null);
    // 版本演进：同主线新成员(GLM-5.3)贴近度高于旧成员(GLM-5.2)
    const id = seg('antchat/GLM-5.4');
    const s52 = matchSegments(seg('glm-5.2'), id).score;
    const s53 = matchSegments(seg('glm-5.3'), id).score;
    assert.ok(s53 > s52, `glm-5.3(${s53}) 应比 glm-5.2(${s52}) 更贴近 GLM-5.4`);
  });

  it('matchSegments: 版本演进贴近度防误伤（相邻版本不跨家族）', () => {
    const seg = (s) => modelIdSegments(modelIdTokens(s));
    // glm-5.3 vs GLM-5.4：同主线（major=5），贴近度为正、可命中排序
    assert.ok(matchSegments(seg('glm-5.3'), seg('antchat/GLM-5.4')) !== null);
    // glm-5.2 vs glm-5.4：同主线但 minor 差距更大，贴近度低于 5.3（不否决，仍命中但排后）
    const far = matchSegments(seg('glm-5.2'), seg('antchat/GLM-5.4')).score;
    const near = matchSegments(seg('glm-5.3'), seg('antchat/GLM-5.4')).score;
    assert.ok(near > far);
  });

  it('matchSegments: 计分契约钉住（精确 4 / 前缀 3 / 同 major 贴近 / 跨 major 高版本 / exact）', () => {
    const seg = (s) => modelIdSegments(modelIdTokens(s));
    // 精确：逐位等长 → 4，exact=true
    const exact = matchSegments(seg('kimi-k3'), seg('kimi-k3'));
    assert.equal(exact.score, 4);
    assert.equal(exact.exact, true);
    // 前缀：entry v{4} 是 id v{4,1} 的前缀 → 3，exact=false
    const prefix = matchSegments(seg('deepseek-v4-flash'), seg('vendor/DeepSeek-V4.1-Flash-1017'));
    assert.equal(prefix.score, 3);
    assert.equal(prefix.exact, false);
    // 同 major：GLM-5.3 vs GLM-5.4 → 1+1/2=1.5；GLM-5.2 vs GLM-5.4 → 1+1/3≈1.333
    assert.equal(matchSegments(seg('glm-5.3'), seg('GLM-5.4')).score, 1.5);
    assert.ok(Math.abs(matchSegments(seg('glm-5.2'), seg('GLM-5.4')).score - 4 / 3) < 1e-9);
    // 跨 major：贴向最高版本（GLM-5.3 的分严格高于 GLM-5.2），且量纲 (0,1) 恒小于同 major
    const crossHigh = matchSegments(seg('glm-5.3'), seg('GLM-6')).score;
    const crossLow = matchSegments(seg('glm-5.2'), seg('GLM-6')).score;
    assert.ok(crossHigh > crossLow, `跨 major 应贴向最高版本：5.3(${crossHigh}) > 5.2(${crossLow})`);
    assert.ok(crossHigh < 1, '跨 major 量纲应 < 1（小于任何同 major 分值）');
    // 同 major 必大于跨 major（major 匹配是强信号）
    assert.ok(matchSegments(seg('glm-5.3'), seg('GLM-5.9')).score > crossHigh);
  });
});
