// Regression guard for teammateDetector.isNativeTeammate
//
// 关键 bug：v1.6.193 前，isNativeTeammate 只凭 system prompt 正则
// /You are a Claude agent/ 判定，导致 Claude Agent SDK 启动的普通 subagent
// 被误判为 teammate——因为两者 system prompt 开头完全一样。
//
// 修复：追加 SendMessage tool 存在性判据（teammate 间通信必需；subagent 没有）。
//
// 此测试直接导入 packages/core/src/teammateDetector.js（plain ESM，无 Vite 特性，
// Node 可直接 import）。teammate-classification.test.js 内联了独立判定逻辑，
// 不覆盖此检测器，必须有单独回归守卫。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isNativeTeammate, extractNativeTeammateName, extractCcVersion } from '../src/teammateDetector.js';

function mkReq({ system = '', tools = [], teammate = null, messages = [] } = {}) {
  const req = { body: { system, tools, messages } };
  if (teammate) req.teammate = teammate;
  return req;
}

const SDK_SYSTEM = 'You are a Claude agent, built on Anthropic\'s Claude Agent SDK.';
const MAIN_SYSTEM = 'You are Claude Code, Anthropic\'s official CLI for Claude.';

describe('isNativeTeammate', () => {
  it('真 teammate: SDK prompt + SendMessage tool → true', () => {
    const req = mkReq({
      system: SDK_SYSTEM + '\nAgent Teammate Communication',
      tools: [{ name: 'Bash' }, { name: 'SendMessage' }, { name: 'Read' }],
    });
    assert.equal(isNativeTeammate(req), true);
  });

  it('SDK 主会话 (ccv -SDK): sdk-ts entrypoint + SDK prompt + SendMessage → false', () => {
    // 用户截图的「双写」场景:SDK 主会话 system 含 billing 标记 cc_entrypoint=sdk-ts,
    // 且被授予 SendMessage(37 主工具之一),旧判据会误判成 teammate 让前端双渲染。
    const req = mkReq({
      system: 'x-anthropic-billing-header: cc_version=2.1.199.ef3; cc_entrypoint=sdk-ts;\n' + SDK_SYSTEM,
      tools: [{ name: 'Bash' }, { name: 'Edit' }, { name: 'SendMessage' }, { name: 'Agent' }, { name: 'Read' }],
    });
    assert.equal(isNativeTeammate(req), false);
  });

  it('真 teammate 不带 sdk-ts 标记(Agent 工具启动、entrypoint=cli)→ 仍 true(不回归)', () => {
    const req = mkReq({
      system: 'x-anthropic-billing-header: cc_version=2.1.199; cc_entrypoint=cli;\n' + SDK_SYSTEM + '\nYou are CRer2, review the diff',
      tools: [{ name: 'Bash' }, { name: 'SendMessage' }],
      messages: [{ role: 'user', content: 'You are CRer2, review the diff' }],
    });
    assert.equal(isNativeTeammate(req), true);
  });

  it('普通 subagent (本次 bug 场景): SDK prompt 但无 SendMessage → false', () => {
    // 就是用户截图那条请求的特征：Agent SDK subagent，14 个 tools 里没 SendMessage
    const req = mkReq({
      system: SDK_SYSTEM,
      tools: [
        { name: 'Bash' }, { name: 'Edit' }, { name: 'Glob' }, { name: 'Grep' },
        { name: 'Read' }, { name: 'Write' }, { name: 'WebFetch' }, { name: 'WebSearch' },
        { name: 'EnterWorktree' }, { name: 'ExitWorktree' }, { name: 'NotebookEdit' },
        { name: 'Skill' },
      ],
    });
    assert.equal(isNativeTeammate(req), false,
      '修复前这里会误判为 true，导致 UI 把 subagent 渲染成 teammate');
  });

  it('主 agent: "You are Claude Code" → false（不命中 SDK prompt）', () => {
    const req = mkReq({
      system: MAIN_SYSTEM,
      tools: [{ name: 'Bash' }, { name: 'SendMessage' }],
    });
    assert.equal(isNativeTeammate(req), false);
  });

  it('外部进程 teammate: 有 req.teammate → false（走另一条路径）', () => {
    // interceptor 模式下直接用 req.teammate 字段，native 检测器应让路
    const req = mkReq({
      system: SDK_SYSTEM,
      tools: [{ name: 'SendMessage' }],
      teammate: 'researcher',
    });
    assert.equal(isNativeTeammate(req), false);
  });

  it('空/缺失输入: 不炸', () => {
    assert.equal(isNativeTeammate(null), false);
    assert.equal(isNativeTeammate(undefined), false);
    assert.equal(isNativeTeammate({}), false);
    assert.equal(isNativeTeammate({ body: {} }), false);
    assert.equal(isNativeTeammate({ body: { tools: null } }), false);
    assert.equal(isNativeTeammate({ body: { system: SDK_SYSTEM } }), false,
      'tools 缺失应判为 false（严格要求 SendMessage）');
  });

  it('system 是 array 形式（multi-block）也能正确提取', () => {
    const req = mkReq({
      system: [
        { type: 'text', text: 'cch=abc;' },
        { type: 'text', text: SDK_SYSTEM + '\nAgent Teammate Communication' },
      ],
      tools: [{ name: 'SendMessage' }],
    });
    assert.equal(isNativeTeammate(req), true);
  });

  it('tools 里有名字不一样的伪 SendMessage → false', () => {
    const req = mkReq({
      system: SDK_SYSTEM,
      tools: [{ name: 'sendMessage' }, { name: 'Send_Message' }],
    });
    assert.equal(isNativeTeammate(req), false);
  });

  it('WeakMap 缓存：同一 req 多次调用结果一致', () => {
    const req = mkReq({
      system: SDK_SYSTEM,
      tools: [{ name: 'SendMessage' }],
    });
    const a = isNativeTeammate(req);
    const b = isNativeTeammate(req);
    const c = isNativeTeammate(req);
    assert.equal(a, true);
    assert.equal(b, true);
    assert.equal(c, true);
  });
});

