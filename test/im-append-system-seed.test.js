import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, mkdtempSync, symlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全 — 禁止改回静态 import(2026-06-06 事故) ████
// LOG_DIR/CACHE_DIR 等在 findcc.js / server/lib 模块【加载时】即从 env 派生。
// ESM 静态 import 会被提升到本文件任何语句之前执行,所以「先设 env 再静态 import」无效。
// 必须:① node 内置模块静态 import;② 隔离段设 env;③ 项目模块用顶层 await 动态 import。
// 改回静态 import findcc/server 会让本文件单跑(无外部 CCV_LOG_DIR)时落到真实 ~/.claude。
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-imseed-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { LOG_DIR } = await import('../packages/app/findcc.js');
const {
  ensureImAppendSystem, buildImAppendSystemPreset, platformLabel,
  readImAppendSystem, writeImAppendSystem, migrateImClaudeMd,
} = await import('../packages/app/server/lib/im-append-system.js');
const { imDir } = await import('../packages/app/server/lib/im-lock.js');
const { IM_PRESET_DIR } = await import('../packages/app/server/_paths.js');

const TARGET = 'CC_APPEND_SYSTEM.md';
const LEGACY = 'CLAUDE.md';

let n = 0;
function freshId() { return `test_md_${process.pid}_${n++}`; }
function wipe(id) { try { rmSync(imDir(id), { recursive: true, force: true }); } catch { /* noop */ } }

describe('im-append-system seed', () => {
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });

  it('creates CC_APPEND_SYSTEM.md under LOG_DIR/IM_<id>/ when absent', () => {
    const id = freshId(); wipe(id);
    const created = ensureImAppendSystem(id);
    assert.equal(created, true);
    const p = join(imDir(id), TARGET);
    assert.equal(existsSync(p), true);
    const content = readFileSync(p, 'utf-8');
    // 关键约束必须在内
    assert.match(content, /AskUserQuestion/);
    assert.match(content, /dangerously-skip-permissions/);
    assert.match(content, /TUI/);
    assert.ok(content.includes(`IM_${id}/`));
    wipe(id);
  });

  it('does NOT overwrite an existing CC_APPEND_SYSTEM.md (wx, returns false)', () => {
    const id = freshId(); wipe(id);
    mkdirSync(imDir(id), { recursive: true });
    const custom = '# my custom personality\n保持原样';
    writeFileSync(join(imDir(id), TARGET), custom);
    const created = ensureImAppendSystem(id);
    assert.equal(created, false);
    assert.equal(readFileSync(join(imDir(id), TARGET), 'utf-8'), custom);
    wipe(id);
  });

  it('concurrent seed writes exactly once and never throws', () => {
    const id = freshId(); wipe(id);
    const results = [ensureImAppendSystem(id), ensureImAppendSystem(id), ensureImAppendSystem(id)];
    assert.equal(results.filter(Boolean).length, 1); // 仅一次新建
    wipe(id);
  });

  it('preset embeds the platform label and hard interaction constraints', () => {
    const md = buildImAppendSystemPreset('dingtalk');
    assert.ok(md.includes(platformLabel('dingtalk')));     // 默认语言 zh → 「钉钉」
    assert.match(md, /禁止使用 AskUserQuestion 工具/);       // 单语言 zh 母本
    assert.match(md, /不可信/);                              // 来信视为不可信输入
    assert.equal(platformLabel('discord'), 'Discord');
    assert.equal(platformLabel('unknownxyz'), 'unknownxyz'); // 未知 id 回退到 id 本身
  });

  it('未知语言回退 zh 模板，但平台名按该语言显示', () => {
    const md = buildImAppendSystemPreset('dingtalk', 'xx');  // 无 xx.md → 回退 zh.md
    assert.match(md, /禁止使用 AskUserQuestion 工具/);       // 正文来自 zh 母本
    assert.ok(md.includes('DingTalk'));                     // 平台名按非 zh → 英文品牌名
    assert.equal(platformLabel('dingtalk', 'xx'), 'DingTalk');
    assert.equal(platformLabel('dingtalk', 'zh-TW'), '钉钉'); // zh* 用中文名
  });
});

