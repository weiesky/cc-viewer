/**
 * anthropic-auth-placeholder.test.js — ensurePlaceholderApiKey / resolveEffectiveApiKey /
 * ensureApiKeyApproved 的单测。
 *
 * 覆盖：
 *   - 无凭据时注入占位 ANTHROPIC_API_KEY；
 *   - 已有 ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN 时不注入（不覆盖用户凭据）；
 *   - 空白串凭据键被删除后再注入；
 *   - resolveEffectiveApiKey 返回子进程实际生效的 key；
 *   - ensureApiKeyApproved 把 key 的 tail 写进 customApiKeyResponses.approved，幂等、不破坏其它字段。
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 隔离 CLAUDE_CONFIG_DIR（模块顶层不进 env，但 ensureApiKeyApproved 读它定位 .claude.json）。
const tmpHome = mkdtempSync(join(tmpdir(), 'ccv-authph-'));
process.env.CLAUDE_CONFIG_DIR = tmpHome;

const ph = await import('../server/lib/anthropic-auth-placeholder.js');

describe('anthropic-auth-placeholder: ensurePlaceholderApiKey', () => {
  it('无凭据时注入占位 ANTHROPIC_API_KEY 并返回 true', () => {
    const env = { HOME: '/h' };
    assert.equal(ph.ensurePlaceholderApiKey(env), true);
    assert.equal(env.ANTHROPIC_API_KEY, ph.CCV_API_KEY_PLACEHOLDER);
  });

  it('已有 ANTHROPIC_API_KEY 时不覆盖', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-real' };
    assert.equal(ph.ensurePlaceholderApiKey(env), false);
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-real');
  });

  it('已有 ANTHROPIC_AUTH_TOKEN 时不注入（避免双源告警）', () => {
    const env = { ANTHROPIC_AUTH_TOKEN: 'tok-real' };
    assert.equal(ph.ensurePlaceholderApiKey(env), false);
    assert.equal(env.ANTHROPIC_API_KEY, undefined, '不得再注入 API_KEY 造成双源');
  });

  it('空白串凭据键被删除后注入占位', () => {
    const env = { ANTHROPIC_API_KEY: '   ', ANTHROPIC_AUTH_TOKEN: '' };
    assert.equal(ph.ensurePlaceholderApiKey(env), true);
    assert.equal(env.ANTHROPIC_API_KEY, ph.CCV_API_KEY_PLACEHOLDER);
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined, '空白 AUTH_TOKEN 应被删除');
  });

  it('非对象入参返回 false 且不崩', () => {
    assert.equal(ph.ensurePlaceholderApiKey(null), false);
    assert.equal(ph.ensurePlaceholderApiKey(undefined), false);
  });
});

describe('anthropic-auth-placeholder: resolveEffectiveApiKey', () => {
  it('env 有真实 key → 返回它（trim 后）', () => {
    assert.equal(ph.resolveEffectiveApiKey({ ANTHROPIC_API_KEY: '  sk-real  ' }), 'sk-real');
  });
  it('env 无 key / 空白 → 返回占位值', () => {
    assert.equal(ph.resolveEffectiveApiKey({}), ph.CCV_API_KEY_PLACEHOLDER);
    assert.equal(ph.resolveEffectiveApiKey({ ANTHROPIC_API_KEY: '  ' }), ph.CCV_API_KEY_PLACEHOLDER);
  });
});

describe('anthropic-auth-placeholder: ensureApiKeyApproved', () => {
  beforeEach(() => {
    try { rmSync(join(tmpHome, '.claude.json'), { force: true }); } catch { /* noop */ }
  });

  it('把 key 的 tail 写进 customApiKeyResponses.approved，幂等', () => {
    ph.ensureApiKeyApproved({ configDir: tmpHome, key: ph.CCV_API_KEY_PLACEHOLDER });
    const p = join(tmpHome, '.claude.json');
    assert.ok(existsSync(p), '.claude.json 应被创建');
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    const tail = ph.CCV_API_KEY_PLACEHOLDER.slice(-20);
    assert.ok(j.customApiKeyResponses.approved.includes(tail), 'approved 应含 key tail');
    // 幂等：第二次不再重复
    ph.ensureApiKeyApproved({ configDir: tmpHome, key: ph.CCV_API_KEY_PLACEHOLDER });
    const j2 = JSON.parse(readFileSync(p, 'utf-8'));
    assert.equal(j2.customApiKeyResponses.approved.filter((x) => x === tail).length, 1, '幂等不重复');
  });

  it('不破坏已有字段，且不写回损坏文件', () => {
    const p = join(tmpHome, '.claude.json');
    writeFileSync(p, JSON.stringify({ mcpServers: { s: { command: 'x' } }, oauthAccount: { email: 'a@b.c' } }));
    ph.ensureApiKeyApproved({ configDir: tmpHome, key: ph.CCV_API_KEY_PLACEHOLDER });
    const j = JSON.parse(readFileSync(p, 'utf-8'));
    assert.equal(j.mcpServers.s.command, 'x', 'mcpServers 保留');
    assert.equal(j.oauthAccount.email, 'a@b.c', 'oauthAccount 保留');
    // 损坏文件 → 不动
    writeFileSync(p, 'not json{{{');
    ph.ensureApiKeyApproved({ configDir: tmpHome, key: ph.CCV_API_KEY_PLACEHOLDER });
    assert.equal(readFileSync(p, 'utf-8'), 'not json{{{', '损坏文件不被覆盖');
  });
});
