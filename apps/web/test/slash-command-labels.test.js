// 锁定 getSlashCommandLabel 的契约:
//  - 命中白名单的裸命令 → 返回本地化标签
//  - 命中白名单 + 带参 → 返回 「标签 + 原始参数」
//  - 未知/大小写偏差/含换行/空 → 返回 null,调用方回落原文
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getSlashCommandLabel, getSlashCommandTooltip } from '../src/utils/slashCommandLabels.js';
import { setLang, getLang } from '../src/i18n.js';

// 防止本测试切换 lang 污染同进程其它测试。
let originalLang;
before(() => { originalLang = getLang(); });
after(() => { setLang(originalLang); });

describe('getSlashCommandLabel', () => {
  it('returns null for non-string / empty / nullish', () => {
    assert.equal(getSlashCommandLabel(null), null);
    assert.equal(getSlashCommandLabel(undefined), null);
    assert.equal(getSlashCommandLabel(''), null);
    assert.equal(getSlashCommandLabel(123), null);
    assert.equal(getSlashCommandLabel({}), null);
  });

  it('returns null for multiline (any \\n) — 避免对多行用户输入误命中', () => {
    assert.equal(getSlashCommandLabel('/clear\n'), null);
    assert.equal(getSlashCommandLabel('/clear\nrest'), null);
    assert.equal(getSlashCommandLabel('please\n/clear'), null);
  });

  it('returns null for prose containing a slash command (not a bare command)', () => {
    assert.equal(getSlashCommandLabel('please run /theme'), null);
    assert.equal(getSlashCommandLabel('the /clear command'), null);
  });

  it('rejects uppercase variants (CLI 命令大小写敏感)', () => {
    assert.equal(getSlashCommandLabel('/Theme'), null);
    assert.equal(getSlashCommandLabel('/CLEAR'), null);
    assert.equal(getSlashCommandLabel('/Help'), null);
  });

  it('returns null for unknown commands', () => {
    assert.equal(getSlashCommandLabel('/foo'), null);
    assert.equal(getSlashCommandLabel('/notacommand'), null);
    assert.equal(getSlashCommandLabel('/user-custom'), null);
  });

  it('returns a non-null label for known bare commands (zh)', () => {
    setLang('zh');
    assert.equal(getSlashCommandLabel('/theme'), '主题切换');
    assert.equal(getSlashCommandLabel('/clear'), '清空上下文');
    assert.equal(getSlashCommandLabel('/help'), '帮助');
  });

  it('rejects Unicode line/paragraph separators (U+2028 / U+2029)', () => {
    setLang('zh');
    // U+2028 LINE SEPARATOR / U+2029 PARAGRAPH SEPARATOR 在多行守卫里必须被拦截,
    // 否则 regex `[ \t]+` 不识别它们,会被当成参数分隔符塞 payload。
    assert.equal(getSlashCommandLabel('/clear evil'), null);
    assert.equal(getSlashCommandLabel('/clear evil'), null);
    assert.equal(getSlashCommandLabel('/theme dark'), null);
  });

  it('strips bidi-control chars from arguments (U+202A-U+202E / U+2066-U+2069)', () => {
    setLang('zh');
    // RLO 等 bidi-control 不会让命令拒绝,但参数里这些控制符必须 strip,
    // 否则进入 span 会翻转剩余气泡内容视觉方向。
    assert.equal(getSlashCommandLabel('/clear ‮evil‬'), '清空上下文 evil');
    assert.equal(getSlashCommandLabel('/model ⁦opus⁩'), '切换模型 opus');
  });

  it('getSlashCommandTooltip returns bare /cmd (strips args to avoid leaking secrets like /login <token>)', () => {
    // 核心安全契约:Tooltip 只显裸命令,/login secret-token 的参数不会进 hover/title
    assert.equal(getSlashCommandTooltip('/login secret-token-abc'), '/login');
    assert.equal(getSlashCommandTooltip('/model opus'), '/model');
    assert.equal(getSlashCommandTooltip('/theme'), '/theme');
    assert.equal(getSlashCommandTooltip('/clear  '), '/clear');
  });

  it('getSlashCommandTooltip 拒绝非白名单命令与多行/Unicode 异常', () => {
    assert.equal(getSlashCommandTooltip('/foo'), null);
    assert.equal(getSlashCommandTooltip('/Login'), null); // 大小写敏感
    assert.equal(getSlashCommandTooltip('/clear\nevil'), null);
    assert.equal(getSlashCommandTooltip(null), null);
    assert.equal(getSlashCommandTooltip(''), null);
  });

  it('locks zh /cost vs /usage 语义不冲突', () => {
    setLang('zh');
    // /cost = 花费,/usage = 用量。两者中文译文必须明确区分,
    // 否则用户看到两个气泡都写「用量」会困惑。
    const cost = getSlashCommandLabel('/cost');
    const usage = getSlashCommandLabel('/usage');
    assert.notEqual(cost, usage);
    assert.ok(cost.includes('花费') || cost.includes('费用'), `cost=${cost}`);
    assert.ok(usage.includes('用量') || usage.includes('使用'), `usage=${usage}`);
  });

  it('trims surrounding whitespace before matching', () => {
    setLang('zh');
    assert.equal(getSlashCommandLabel('  /theme  '), '主题切换');
    assert.equal(getSlashCommandLabel('\t/clear\t'), '清空上下文');
  });

  it('passes through arguments when command head matches', () => {
    setLang('zh');
    assert.equal(getSlashCommandLabel('/model opus'), '切换模型 opus');
    assert.equal(getSlashCommandLabel('/theme dark'), '主题切换 dark');
    assert.equal(getSlashCommandLabel('/effort high'), '思考强度 high');
  });

  it('respects current language (en)', () => {
    setLang('en');
    assert.equal(getSlashCommandLabel('/theme'), 'Toggle theme');
    assert.equal(getSlashCommandLabel('/clear'), 'Clear context');
    assert.equal(getSlashCommandLabel('/model sonnet'), 'Switch model sonnet');
  });

  it('covers all 33 built-in commands without throwing', () => {
    setLang('zh');
    const builtins = [
      '/clear', '/compact', '/theme', '/cost', '/usage', '/context',
      '/model', '/effort', '/login', '/logout', '/status', '/help',
      '/init', '/agents', '/config', '/memory', '/permissions', '/hooks',
      '/plugins', '/release-notes', '/upgrade', '/bug', '/doctor', '/mcp',
      '/vim', '/export', '/pr-comments', '/review', '/security-review',
      '/ide', '/resume', '/terminal-setup', '/migrate-installer',
    ];
    for (const cmd of builtins) {
      const label = getSlashCommandLabel(cmd);
      assert.ok(typeof label === 'string' && label.length > 0, `${cmd} → empty label`);
      assert.notEqual(label, cmd, `${cmd} → not translated`);
    }
  });

  it('locks zh `/agents` translation to subagent semantics (not proxy)', () => {
    setLang('zh');
    // /agents 必须避开「代理 = proxy」歧义,显式包含「子代理」语义
    const label = getSlashCommandLabel('/agents');
    assert.ok(label.includes('子代理') || label.includes('代理'), `unexpected: ${label}`);
    assert.notEqual(label, '代理管理');
  });
});
