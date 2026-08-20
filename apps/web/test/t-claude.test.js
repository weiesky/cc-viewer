/**
 * src/utils/tClaude.js 单元测试。
 *
 * 覆盖 configDir 感知的 i18n 包装：
 *   - getClaudeConfigDir 默认值 "~/.claude"
 *   - setClaudeConfigDir 仅接受非空字符串；空串/非字符串被忽略（保留旧值）
 *   - tc(key) 把 {configDir} 占位符替换成当前 configDir
 *   - 注入的 configDir 不可被 params 覆盖（params.configDir 被强制覆盖）
 *
 * 模块级单例 _configDir 跨用例共享，用例按依赖顺序断言并在 after() 复位为默认值，
 * 防止污染同进程其它用例。
 *
 * tClaude.js 通过 `import { t } from '../i18n'`（Vite 无扩展名 import），
 * 需经 _shims loader + 动态 import 加载。
 */
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let mod;
const KEY = 'ui.enableThinkingSummariesTip'; // en 值含 "{configDir}/settings.json"

before(async () => {
  mod = await import('../src/utils/tClaude.js');
});

after(() => {
  // 复位单例，避免污染同进程其它用例
  mod.setClaudeConfigDir('~/.claude');
});

describe('tClaude', () => {
  it('getClaudeConfigDir 默认返回 "~/.claude"', () => {
    assert.equal(mod.getClaudeConfigDir(), '~/.claude');
  });

  it('tc 用默认 configDir 替换 {configDir} 占位符', () => {
    const out = mod.tc(KEY);
    assert.ok(out.includes('~/.claude/settings.json'), out);
    assert.ok(!out.includes('{configDir}'));
  });

  it('setClaudeConfigDir 接受非空字符串并被 getClaudeConfigDir / tc 反映', () => {
    mod.setClaudeConfigDir('/abs/claude');
    assert.equal(mod.getClaudeConfigDir(), '/abs/claude');
    const out = mod.tc(KEY);
    assert.ok(out.includes('/abs/claude/settings.json'), out);
  });

  it('setClaudeConfigDir 忽略空字符串（保留旧值）', () => {
    mod.setClaudeConfigDir('/abs/claude');
    mod.setClaudeConfigDir('');
    assert.equal(mod.getClaudeConfigDir(), '/abs/claude');
  });

  it('setClaudeConfigDir 忽略非字符串入参（保留旧值）', () => {
    mod.setClaudeConfigDir('/abs/claude');
    mod.setClaudeConfigDir(null);
    mod.setClaudeConfigDir(123);
    mod.setClaudeConfigDir(undefined);
    assert.equal(mod.getClaudeConfigDir(), '/abs/claude');
  });

  it('params.configDir 不能覆盖注入的 configDir', () => {
    mod.setClaudeConfigDir('/real/dir');
    const out = mod.tc(KEY, { configDir: '/attacker/path' });
    assert.ok(out.includes('/real/dir/settings.json'), out);
    assert.ok(!out.includes('/attacker/path'));
  });

  it('tc 对不含占位符的 key 原样返回翻译', () => {
    mod.setClaudeConfigDir('/x');
    const out = mod.tc('ui.preset.codeReview5.name');
    assert.equal(out, 'UltraReview');
  });
});