// 一次性迁移：遗留 CLAUDE.md → CC_APPEND_SYSTEM.md。幂等、从不删除 CLAUDE.md。
describe('migrateImClaudeMd（CLAUDE.md → CC_APPEND_SYSTEM.md，幂等不破坏）', () => {
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });

  it('(a) 非空遗留 + 目标缺失 → rename 迁移；CLAUDE.md 消失，内容落到 CC_APPEND_SYSTEM.md', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    const persona = '# 我的人格\n说话简短。';
    writeFileSync(join(dir, LEGACY), persona);
    migrateImClaudeMd(id, dir);
    assert.equal(existsSync(join(dir, LEGACY)), false, '遗留 CLAUDE.md 应被迁走');
    assert.equal(readFileSync(join(dir, TARGET), 'utf-8'), persona, '内容应保留在 CC_APPEND_SYSTEM.md');
    wipe(id);
  });

  it('(b) 遗留 + 目标已存在(非空) → 两者皆不动（幂等、不删 CLAUDE.md）', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LEGACY), 'legacy memory');   // 用户后来另建 CLAUDE.md 当项目记忆
    writeFileSync(join(dir, TARGET), 'already migrated'); // 目标已存在
    migrateImClaudeMd(id, dir);
    assert.equal(readFileSync(join(dir, LEGACY), 'utf-8'), 'legacy memory', 'CLAUDE.md 必须原样保留');
    assert.equal(readFileSync(join(dir, TARGET), 'utf-8'), 'already migrated', '目标必须原样保留');
    wipe(id);
  });

  it('(c) 空遗留 + 目标缺失 → 不迁移；留给 ensure 写默认', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LEGACY), ''); // 空文件
    migrateImClaudeMd(id, dir);
    assert.equal(existsSync(join(dir, TARGET)), false, '空遗留不应产生目标');
    assert.equal(existsSync(join(dir, LEGACY)), true, '空 CLAUDE.md 保留不删');
    // 随后 ensure 写默认目标
    assert.equal(ensureImAppendSystem(id), true);
    assert.match(readFileSync(join(dir, TARGET), 'utf-8'), /AskUserQuestion/);
    wipe(id);
  });

  it('(d) 遗留为目录(非普通文件) → no-op，目标仍缺失且目录保留', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, LEGACY), { recursive: true }); // CLAUDE.md 是目录
    migrateImClaudeMd(id, dir);
    assert.equal(existsSync(join(dir, TARGET)), false, '不应把目录迁成目标');
    assert.equal(existsSync(join(dir, LEGACY)), true, 'CLAUDE.md 目录应保留不删');
    wipe(id);
  });

  it('(g) 遗留是符号链接 → lstat 不跟随，跳过迁移（目标不产生，软链保留）', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    const ext = join(dir, 'ext.md'); writeFileSync(ext, 'EXTERNAL-CONTENT');
    symlinkSync(ext, join(dir, LEGACY)); // CLAUDE.md → 外部文件的软链
    migrateImClaudeMd(id, dir);
    assert.equal(existsSync(join(dir, TARGET)), false, '不应把软链迁成系统提示');
    assert.equal(lstatSync(join(dir, LEGACY)).isSymbolicLink(), true, '软链应原样保留');
    wipe(id);
  });

  it('(h) 非空遗留 + 空目标 → 空目标视同缺失，rename 覆盖为遗留内容', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, TARGET), '');        // 空目标（视同缺失）
    writeFileSync(join(dir, LEGACY), 'PERSONA'); // 非空遗留
    migrateImClaudeMd(id, dir);
    assert.equal(readFileSync(join(dir, TARGET), 'utf-8'), 'PERSONA');
    assert.equal(existsSync(join(dir, LEGACY)), false, '迁移后 CLAUDE.md 应消失');
    wipe(id);
  });

  it('(e) 无遗留 → no-op（不抛、不建文件）', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    migrateImClaudeMd(id, dir);
    assert.equal(existsSync(join(dir, TARGET)), false);
    assert.equal(existsSync(join(dir, LEGACY)), false);
    wipe(id);
  });

  it('(f) 重复调用安全：迁移后再次 migrate 不抛、不改', () => {
    const id = freshId(); wipe(id);
    const dir = imDir(id); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LEGACY), 'persona');
    migrateImClaudeMd(id, dir);          // 第一次：迁移
    migrateImClaudeMd(id, dir);          // 第二次：目标已存在 → 早返回
    assert.equal(readFileSync(join(dir, TARGET), 'utf-8'), 'persona');
    assert.equal(existsSync(join(dir, LEGACY)), false);
    wipe(id);
  });
});

