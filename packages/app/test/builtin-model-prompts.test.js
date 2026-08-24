import { describe, it, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 物化目录隔离：node --test 多进程并行共享默认 tmp 目录会被彼此的 GC 竞态误删
// （本文件的 hello/v2 hash 与 system-prompt-files/launch-config 的真实 preset hash 互删）。
// materializeDir 惰性读取 env，import 顺序无碍。
process.env.CCV_BUILTIN_PROMPT_MATERIALIZE_DIR = mkdtempSync(join(tmpdir(), 'ccv-builtin-mat-'));

const {
  BUILTIN_DISABLED_FILE,
  listBuiltinModelPrompts,
  matchBuiltinModelPrompt,
  readBuiltinDisabled,
  setBuiltinDisabled,
  isBuiltinDisabled,
  materializeBuiltinPrompt,
} = await import('../server/lib/builtin-model-prompts.js');

// 与 system-prompt-templates/presets/index.json 一一对应（system-prompt-presets.test.js
// 已钉 EXPECTED_IDS；这里只钉 name 派生，避免双重维护两份清单）。
const EXPECTED_NAMES = ['DEEPSEEK-V4-PRO', 'DEEPSEEK-V4-FLASH', 'GLM-5.2', 'QWEN-3.7-MAX', 'KIMI-K2.7-CODE', 'KIMI-K3'];

describe('builtin-model-prompts: 条目列表', () => {
  it('6 个内置条目，name 为 match 大写规范化，mode 全 override', () => {
    const list = listBuiltinModelPrompts();
    assert.deepEqual(list.map((e) => e.name).sort(), EXPECTED_NAMES.slice().sort());
    for (const e of list) {
      assert.equal(e.mode, 'override');
      assert.ok(e.id && e.title && e.matchLower && e.text.length > 0);
    }
  });

  it('text 已剥离边界标记、${...} 变量保持字面量', () => {
    for (const e of listBuiltinModelPrompts()) {
      assert.ok(!e.text.includes('__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__'), `${e.id} 不应含边界标记`);
      assert.ok(e.text.includes('${'), `${e.id} 应保留模板变量`);
    }
  });
});

describe('builtin-model-prompts: 模型匹配', () => {
  it('裸 k3 经别名展开命中 KIMI-K3；大写 K3 同样命中（lowercase 契约）', () => {
    assert.equal(matchBuiltinModelPrompt('k3')?.name, 'KIMI-K3');
    assert.equal(matchBuiltinModelPrompt('K3')?.name, 'KIMI-K3');
    assert.equal(matchBuiltinModelPrompt('k3[1m]')?.name, 'KIMI-K3'); // 变体 'kimi-k3' 命中
  });

  it('厂商全名/带后缀均命中对应条目', () => {
    assert.equal(matchBuiltinModelPrompt('kimi-k3')?.name, 'KIMI-K3');
    assert.equal(matchBuiltinModelPrompt('deepseek-v4-pro-0901')?.name, 'DEEPSEEK-V4-PRO');
    assert.equal(matchBuiltinModelPrompt('glm-5.2-air')?.name, 'GLM-5.2');
    assert.equal(matchBuiltinModelPrompt('Qwen-3.7-Max')?.name, 'QWEN-3.7-MAX');
    assert.equal(matchBuiltinModelPrompt('kimi-k2.7-code-latest')?.name, 'KIMI-K2.7-CODE');
  });

  it('无匹配 → null；空入参 → null', () => {
    assert.equal(matchBuiltinModelPrompt('gpt-5'), null);
    assert.equal(matchBuiltinModelPrompt('claude-opus-4-8[1m]'), null);
    assert.equal(matchBuiltinModelPrompt('deepseek'), null); // 不含完整 match 子串
    assert.equal(matchBuiltinModelPrompt(null), null);
    assert.equal(matchBuiltinModelPrompt(''), null);
    assert.equal(matchBuiltinModelPrompt(42), null);
  });

  it('命中结果携带 id/name/mode/text', () => {
    const hit = matchBuiltinModelPrompt('kimi-k3');
    assert.equal(hit.id, 'kimi-k3');
    assert.equal(hit.mode, 'override');
    assert.ok(hit.text.length > 0);
  });
});

describe('builtin-model-prompts: 墓碑', () => {
  const dirs = [];
  const mk = () => { const d = mkdtempSync(join(tmpdir(), 'ccv-builtin-tomb-')); dirs.push(d); return d; };
  afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

  it('缺失/损坏 → []（宽容读取）', () => {
    const dir = mk();
    assert.deepEqual(readBuiltinDisabled(join(dir, 'nonexistent')), []);
    assert.deepEqual(readBuiltinDisabled(null), []);
    writeFileSync(join(dir, BUILTIN_DISABLED_FILE), '{broken json', 'utf-8');
    assert.deepEqual(readBuiltinDisabled(dir), []);
    writeFileSync(join(dir, BUILTIN_DISABLED_FILE), '{"not":"array"}', 'utf-8');
    assert.deepEqual(readBuiltinDisabled(dir), []);
    writeFileSync(join(dir, BUILTIN_DISABLED_FILE), '["KIMI-K3", 42, "bad name", "KIMI-K3"]', 'utf-8');
    assert.deepEqual(readBuiltinDisabled(dir), ['KIMI-K3']); // 过滤非法、去重
  });

  it('set 写入/移除往返，原子落盘、去重排序', () => {
    const dir = mk();
    let r = setBuiltinDisabled(dir, 'kimi-k3', true);
    assert.equal(r.name, 'KIMI-K3');
    assert.deepEqual(r.list, ['KIMI-K3']);
    r = setBuiltinDisabled(dir, 'GLM-5.2', true);
    assert.deepEqual(r.list, ['GLM-5.2', 'KIMI-K3']);
    // 幂等
    r = setBuiltinDisabled(dir, 'KIMI-K3', true);
    assert.deepEqual(r.list, ['GLM-5.2', 'KIMI-K3']);
    r = setBuiltinDisabled(dir, 'KIMI-K3', false);
    assert.deepEqual(r.list, ['GLM-5.2']);
    assert.deepEqual(readBuiltinDisabled(dir), ['GLM-5.2']);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, BUILTIN_DISABLED_FILE), 'utf-8')), ['GLM-5.2']);
  });

  it('isBuiltinDisabled 多 scope 合成：任一目录含名即禁用', () => {
    const ws = mk();
    const g = mk();
    setBuiltinDisabled(g, 'KIMI-K3', true);
    assert.equal(isBuiltinDisabled('KIMI-K3', ws, g), true);
    assert.equal(isBuiltinDisabled('GLM-5.2', ws, g), false);
    setBuiltinDisabled(ws, 'GLM-5.2', true);
    assert.equal(isBuiltinDisabled('GLM-5.2', ws, g), true);
    assert.equal(isBuiltinDisabled('KIMI-K3', ws, null), false); // 只看 workspace 时不受 global 影响
  });

  it('set 对非法名 throw；dir 缺失时自动 mkdir', () => {
    const dir = mk();
    assert.throws(() => setBuiltinDisabled(dir, 'bad name', true));
    assert.throws(() => setBuiltinDisabled(null, 'KIMI-K3', true));
    const nested = join(dir, 'a', 'b');
    setBuiltinDisabled(nested, 'KIMI-K3', true);
    assert.ok(existsSync(join(nested, BUILTIN_DISABLED_FILE)));
  });
});

