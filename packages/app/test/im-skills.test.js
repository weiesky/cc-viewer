// server/lib/im/im-skills.js 单测 —— 受管同步内置默认技能 manage-ccv-projects 的行为。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOG_DIR } from '../findcc.js';
import { IM_SKILLS_DIR } from '../server/_paths.js';
import { ensureImBuiltinSkills, resolveSkillLang, BUILTIN_SKILL_NAME } from '../server/lib/im/im-skills.js';

// 造一个假的 sourceRoot：<root>/zh/<skill>/SKILL.md + <root>/scripts/ccv-projects.mjs（可选 en）
function makeSource(root, { zh = 'ZH-SKILL', en = null, script = 'SCRIPT-V1' } = {}) {
  mkdirSync(join(root, 'zh', BUILTIN_SKILL_NAME), { recursive: true });
  writeFileSync(join(root, 'zh', BUILTIN_SKILL_NAME, 'SKILL.md'), zh);
  mkdirSync(join(root, 'scripts'), { recursive: true });
  writeFileSync(join(root, 'scripts', 'ccv-projects.mjs'), script);
  if (en !== null) {
    mkdirSync(join(root, 'en', BUILTIN_SKILL_NAME), { recursive: true });
    writeFileSync(join(root, 'en', BUILTIN_SKILL_NAME, 'SKILL.md'), en);
  }
}

describe('ensureImBuiltinSkills', () => {
  let src, work;
  beforeEach(() => {
    src = mkdtempSync(join(tmpdir(), 'ccv-imskill-src-'));
    work = mkdtempSync(join(tmpdir(), 'ccv-imskill-work-'));
  });
  afterEach(() => {
    try { rmSync(src, { recursive: true, force: true }); } catch {}
    try { rmSync(work, { recursive: true, force: true }); } catch {}
  });

  const enabledMd = () => join(work, '.claude', 'skills', BUILTIN_SKILL_NAME, 'SKILL.md');
  const enabledScript = () => join(work, '.claude', 'skills', BUILTIN_SKILL_NAME, 'scripts', 'ccv-projects.mjs');
  const disabledMd = () => join(work, '.claude', 'skills-skip', BUILTIN_SKILL_NAME, 'SKILL.md');

  it('全新安装：种入 skills/，含 SKILL.md 与 scripts/ccv-projects.mjs', () => {
    makeSource(src);
    const r = ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    assert.equal(r.changed, true);
    assert.ok(existsSync(enabledMd()));
    assert.ok(existsSync(enabledScript()));
    assert.equal(readFileSync(enabledMd(), 'utf-8'), 'ZH-SKILL');
    assert.equal(readFileSync(enabledScript(), 'utf-8'), 'SCRIPT-V1');
  });

  it('受管同步：内容陈旧则覆盖为包内最新', () => {
    makeSource(src, { zh: 'NEW' });
    mkdirSync(join(work, '.claude', 'skills', BUILTIN_SKILL_NAME), { recursive: true });
    writeFileSync(enabledMd(), 'OLD');
    const r = ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    assert.equal(r.changed, true);
    assert.equal(readFileSync(enabledMd(), 'utf-8'), 'NEW');
  });

  it('内容一致：changed=false（不重复写）', () => {
    makeSource(src, { zh: 'SAME' });
    ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    const r2 = ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    assert.equal(r2.changed, false);
  });

  it('尊重停用：已在 skills-skip/ 则只同步那儿、不挪回 skills/', () => {
    makeSource(src, { zh: 'NEW' });
    mkdirSync(join(work, '.claude', 'skills-skip', BUILTIN_SKILL_NAME), { recursive: true });
    writeFileSync(disabledMd(), 'OLD');
    ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    assert.equal(readFileSync(disabledMd(), 'utf-8'), 'NEW'); // 内容被同步
    assert.ok(!existsSync(enabledMd()));                       // 没有被重新启用
  });

  it('skills/ 与 skills-skip/ 同时存在：停用态优先（同步 skip，不动 skills）', () => {
    makeSource(src, { zh: 'NEW' });
    mkdirSync(join(work, '.claude', 'skills', BUILTIN_SKILL_NAME), { recursive: true });
    writeFileSync(enabledMd(), 'ENABLED-OLD');
    mkdirSync(join(work, '.claude', 'skills-skip', BUILTIN_SKILL_NAME), { recursive: true });
    writeFileSync(disabledMd(), 'DISABLED-OLD');
    ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    assert.equal(readFileSync(disabledMd(), 'utf-8'), 'NEW');         // 停用态被同步
    assert.equal(readFileSync(enabledMd(), 'utf-8'), 'ENABLED-OLD');  // skills/ 不被触碰
  });

  it('语言回退：选 en 但无 en 目录 → 用 zh', () => {
    makeSource(src, { zh: 'ZH-ONLY' });
    ensureImBuiltinSkills('dingtalk', work, { lang: 'en', sourceRoot: src });
    assert.equal(readFileSync(enabledMd(), 'utf-8'), 'ZH-ONLY');
  });

  it('语言命中：有 en 目录则用 en', () => {
    makeSource(src, { zh: 'ZH', en: 'EN' });
    ensureImBuiltinSkills('dingtalk', work, { lang: 'en', sourceRoot: src });
    assert.equal(readFileSync(enabledMd(), 'utf-8'), 'EN');
  });

  it('源缺失：安全返回 reason=source-missing，不抛错', () => {
    const r = ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src }); // src 空
    assert.equal(r.reason, 'source-missing');
    assert.equal(r.changed, false);
  });

  it('删除后再生成：删掉 skills/ 后再 ensure 会重新种入', () => {
    makeSource(src, { zh: 'X' });
    ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    rmSync(join(work, '.claude', 'skills', BUILTIN_SKILL_NAME), { recursive: true, force: true });
    assert.ok(!existsSync(enabledMd()));
    const r = ensureImBuiltinSkills('dingtalk', work, { lang: 'zh', sourceRoot: src });
    assert.equal(r.changed, true);
    assert.ok(existsSync(enabledMd()));
  });

  it('随包真实源可正常种入（默认 sourceRoot = IM_SKILLS_DIR）', () => {
    // 不指定 sourceRoot，走真实 server/imSkills/zh/manage-ccv-projects
    const r = ensureImBuiltinSkills('dingtalk', work, { lang: 'zh' });
    assert.equal(r.reason, undefined);
    assert.ok(existsSync(enabledMd()));
    assert.ok(existsSync(enabledScript()));
  });
});