describe('im-append-system read/write (模型性格定义 editor)', () => {
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });

  it('readImAppendSystem returns the preset when the file is absent (not yet persisted)', () => {
    const id = freshId(); wipe(id);
    const content = readImAppendSystem(id);
    assert.equal(content, buildImAppendSystemPreset(id)); // 缺失 → 预置文本，但不落盘
    assert.equal(existsSync(join(imDir(id), TARGET)), false);
    wipe(id);
  });

  it('writeImAppendSystem persists content and readImAppendSystem reads it back', () => {
    const id = freshId(); wipe(id);
    const custom = '# 我的机器人\n说话简短一点。';
    writeImAppendSystem(id, custom);
    assert.equal(readFileSync(join(imDir(id), TARGET), 'utf-8'), custom);
    assert.equal(readImAppendSystem(id), custom);
    wipe(id);
  });

  it('writeImAppendSystem overwrites an existing file (atomic temp+rename) and leaves no .tmp', () => {
    const id = freshId(); wipe(id);
    writeImAppendSystem(id, 'first');
    writeImAppendSystem(id, 'second');
    assert.equal(readImAppendSystem(id), 'second');
    const leftover = readdirSync(imDir(id)).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftover, []);
    wipe(id);
  });

  it('readImAppendSystem rethrows a non-ENOENT read error (im-append-system.js)', () => {
    // 把 CC_APPEND_SYSTEM.md 占成目录 → readFileSync 抛 EISDIR（非 ENOENT）→ 不回退预置而是 rethrow。
    const id = freshId(); wipe(id);
    mkdirSync(join(imDir(id), TARGET), { recursive: true });
    assert.throws(() => readImAppendSystem(id), (err) => err && err.code !== 'ENOENT');
    wipe(id);
  });

  it('writeImAppendSystem cleans up temp and rethrows on write failure (im-append-system.js)', () => {
    // 目标占成非空目录 → renameSyncWithRetry 抛错 → catch 删 temp 并 rethrow。
    const id = freshId(); wipe(id);
    const dir = imDir(id);
    mkdirSync(dir, { recursive: true });
    const targetAsDir = join(dir, TARGET);
    mkdirSync(targetAsDir, { recursive: true });
    writeFileSync(join(targetAsDir, 'keep'), 'x'); // 非空，确保 rename 覆盖必失败

    assert.throws(() => writeImAppendSystem(id, 'new content'));
    // catch 已 unlink temp：不应遗留 .tmp- 文件
    const leftover = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftover, []);
    wipe(id);
  });
});

// 守卫：随包发布的每种语言人格预置都能渲染（占位符替换干净、含关键约束）。防止某语言文件被误删/改名/结构破坏。
describe('随包多语言人格预置完整性', () => {
  const langs = readdirSync(IM_PRESET_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));

  it('至少覆盖 18 种语言', () => {
    assert.ok(langs.length >= 18, `仅发现 ${langs.length} 种：${langs.join(',')}`);
  });

  for (const lang of langs) {
    it(`lang=${lang}：占位符替换干净且含关键约束`, () => {
      const md = buildImAppendSystemPreset('dingtalk', lang);
      assert.ok(!md.includes('{platform}') && !md.includes('{id}'), '不应残留占位符');
      assert.ok(md.includes(platformLabel('dingtalk', lang)));
      assert.ok(md.includes('IM_dingtalk/'));
      assert.match(md, /AskUserQuestion/);
      assert.match(md, /dangerously-skip-permissions/);
      assert.match(md, /manage-ccv-projects/);
    });
  }
});