describe('extractNativeTeammateName', () => {
  it('从 "You are XXX," 任务提示中提取', () => {
    const req = mkReq({
      messages: [{ role: 'user', content: 'You are researcher, please dig into...' }],
    });
    assert.equal(extractNativeTeammateName(req), 'researcher');
  });

  it('从 OMC hook 提取', () => {
    const req = mkReq({
      messages: [{ role: 'user', content: 'Agent oh-my-claudecode:code-reviewer started' }],
    });
    assert.equal(extractNativeTeammateName(req), 'code-reviewer');
  });

  it('无匹配 → null', () => {
    const req = mkReq({
      messages: [{ role: 'user', content: 'some random task' }],
    });
    assert.equal(extractNativeTeammateName(req), null);
  });
});

describe('extractCcVersion', () => {
  it('captures hex-suffixed version (e.g., 2.1.162.4f0)', () => {
    const req = mkReq({
      system: [{ type: 'text', text: 'x-anthropic-billing-header: cc_version=2.1.162.4f0; cc_entrypoint=cli;' }],
    });
    assert.equal(extractCcVersion(req), '2.1.162.4f0');
  });

  it('captures all-digit suffix (e.g., 2.1.162.884)', () => {
    const req = mkReq({
      system: [{ type: 'text', text: 'cc_version=2.1.162.884; cc_entrypoint=cli;' }],
    });
    assert.equal(extractCcVersion(req), '2.1.162.884');
  });

  it('backward-compatible with old format without hex suffix', () => {
    const req = mkReq({
      system: [{ type: 'text', text: 'cc_version=2.1.90; cc_entrypoint=cli;' }],
    });
    assert.equal(extractCcVersion(req), '2.1.90');
  });

  it('returns null when system is not an array', () => {
    const req = mkReq({ system: 'cc_version=2.1.162.4f0;' });
    assert.equal(extractCcVersion(req), null);
  });

  it('returns null when no cc_version present', () => {
    const req = mkReq({
      system: [{ type: 'text', text: 'no version info here' }],
    });
    assert.equal(extractCcVersion(req), null);
  });
});
