/**
 * Unit tests for src/utils/teamModalBuilder.js — buildTeamModalData(team, requests, mainAgentSessions).
 *
 * 覆盖目标：组合型大函数 buildTeamModalData 的全部主要分支：
 *   - 输入边界：空 requests、team 无 endRequestIndex、无 mainAgentSessions
 *   - 用户消息提取三策略：策略1(mainAgentSessions 时间范围)、策略2(TeamCreate body.messages，含
 *     slimmed entry restore)、策略3(兜底 assistant text 作为 context)
 *   - modelInfo 解析（getEffectiveModel 末位生效）
 *   - entries 收集与排序：MainAgent assistant / Teammate sub-agent(含 toolResultMap/label) /
 *     SubAgent
 *   - agent 时间数据：Agent spawn / TaskCreate subject / TaskUpdate(owner / taskNum 兜底 /
 *     in_progress+completed) / SendMessage(shutdown / msg-in / team-lead 字符串)
 *   - leadSegments(create/tasks/spawn/msg/cleanup/text/thinking/report-received/idle)
 *   - 第二遍：teammate 自身 tool 调用 → tool:<name> 事件
 *   - teammate-report 提取（含 dedup、system/team-lead 跳过、模糊名字匹配）
 *   - segments 构建与 duration
 *
 * 依赖链含 svg / 无扩展名 import，必须经由 _shims loader + 动态 import 加载。
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let buildTeamModalData;
before(async () => {
  ({ buildTeamModalData } = await import('../src/utils/teamModalBuilder.js'));
});

// ────────────────────────── fixtures ──────────────────────────

const MA_SYS = [{ type: 'text', text: "You are Claude Code, Anthropic's official CLI." }];
// Teammate(proxy 模式) system：含 "Agent Teammate Communication" 标记 + SendMessage 工具 ⇒ isTeammate true
const TM_SYS = [
  { type: 'text', text: 'You are Claude Code.' },
  { type: 'text', text: 'Agent Teammate Communication: You are running as an agent in a team.' },
];

// MainAgent 请求：mainAgent=true + system 含 "You are Claude Code" 且不含 SubAgent 标记
function ma(over = {}) {
  return { mainAgent: true, body: { system: MA_SYS, tools: [], messages: [] }, ...over };
}

// MainAgent response：toolUses + 可选 text/thinking 块
function maResp(ts, content, modelOver = {}) {
  return ma({ timestamp: ts, response: { timestamp: ts, body: { content, ...modelOver } } });
}

function tu(id, name, input) {
  return { type: 'tool_use', id, name, input };
}

// Teammate(interceptor 模式) 请求：req.teammate 字段直接给出名字
function teammateReq({ name, ts, model, respContent, bodyMessages }) {
  return {
    teammate: name,
    timestamp: ts,
    body: {
      system: TM_SYS,
      tools: [{ name: 'SendMessage' }],
      model,
      messages: bodyMessages || [],
    },
    response: { timestamp: ts, body: { content: respContent || [] } },
  };
}

function team(over = {}) {
  return {
    name: 't',
    startTime: '2026-01-01T00:00:00Z',
    endTime: '2026-01-01T00:01:00Z',
    requestIndex: 0,
    endRequestIndex: 0,
    ...over,
  };
}

// ────────────────────────── 边界输入 ──────────────────────────

describe('buildTeamModalData — boundary inputs', () => {
  it('returns the documented shape with all keys', () => {
    const out = buildTeamModalData(team(), [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }])], null);
    assert.deepEqual(
      Object.keys(out).sort(),
      ['entries', 'leadSegments', 'modelInfo', 'teamAgents', 'teamRequests', 'teamTotalStart', 'teamTotalEnd'].sort(),
    );
  });

  it('empty requests → no entries/agents, single trailing idle lead segment, null modelInfo', () => {
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: undefined }), [], null);
    assert.equal(out.entries.length, 0);
    assert.equal(out.teamAgents.length, 0);
    assert.equal(out.modelInfo, null);
    // lastLeadTs(=teamTotalStart) < teamTotalEnd ⇒ 1 个 idle 收尾段
    assert.equal(out.leadSegments.length, 1);
    assert.equal(out.leadSegments[0].label, 'idle');
    assert.equal(out.leadSegments[0].color, '#333');
  });

  it('team without endRequestIndex slices to requests.length', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'first' }]),
      maResp('2026-01-01T00:00:10Z', [{ type: 'text', text: 'second' }]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: undefined }), reqs, null);
    assert.equal(out.teamRequests.length, 2);
  });

  it('teamEndTime falls back to last request timestamp when team.endTime is null', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'x' }])];
    const out = buildTeamModalData(
      team({ endTime: null, requestIndex: 0, endRequestIndex: 0 }),
      reqs,
      null,
    );
    // teamTotalEnd 由 requests[endIdx-1].response.timestamp 推导
    assert.equal(out.teamTotalEnd, new Date('2026-01-01T00:00:00Z').getTime());
  });
});

// ────────────────────────── modelInfo 解析 ──────────────────────────

describe('buildTeamModalData — modelInfo resolution', () => {
  it('prefers response.body.model and last non-null effective model wins', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }], { model: 'claude-opus-4-8-20251101' }),
      // 末位 teammate 带 body.model=sonnet → 覆盖前面的 opus
      teammateReq({ name: 'w', ts: '2026-01-01T00:00:10Z', model: 'claude-sonnet-4-6-20250514', respContent: [{ type: 'text', text: 'r' }] }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.modelInfo.name, 'sonnet-4-6');
    assert.equal(out.modelInfo.provider, 'Claude');
  });

  it('modelInfo is null when no request carries a model', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }])];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.modelInfo, null);
  });

  it('assistant entries carry the resolved modelInfo', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }], { model: 'claude-opus-4-8-20251101' })];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    const asst = out.entries.find(e => e.type === 'assistant');
    assert.ok(asst);
    assert.equal(asst.modelInfo.name, 'opus-4-8');
  });
});

// ────────────────────── 用户消息提取策略 ──────────────────────

describe('buildTeamModalData — user message extraction strategy 1 (mainAgentSessions)', () => {
  it('extracts user messages in [closestBefore, teamEndTime], skipping assistant & out-of-range', () => {
    const sessions = [{
      messages: [
        { role: 'user', _timestamp: '2025-12-31T23:59:00Z', content: 'before team' },
        { role: 'user', _timestamp: '2026-01-01T00:00:05Z', content: [{ type: 'text', text: 'inside range' }] },
        { role: 'assistant', _timestamp: '2026-01-01T00:00:06Z', content: 'assistant ignored' },
        { role: 'user', _timestamp: '2026-01-01T00:02:00Z', content: 'after end ignored' },
        { role: 'user', content: 'no timestamp ignored' },
      ],
    }];
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }])];
    const out = buildTeamModalData(team({ endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 0 }), reqs, sessions);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    assert.deepEqual(users, ['before team', 'inside range']);
  });

  it('skips system-text string content in strategy 1', () => {
    const sessions = [{
      messages: [
        { role: 'user', _timestamp: '2026-01-01T00:00:05Z', content: '<system-reminder>injected</system-reminder>' },
        { role: 'user', _timestamp: '2026-01-01T00:00:06Z', content: 'real prompt' },
      ],
    }];
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }])];
    const out = buildTeamModalData(team({ endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 0 }), reqs, sessions);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    assert.deepEqual(users, ['real prompt']);
  });

  it('blank text blocks in array content are skipped', () => {
    const sessions = [{
      messages: [
        { role: 'user', _timestamp: '2026-01-01T00:00:05Z', content: [{ type: 'text', text: '   ' }, { type: 'text', text: 'kept' }] },
      ],
    }];
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }])];
    const out = buildTeamModalData(team({ endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 0 }), reqs, sessions);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    assert.deepEqual(users, ['kept']);
  });
});

describe('buildTeamModalData — user message extraction strategy 2 (TeamCreate body.messages)', () => {
  it('extracts last user message from TeamCreate request body when no session match', () => {
    const tcReq = ma({
      timestamp: '2026-01-01T00:00:00Z',
      body: {
        system: MA_SYS, tools: [],
        messages: [
          { role: 'user', content: 'earlier prompt' },
          { role: 'assistant', content: 'noise' },
          { role: 'user', content: 'latest user prompt' },
        ],
      },
      response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [{ type: 'text', text: 'a' }] } },
    });
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), [tcReq], null);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    // 从后往前找首条命中的 user，命中后 break
    assert.deepEqual(users, ['latest user prompt']);
  });

  it('extracts array-content text blocks from TeamCreate body', () => {
    const tcReq = ma({
      timestamp: '2026-01-01T00:00:00Z',
      body: {
        system: MA_SYS, tools: [],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'block prompt' }] }],
      },
      response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [{ type: 'text', text: 'a' }] } },
    });
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), [tcReq], null);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    assert.deepEqual(users, ['block prompt']);
  });

  it('restores a slimmed TeamCreate entry via _fullEntryIndex before extracting', () => {
    const fullEntry = ma({
      timestamp: '2026-01-01T00:00:00Z',
      body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'restored prompt' }] },
    });
    const slimEntry = {
      mainAgent: true,
      timestamp: '2026-01-01T00:00:00Z',
      _slimmed: true,
      _fullEntryIndex: 1,
      _messageCount: 1,
      body: { system: MA_SYS, tools: [], messages: [] },
      response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [{ type: 'text', text: 'x' }] } },
    };
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), [slimEntry, fullEntry], null);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    assert.deepEqual(users, ['restored prompt']);
  });
});

describe('buildTeamModalData — user message extraction strategy 3 (context fallback)', () => {
  it('falls back to first assistant text block as a context entry', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [
      { type: 'thinking', thinking: 'pondering' },
      { type: 'text', text: 'first assistant text' },
    ])];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    const ctx = out.entries.find(e => e.type === 'context');
    assert.ok(ctx, 'context entry should exist');
    assert.equal(ctx.text, 'first assistant text');
    // 没有 user 条目
    assert.equal(out.entries.filter(e => e.type === 'user').length, 0);
  });

  it('strategy 3 not triggered when strategy 2 already found a user message', () => {
    const tcReq = ma({
      timestamp: '2026-01-01T00:00:00Z',
      body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'user prompt' }] },
      response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [{ type: 'text', text: 'assistant text' }] } },
    });
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), [tcReq], null);
    assert.equal(out.entries.filter(e => e.type === 'context').length, 0);
    assert.equal(out.entries.filter(e => e.type === 'user').length, 1);
  });
});

// ────────────────────── entries 收集与排序 ──────────────────────

describe('buildTeamModalData — entries collection & sorting', () => {
  it('collects MainAgent responses as assistant entries with requestIndex offset', () => {
    const reqs = [
      ma({ timestamp: '2026-01-01T00:00:00Z', body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'p' }] }, response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [{ type: 'text', text: 'reply' }] } } }),
    ];
    // team starts at request index 1 (offset) — but here single request; use offset team
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    const asst = out.entries.find(e => e.type === 'assistant');
    assert.equal(asst.requestIndex, 0);
    assert.deepEqual(asst.content, [{ type: 'text', text: 'reply' }]);
  });

  it('requestIndex reflects startIdx + local index for sliced team', () => {
    const filler = maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'pre' }]);
    const tcReq = ma({
      timestamp: '2026-01-01T00:00:05Z',
      body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'p' }] },
      response: { timestamp: '2026-01-01T00:00:05Z', body: { content: [{ type: 'text', text: 'reply' }] } },
    });
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:05Z', requestIndex: 1, endRequestIndex: 1 }), [filler, tcReq], null);
    const asst = out.entries.find(e => e.type === 'assistant');
    assert.equal(asst.requestIndex, 1);
  });

  it('skips responses with empty/non-array content', () => {
    const reqs = [
      ma({ timestamp: '2026-01-01T00:00:00Z', body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'p' }] }, response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [] } } }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.entries.filter(e => e.type === 'assistant').length, 0);
  });

  it('builds a sub-agent entry for a Teammate request with label + toolResultMap', () => {
    const reqs = [
      ma({ timestamp: '2026-01-01T00:00:00Z', body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'p' }] }, response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [{ type: 'text', text: 'lead' }] } } }),
      teammateReq({ name: 'worker-1', ts: '2026-01-01T00:00:10Z', model: 'claude-sonnet-4-6-20250514', respContent: [{ type: 'text', text: 'sub work' }] }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const sub = out.entries.find(e => e.type === 'sub-agent');
    assert.ok(sub);
    assert.equal(sub.isTeammate, true);
    assert.equal(sub.label, 'Teammate: worker-1(sonnet-4-6)');
    assert.ok(sub.toolResultMap && typeof sub.toolResultMap === 'object');
    assert.deepEqual(sub.content, [{ type: 'text', text: 'sub work' }]);
  });

  it('SubAgent (non-teammate) request gets formatRequestTag label', () => {
    const subAgentReq = {
      mainAgent: false,
      timestamp: '2026-01-01T00:00:10Z',
      body: {
        system: 'You are a file search specialist.',
        tools: [{ name: 'Glob' }],
        messages: [{ role: 'user', content: 'search' }],
      },
      response: { timestamp: '2026-01-01T00:00:10Z', body: { content: [{ type: 'text', text: 'found' }] } },
    };
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'lead' }]),
      subAgentReq,
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const sub = out.entries.find(e => e.type === 'sub-agent');
    assert.ok(sub);
    assert.equal(sub.isTeammate, false);
    assert.equal(sub.label, 'SubAgent:Search');
  });

  it('entries are sorted ascending by timestamp', () => {
    const reqs = [
      maResp('2026-01-01T00:00:30Z', [{ type: 'text', text: 'late' }]),
      maResp('2026-01-01T00:00:10Z', [{ type: 'text', text: 'early' }]),
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const tss = out.entries.filter(e => e.type === 'assistant').map(e => e.timestamp);
    const sorted = [...tss].sort((a, b) => a.localeCompare(b));
    assert.deepEqual(tss, sorted);
  });
});

// ────────────────────── agent 时间数据：Agent / Task / SendMessage ──────────────────────

describe('buildTeamModalData — teamAgents lifecycle events', () => {
  it('Agent tool_use spawns an agent with palette color, derived type, and spawn event', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [
      tu('a1', 'Agent', { name: 'worker-1', subagent_type: 'plugin:reviewer' }),
    ])];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamAgents.length, 1);
    const ag = out.teamAgents[0];
    assert.equal(ag.name, 'worker-1');
    assert.equal(ag.color, '#1668dc'); // palette[0]
    assert.equal(ag.type, 'reviewer'); // subagent_type.split(':').pop()
    assert.equal(ag.spawnTime, '2026-01-01T00:00:00Z');
    assert.equal(ag.events[0].label, 'spawn');
  });

  it('palette cycles for more than 8 agents', () => {
    const spawns = [];
    for (let i = 0; i < 9; i++) spawns.push(tu('a' + i, 'Agent', { name: 'w' + i }));
    const reqs = [maResp('2026-01-01T00:00:00Z', spawns)];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamAgents.length, 9);
    // palette has 8 entries; 9th wraps to palette[0]
    assert.equal(out.teamAgents[8].color, out.teamAgents[0].color);
  });

  it('Agent with no name does not spawn an agent', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { subagent_type: 'x' })])];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamAgents.length, 0);
  });

  it('TaskCreate subject + TaskUpdate(owner) maps subject and claim/done to the agent', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [
        tu('a1', 'Agent', { name: 'worker-1' }),
        tu('tc', 'TaskCreate', { taskId: '1', subject: 'Build feature' }),
      ]),
      maResp('2026-01-01T00:00:10Z', [tu('u1', 'TaskUpdate', { taskId: '1', owner: 'worker-1', status: 'in_progress' })]),
      maResp('2026-01-01T00:00:20Z', [tu('u2', 'TaskUpdate', { taskId: '1', owner: 'worker-1', status: 'completed' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 2 }), reqs, null);
    const ag = out.teamAgents[0];
    assert.equal(ag.taskSubject, 'Build feature');
    assert.equal(ag.claimTime, '2026-01-01T00:00:10Z');
    assert.equal(ag.doneTime, '2026-01-01T00:00:20Z');
    assert.deepEqual(ag.events.map(e => e.label), ['spawn', 'claim', 'done']);
  });

  it('TaskCreate without explicit taskId uses an auto-increment counter', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [
        tu('a1', 'Agent', { name: 'alpha' }),
        tu('tc', 'TaskCreate', { subject: 'Auto task' }), // no taskId → counter '1'
      ]),
      maResp('2026-01-01T00:00:10Z', [tu('u1', 'TaskUpdate', { taskId: '1', owner: 'alpha', status: 'in_progress' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.teamAgents[0].taskSubject, 'Auto task');
  });

  it('TaskUpdate without owner falls back to taskNum → nth agent (1-based)', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [
        tu('a1', 'Agent', { name: 'alpha' }),
        tu('a2', 'Agent', { name: 'beta' }),
      ]),
      maResp('2026-01-01T00:00:10Z', [tu('u1', 'TaskUpdate', { taskId: '2', status: 'in_progress' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.teamAgents[0].claimTime, null);
    assert.equal(out.teamAgents[1].claimTime, '2026-01-01T00:00:10Z'); // taskId 2 → beta
  });

  it('TaskUpdate reuses previously recorded owner for a taskId', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      // first update records owner for task 5
      maResp('2026-01-01T00:00:10Z', [tu('u1', 'TaskUpdate', { taskId: '5', owner: 'alpha', status: 'in_progress' })]),
      // second update for task 5 without owner → reuses recorded owner alpha
      maResp('2026-01-01T00:00:20Z', [tu('u2', 'TaskUpdate', { taskId: '5', status: 'completed' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 2 }), reqs, null);
    assert.equal(out.teamAgents[0].doneTime, '2026-01-01T00:00:20Z');
  });

  it('claimTime is sticky — second in_progress does not overwrite', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      maResp('2026-01-01T00:00:10Z', [tu('u1', 'TaskUpdate', { taskId: '1', owner: 'alpha', status: 'in_progress' })]),
      maResp('2026-01-01T00:00:20Z', [tu('u2', 'TaskUpdate', { taskId: '1', owner: 'alpha', status: 'in_progress' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 2 }), reqs, null);
    assert.equal(out.teamAgents[0].claimTime, '2026-01-01T00:00:10Z');
    // only one 'claim' event
    assert.equal(out.teamAgents[0].events.filter(e => e.label === 'claim').length, 1);
  });

  it('SendMessage shutdown_request records shutdownTime + shutdown event', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      maResp('2026-01-01T00:00:10Z', [tu('sm', 'SendMessage', { to: 'alpha', message: { type: 'shutdown_request' } })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.teamAgents[0].shutdownTime, '2026-01-01T00:00:10Z');
    assert.ok(out.teamAgents[0].events.some(e => e.label === 'shutdown'));
  });

  it('SendMessage shutdown_response to a known agent is a no-op (no extra event)', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      maResp('2026-01-01T00:00:10Z', [tu('sm', 'SendMessage', { to: 'alpha', message: { type: 'shutdown_response', request_id: 'r', approve: true } })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents[0];
    // shutdown_response branch is skipped — only the spawn event remains, no shutdown/msg-in
    assert.deepEqual(ag.events.map(e => e.label), ['spawn']);
    assert.equal(ag.shutdownTime, null);
  });

  it('SendMessage plain message to a known agent records a msg-in event', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'gamma' })]),
      maResp('2026-01-01T00:00:10Z', [tu('sm', 'SendMessage', { to: 'gamma', message: 'hello there' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.ok(out.teamAgents[0].events.some(e => e.label === 'msg-in'));
  });

  it('parses stringified tool_use input (JSON string)', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [
      { type: 'tool_use', id: 'a1', name: 'Agent', input: JSON.stringify({ name: 'stringified', subagent_type: 'x:worker' }) },
    ])];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamAgents.length, 1);
    assert.equal(out.teamAgents[0].name, 'stringified');
    assert.equal(out.teamAgents[0].type, 'worker');
  });

  it('malformed stringified input falls back to empty object (no spawn)', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [
      { type: 'tool_use', id: 'a1', name: 'Agent', input: '{not valid json' },
    ])];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamAgents.length, 0);
  });
});

// ────────────────────────── leadSegments ──────────────────────────

describe('buildTeamModalData — leadSegments', () => {
  it('emits create/tasks/spawn lead segments for MainAgent team tool_use at advancing timestamps', () => {
    const reqs = [
      // ts == teamStartTime → no segment for this one (tsMs not > lastLeadTs)
      maResp('2026-01-01T00:00:00Z', [tu('tc', 'TeamCreate', { team_name: 't' })]),
      maResp('2026-01-01T00:00:10Z', [tu('task', 'TaskCreate', { subject: 's' })]),
      maResp('2026-01-01T00:00:20Z', [tu('a1', 'Agent', { name: 'w1' })]),
      maResp('2026-01-01T00:00:30Z', [tu('td', 'TeamDelete', {})]),
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 3 }), reqs, null);
    const labels = out.leadSegments.map(s => s.label);
    assert.deepEqual(labels, ['tasks', 'spawn', 'cleanup', 'idle']);
    // TeamDelete segment uses the green close color
    const cleanup = out.leadSegments.find(s => s.label === 'cleanup');
    assert.equal(cleanup.color, '#52c41a');
  });

  it('emits text & thinking lead segments for MainAgent content blocks', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'anchor' }]),
      maResp('2026-01-01T00:00:10Z', [{ type: 'thinking', thinking: 'deep' }]),
      maResp('2026-01-01T00:00:20Z', [{ type: 'text', text: 'more' }]),
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 2 }), reqs, null);
    const labels = out.leadSegments.map(s => s.label);
    assert.deepEqual(labels, ['thinking', 'text', 'idle']);
    assert.equal(out.leadSegments.find(s => s.label === 'thinking').color, '#722ed1');
    assert.equal(out.leadSegments.find(s => s.label === 'text').color, '#196ae1');
  });

  it('SendMessage to team-lead with a plain string emits a report-received segment', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'anchor' }]),
      maResp('2026-01-01T00:00:20Z', [tu('sm', 'SendMessage', { to: 'team-lead', message: 'plain report' })]),
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const labels = out.leadSegments.map(s => s.label);
    // SendMessage triggers both the report-received check AND the generic 'msg' lead segment;
    // report-received fires first and advances lastLeadTs, so 'msg' (same ts) is suppressed.
    assert.ok(labels.includes('report-received'));
    assert.equal(out.leadSegments.find(s => s.label === 'report-received').color, '#52c41a');
  });

  it('no trailing idle segment when lastLeadTs already reaches teamTotalEnd', () => {
    // single MainAgent SendMessage at exactly teamEndTime
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'anchor' }]),
      maResp('2026-01-01T00:01:00Z', [tu('sm', 'SendMessage', { to: 'someone-unknown', message: 'm' })]),
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    // last 'msg' lead segment ends at teamTotalEnd → no idle
    assert.equal(out.leadSegments.some(s => s.label === 'idle'), false);
  });
});

// ──────────────── 第二遍：teammate 自身 tool 调用 ────────────────

describe('buildTeamModalData — teammate own tool calls (second pass)', () => {
  it('records tool:<name> events on the matching spawned agent', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      teammateReq({
        name: 'worker-1',
        ts: '2026-01-01T00:00:10Z',
        model: 'claude-sonnet-4-6-20250514',
        respContent: [
          { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/a' } },
          { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'ls' } },
        ],
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents.find(a => a.name === 'worker-1');
    const toolLabels = ag.events.filter(e => e.label.startsWith('tool:')).map(e => e.label);
    assert.deepEqual(toolLabels, ['tool:Read', 'tool:Bash']);
  });

  it('fuzzy-matches teammate label to a spawned agent name (substring)', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'reviewer' })]),
      // teammate name "reviewer-2" includes "reviewer" → fuzzy match
      teammateReq({
        name: 'reviewer-2',
        ts: '2026-01-01T00:00:10Z',
        respContent: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: {} }],
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents.find(a => a.name === 'reviewer');
    assert.ok(ag.events.some(e => e.label === 'tool:Grep'));
  });

  it('teammate with no matching spawned agent records no tool events', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      teammateReq({
        name: 'totally-different',
        ts: '2026-01-01T00:00:10Z',
        respContent: [{ type: 'tool_use', id: 'g1', name: 'Grep', input: {} }],
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents.find(a => a.name === 'alpha');
    assert.equal(ag.events.some(e => e.label.startsWith('tool:')), false);
  });
});

// ──────────────── teammate-report 提取 ────────────────

describe('buildTeamModalData — teammate-report extraction', () => {
  it('extracts teammate-message reports into entries and agent.teammateMessages', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      ma({
        timestamp: '2026-01-01T00:00:40Z',
        body: {
          system: MA_SYS, tools: [],
          messages: [{ role: 'user', content: [{ type: 'text', text: '<teammate-message teammate_id="worker-1" summary="done summary">finished the work report</teammate-message>' }] }],
        },
        response: { timestamp: '2026-01-01T00:00:40Z', body: { content: [{ type: 'text', text: 'ack' }] } },
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const rep = out.entries.find(e => e.type === 'teammate-report');
    assert.ok(rep);
    assert.equal(rep.agentName, 'worker-1');
    assert.equal(rep.summary, 'done summary');
    assert.equal(rep.content, 'finished the work report');
    assert.ok(typeof rep.agentColor === 'string' && rep.agentColor.startsWith('var(--avatar-bg-'));
    const ag = out.teamAgents.find(a => a.name === 'worker-1');
    assert.equal(ag.teammateMessages.length, 1);
    assert.deepEqual(ag.teammateMessages[0], { summary: 'done summary', content: 'finished the work report' });
  });

  it('skips teammate-message from system or team-lead', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      ma({
        timestamp: '2026-01-01T00:00:40Z',
        body: {
          system: MA_SYS, tools: [],
          messages: [{ role: 'user', content: [
            { type: 'text', text: '<teammate-message teammate_id="system" summary="s">sys msg</teammate-message>' },
            { type: 'text', text: '<teammate-message teammate_id="team-lead" summary="s2">lead msg</teammate-message>' },
          ] }],
        },
        response: { timestamp: '2026-01-01T00:00:40Z', body: { content: [{ type: 'text', text: 'ack' }] } },
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.entries.filter(e => e.type === 'teammate-report').length, 0);
  });

  it('deduplicates identical teammate-message reports across requests', () => {
    const dupText = '<teammate-message teammate_id="worker-1" summary="same">duplicate body</teammate-message>';
    const mkReportReq = (ts) => ma({
      timestamp: ts,
      body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: dupText }] }] },
      response: { timestamp: ts, body: { content: [{ type: 'text', text: 'ack' }] } },
    });
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      mkReportReq('2026-01-01T00:00:30Z'),
      mkReportReq('2026-01-01T00:00:40Z'),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 2 }), reqs, null);
    assert.equal(out.entries.filter(e => e.type === 'teammate-report').length, 1);
  });

  it('restores slimmed entry when scanning for teammate-message reports', () => {
    const reportText = '<teammate-message teammate_id="worker-1" summary="restored">restored report body</teammate-message>';
    const fullEntry = ma({
      timestamp: '2026-01-01T00:00:40Z',
      body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: reportText }] }] },
      response: { timestamp: '2026-01-01T00:00:40Z', body: { content: [{ type: 'text', text: 'ack' }] } },
    });
    const slimEntry = {
      mainAgent: true,
      timestamp: '2026-01-01T00:00:40Z',
      _slimmed: true,
      _fullEntryIndex: 2,
      _messageCount: 1,
      body: { system: MA_SYS, tools: [], messages: [] },
      response: { timestamp: '2026-01-01T00:00:40Z', body: { content: [{ type: 'text', text: 'ack' }] } },
    };
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      slimEntry,
      fullEntry,
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 2 }), reqs, null);
    const reps = out.entries.filter(e => e.type === 'teammate-report');
    assert.ok(reps.some(r => r.content === 'restored report body'));
  });

  it('ignores teammate-message with empty summary (requires summary && content)', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      ma({
        timestamp: '2026-01-01T00:00:40Z',
        body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: '<teammate-message teammate_id="worker-1" summary="">no summary body</teammate-message>' }] }] },
        response: { timestamp: '2026-01-01T00:00:40Z', body: { content: [{ type: 'text', text: 'ack' }] } },
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.entries.filter(e => e.type === 'teammate-report').length, 0);
  });
});

// ──────────────── segments 构建 & duration ────────────────

describe('buildTeamModalData — agent segments & duration', () => {
  it('builds sorted segments from events with colored labels and computes duration', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      maResp('2026-01-01T00:00:10Z', [tu('u1', 'TaskUpdate', { taskId: '1', owner: 'worker-1', status: 'in_progress' })]),
      maResp('2026-01-01T00:00:30Z', [tu('u2', 'TaskUpdate', { taskId: '1', owner: 'worker-1', status: 'completed' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 2 }), reqs, null);
    const ag = out.teamAgents[0];
    // duration = doneTime - spawnTime = 30s
    assert.equal(ag.duration, 30000);
    // segments built from sorted events; first segment is the spawn → claim window
    assert.ok(ag.segments.length >= 1);
    const spawnSeg = ag.segments.find(s => s.label === 'spawn');
    assert.equal(spawnSeg.color, '#555');
    const claimSeg = ag.segments.find(s => s.label === 'claim');
    assert.equal(claimSeg.color, '#faad14');
    // segments are contiguous & non-decreasing
    for (let i = 1; i < ag.segments.length; i++) {
      assert.ok(ag.segments[i].start >= ag.segments[i - 1].start);
    }
  });

  it('tool: segments use the #888 grey color', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      teammateReq({ name: 'worker-1', ts: '2026-01-01T00:00:10Z', respContent: [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }] }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents.find(a => a.name === 'worker-1');
    const toolSeg = ag.segments.find(s => s.label === 'tool:Read');
    assert.ok(toolSeg);
    assert.equal(toolSeg.color, '#888');
  });

  it('agent with no done/shutdown ends at teamEndTime for duration', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'lonely' })])];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:00:50Z', requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    const ag = out.teamAgents[0];
    assert.equal(ag.duration, 50000); // 0 → 50s teamEndTime
  });
});