describe('resolveSkillLang', () => {
  // 测试期 LOG_DIR 被强制指向临时目录（findcc.js 的 NODE_TEST_CONTEXT 铁闸 / CCV_LOG_DIR=tmp），
  // 故可安全读写 LOG_DIR/preferences.json。
  const prefsPath = join(LOG_DIR, 'preferences.json');
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });
  afterEach(() => { try { rmSync(prefsPath, { force: true }); } catch {} });

  it('读 preferences.lang', () => {
    writeFileSync(prefsPath, JSON.stringify({ lang: 'fr' }));
    assert.equal(resolveSkillLang(), 'fr');
  });

  it('无 preferences.json 回退 zh', () => {
    try { rmSync(prefsPath, { force: true }); } catch {}
    assert.equal(resolveSkillLang(), 'zh');
  });

  it('无 lang 字段回退 zh', () => {
    writeFileSync(prefsPath, JSON.stringify({ theme: 'dark' }));
    assert.equal(resolveSkillLang(), 'zh');
  });

  it('非法 JSON 回退 zh（不抛错）', () => {
    writeFileSync(prefsPath, '{ not valid json');
    assert.equal(resolveSkillLang(), 'zh');
  });
});

// 守卫：随包发布的每种语言母本都能被注入，且内容与源一致。防止某语言文件被误删/改名/结构破坏后静默失效。
describe('随包多语言母本完整性', () => {
  const langs = readdirSync(IM_SKILLS_DIR).filter((d) => d !== 'scripts');

  it('至少覆盖 18 种语言', () => {
    assert.ok(langs.length >= 18, `仅发现 ${langs.length} 种语言：${langs.join(',')}`);
  });

  for (const lang of langs) {
    it(`lang=${lang}：注入内容与包内 ${lang} 母本一致、脚本一并落地`, () => {
      const work = mkdtempSync(join(tmpdir(), 'ccv-imskill-all-'));
      try {
        const r = ensureImBuiltinSkills('dingtalk', work, { lang });
        assert.equal(r.reason, undefined, `${lang} 不应缺源`);
        const got = readFileSync(join(work, '.claude', 'skills', BUILTIN_SKILL_NAME, 'SKILL.md'), 'utf-8');
        const want = readFileSync(join(IM_SKILLS_DIR, lang, BUILTIN_SKILL_NAME, 'SKILL.md'), 'utf-8');
        assert.equal(got, want);
        assert.ok(existsSync(join(work, '.claude', 'skills', BUILTIN_SKILL_NAME, 'scripts', 'ccv-projects.mjs')));
      } finally {
        rmSync(work, { recursive: true, force: true });
      }
    });
  }
});