describe('builtin-model-prompts: 物化', () => {
  it('内容寻址文件名、原子写、GC 只清老化的旧 hash 文件', () => {
    const text = 'hello ${os.platform}\n';
    const p1 = materializeBuiltinPrompt('kimi-k3', text);
    assert.ok(p1.includes('kimi-k3-'));
    assert.ok(p1.endsWith('.md'));
    assert.equal(readFileSync(p1, 'utf-8'), text);
    // 同内容 → 同路径（内容寻址，write-if-absent）
    const p2 = materializeBuiltinPrompt('kimi-k3', text);
    assert.equal(p1, p2);
    // 不同内容 → 不同 hash 路径；刚创建的旧 hash 文件因龄期守卫暂不被 GC
    const p3 = materializeBuiltinPrompt('kimi-k3', `${text}v2`);
    assert.notEqual(p3, p1);
    assert.ok(existsSync(p1), '新旧的旧 hash 文件在龄期内应保留');
    // 老化后（mtime 拨回 11 分钟前）再物化一次 → 旧文件被 GC
    const old = Date.now() - 11 * 60_000;
    utimesSync(p1, old / 1000, old / 1000);
    materializeBuiltinPrompt('kimi-k3', `${text}v2`);
    assert.ok(!existsSync(p1), '老化的旧 hash 文件应被清理');
    assert.ok(existsSync(p3));
  });

  it('非法入参 throw', () => {
    assert.throws(() => materializeBuiltinPrompt('bad id', 'x'));
    assert.throws(() => materializeBuiltinPrompt('kimi-k3', ''));
    assert.throws(() => materializeBuiltinPrompt('kimi-k3', null));
  });
});
