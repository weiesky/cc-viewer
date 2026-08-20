/**
 * 分支补强 — src/utils/teamModalBuilder.js buildTeamModalData。
 *
 * 邻近文件 test/team-modal-builder-unit.test.js 已覆盖主线;本文件只补它遗漏的
 * 短路/默认值/三元/continue 分支(单跑口径 branch 86.6% → ≥95):
 *   L18  teamEndTime 回退到 requests[endIdx-1].timestamp(无 response.timestamp)
 *   L39  closestBefore 扫描遇到 session 无 messages → `|| []`
 *   L42  closestBeforeTs 已有值且更晚的 ts 仍 ≤ teamStart → 更新分支
 *   L49  第二遍提取遇到 session 无 messages → `|| []`
 *   L77  策略2 tcMsgs 含非 user 角色 → continue
 *   L99  策略3 respContent 非数组 → continue
 *   L102 策略3 context 时间戳回退到 teamRequests[i].timestamp
 *   L125 assistant entry 无 response.timestamp → req.timestamp
 *   L141 排序时 entry 缺 timestamp → `|| ''`
 *   L148 teamEndTime 为空 → teamTotalEnd 回退 Date.now()
 *   L158 agent-pass resp 非数组 → continue
 *   L159 agent-pass 无 response.timestamp → req.timestamp
 *   L166 block.input 为 null/undefined → `|| {}`
 *   L188 TaskUpdate 无 taskId → taskId = null
 *   L224 shutdown_response 且 to==='team-lead' → `? ''`
 *   L229 team-lead message 为无 type 的对象 → 第二操作数
 *   L266 第二遍 resp 非数组 → continue
 *   L267 第二遍无 response.timestamp → req.timestamp
 *   L296 req 无 body.messages → `|| []`
 *   L300 teammate-report 扫描遇到非 text/空 text 块 → continue
 *   L310 模糊匹配 tid.includes(name) 与 name.includes(tid) 两臂
 *   L313 teammate-report reqTs 回退到 response.timestamp
 *   L333 agent 无 done/shutdown 且 teamEndTime 为空 → Date.now()
 *
 * 不可达:L340 段颜色三元 `: ag.color` —— agent 事件 label 仅 spawn/claim/done/
 *   shutdown/msg-in/tool:*,前五者皆在 segColors,tool:* 命中 startsWith,故
 *   `: ag.color` 永不触发(见 unreachable 数组)。
 *
 * 依赖链含无扩展名 / 资产 import,经 _shims loader + 动态 import 加载。
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
const TM_SYS = [
  { type: 'text', text: 'You are Claude Code.' },
  { type: 'text', text: 'Agent Teammate Communication: You are running as an agent in a team.' },
];

function ma(over = {}) {
  return { mainAgent: true, body: { system: MA_SYS, tools: [], messages: [] }, ...over };
}
function maResp(ts, content, modelOver = {}) {
  return ma({ timestamp: ts, response: { timestamp: ts, body: { content, ...modelOver } } });
}
function tu(id, name, input) {
  return { type: 'tool_use', id, name, input };
}
function teammateReq({ name, ts, model, respContent, bodyMessages }) {
  return {
    teammate: name,
    timestamp: ts,
    body: { system: TM_SYS, tools: [{ name: 'SendMessage' }], model, messages: bodyMessages || [] },
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

// ────────────────────────── L18 / L148 / L333 时间回退 ──────────────────────────

describe('teamModalBuilder 分支 — 时间戳回退', () => {
  it('L18: team.endTime 为 null 且末请求无 response.timestamp → 回退到 request.timestamp', () => {
    // response 存在但 body 无 timestamp 字段;请求自身带 timestamp
    const reqs = [{
      mainAgent: true,
      timestamp: '2026-01-01T00:00:30Z',
      body: { system: MA_SYS, tools: [], messages: [] },
      response: { body: { content: [{ type: 'text', text: 'a' }] } }, // 无 response.timestamp
    }];
    const out = buildTeamModalData(team({ endTime: null, requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamTotalEnd, new Date('2026-01-01T00:00:30Z').getTime());
  });

  it('L148+L333: teamEndTime 推不出 → teamTotalEnd/agent end 走 Date.now() 回退', () => {
    // 首请求带 response.timestamp(给 agent 有效 spawnTime);
    // 末请求(endIdx-1)完全无 timestamp + team.endTime=null ⇒ teamEndTime 为 undefined
    const before = Date.now();
    const reqs = [
      { mainAgent: true,
        body: { system: MA_SYS, tools: [], messages: [] },
        response: { timestamp: '2026-01-01T00:00:05Z', body: { content: [tu('a1', 'Agent', { name: 'lonely' })] } } },
      // 末请求无任何 timestamp、response.body 无内容 ⇒ 不参与 teamEndTime 推导
      { mainAgent: true,
        body: { system: MA_SYS, tools: [], messages: [] },
        response: { body: { content: [] } } },
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: null, requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const after = Date.now();
    // teamTotalEnd 走 Date.now() 回退(L148),落在调用窗口内
    assert.ok(out.teamTotalEnd >= before && out.teamTotalEnd <= after + 5);
    // agent 无 done/shutdown 且 teamEndTime 空 → end 用 Date.now()(L333),duration 为正数
    const ag = out.teamAgents[0];
    assert.ok(Number.isFinite(ag.duration) && ag.duration > 0);
  });
});

// ────────────────────── L39 / L42 / L49 策略1 ──────────────────────

describe('teamModalBuilder 分支 — 策略1 closestBefore 扫描', () => {
  it('L39+L49: session 缺 messages 字段时两遍循环均走 `|| []` 不报错', () => {
    const sessions = [
      {}, // 无 messages → `|| []`
      { messages: [{ role: 'user', _timestamp: '2026-01-01T00:00:05Z', content: 'kept' }] },
    ];
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }])];
    const out = buildTeamModalData(team({ endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 0 }), reqs, sessions);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    assert.deepEqual(users, ['kept']);
  });

  it('L42: 两条早于 teamStart 的 user 消息 → 更晚的一条更新 closestBeforeTs', () => {
    const sessions = [{
      messages: [
        { role: 'user', _timestamp: '2025-12-31T23:58:00Z', content: 'earlier before' },
        // 比上一条更晚但仍 ≤ teamStart ⇒ 命中 `ts > closestBeforeTs` 更新分支
        { role: 'user', _timestamp: '2025-12-31T23:59:30Z', content: 'closer before' },
      ],
    }];
    const reqs = [maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'a' }])];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 0 }), reqs, sessions);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    // effectiveStart = closestBeforeTs(23:59:30) ⇒ 23:58 这条 < effectiveStart 被排除
    assert.deepEqual(users, ['closer before']);
  });
});

// ────────────────────── L77 策略2 ──────────────────────

describe('teamModalBuilder 分支 — 策略2 非 user 跳过', () => {
  it('L77: TeamCreate body.messages 末尾为 assistant 角色 → continue 后命中前面的 user', () => {
    const tcReq = ma({
      timestamp: '2026-01-01T00:00:00Z',
      body: {
        system: MA_SYS, tools: [],
        messages: [
          { role: 'user', content: 'real user prompt' },
          { role: 'assistant', content: 'trailing assistant' }, // 从后往前先遇到它 → continue
        ],
      },
      response: { timestamp: '2026-01-01T00:00:00Z', body: { content: [{ type: 'text', text: 'a' }] } },
    });
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), [tcReq], null);
    const users = out.entries.filter(e => e.type === 'user').map(e => e.text);
    assert.deepEqual(users, ['real user prompt']);
  });
});

// ────────────────────── L99 / L102 策略3 ──────────────────────

describe('teamModalBuilder 分支 — 策略3 context 兜底', () => {
  it('L99+L102: 首请求 response 非数组被跳过;命中请求无 response.timestamp → context.timestamp 回退 req.timestamp', () => {
    const reqs = [
      // 既无 session、又无 TeamCreate user → 进策略3
      { mainAgent: true, timestamp: '2026-01-01T00:00:00Z', body: { system: MA_SYS, tools: [], messages: [] },
        response: { timestamp: '2026-01-01T00:00:00Z', body: { content: 'not-an-array' } } }, // L99 continue
      { mainAgent: true, timestamp: '2026-01-01T00:00:10Z', body: { system: MA_SYS, tools: [], messages: [] },
        response: { body: { content: [{ type: 'text', text: 'ctx body' }] } } }, // 无 response.timestamp
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ctx = out.entries.find(e => e.type === 'context');
    assert.ok(ctx);
    assert.equal(ctx.text, 'ctx body');
    assert.equal(ctx.timestamp, '2026-01-01T00:00:10Z'); // 回退到 req.timestamp
  });
});

// ────────────────────── L125 / L141 entries ──────────────────────

describe('teamModalBuilder 分支 — assistant entry / 排序回退', () => {
  it('L125: assistant entry 无 response.timestamp → timestamp 回退 req.timestamp', () => {
    const reqs = [{
      mainAgent: true,
      timestamp: '2026-01-01T00:00:07Z',
      body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'p' }] },
      response: { body: { content: [{ type: 'text', text: 'reply' }] } }, // 无 response.timestamp
    }];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    const asst = out.entries.find(e => e.type === 'assistant');
    assert.equal(asst.timestamp, '2026-01-01T00:00:07Z');
  });

  it('L141: 含无 timestamp 的 entry 参与排序时走 `|| \'\'` 不抛错', () => {
    // 第一个请求完全无 timestamp ⇒ 其 assistant entry.timestamp 为 undefined → 排序 `|| ''`
    const reqs = [
      { mainAgent: true, body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: 'p' }] },
        response: { body: { content: [{ type: 'text', text: 'no-ts' }] } } },
      maResp('2026-01-01T00:00:10Z', [{ type: 'text', text: 'has-ts' }]),
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const asst = out.entries.filter(e => e.type === 'assistant');
    assert.equal(asst.length, 2);
    // 无 timestamp 的 '' 排在最前
    assert.equal(asst[0].text === undefined ? asst[0].content[0].text : null, 'no-ts');
  });
});

// ────────────────────── L158 / L159 / L166 agent 第一遍 ──────────────────────

describe('teamModalBuilder 分支 — agent 第一遍 resp/ts/input 回退', () => {
  it('L158: agent-pass 中 response 非数组的请求被 continue 跳过', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      // response.body.content 非数组 ⇒ 第一遍 continue(也不计入 entries)
      { mainAgent: true, timestamp: '2026-01-01T00:00:10Z', body: { system: MA_SYS, tools: [], messages: [] },
        response: { timestamp: '2026-01-01T00:00:10Z', body: { content: null } } },
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.teamAgents.length, 1);
    assert.equal(out.teamAgents[0].name, 'alpha');
  });

  it('L159: agent-pass 无 response.timestamp → tsStr 回退 req.timestamp(spawnTime 取该值)', () => {
    const reqs = [{
      mainAgent: true,
      timestamp: '2026-01-01T00:00:03Z',
      body: { system: MA_SYS, tools: [], messages: [] },
      response: { body: { content: [tu('a1', 'Agent', { name: 'alpha' })] } }, // 无 response.timestamp
    }];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamAgents[0].spawnTime, '2026-01-01T00:00:03Z');
  });

  it('L166: tool_use input 为 null → `|| {}` 兜底为空对象(不带 name 故不 spawn)', () => {
    const reqs = [maResp('2026-01-01T00:00:00Z', [
      { type: 'tool_use', id: 'a1', name: 'Agent', input: null }, // 非字符串、为 null → `|| {}`
    ])];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 0 }), reqs, null);
    assert.equal(out.teamAgents.length, 0);
  });
});

// ────────────────────── L188 TaskUpdate 无 taskId ──────────────────────

describe('teamModalBuilder 分支 — TaskUpdate taskId 缺省', () => {
  it('L188: TaskUpdate 无 taskId 但带 owner → taskId=null,仍按 owner 命中 agent', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      // 无 taskId ⇒ `inp.taskId != null ? ... : null` 取 null 分支
      maResp('2026-01-01T00:00:10Z', [tu('u1', 'TaskUpdate', { owner: 'alpha', status: 'in_progress' })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.teamAgents[0].claimTime, '2026-01-01T00:00:10Z');
  });
});

// ────────────────────── L224 / L229 SendMessage ──────────────────────

describe('teamModalBuilder 分支 — SendMessage 边界', () => {
  it('L224: shutdown_response 且 to==="team-lead" → agentMap.has(\'\') 三元取空串', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'alpha' })]),
      maResp('2026-01-01T00:00:10Z', [tu('sm', 'SendMessage', { to: 'team-lead', message: { type: 'shutdown_response', request_id: 'r', approve: true } })]),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents[0];
    // shutdown_response 分支被跳过;alpha 不受影响,仍只有 spawn
    assert.deepEqual(ag.events.map(e => e.label), ['spawn']);
    assert.equal(ag.shutdownTime, null);
  });

  it('L229: to==="team-lead" 且 message 为无 type 的对象 → report-received 段', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [{ type: 'text', text: 'anchor' }]),
      // message 为对象但不含 type ⇒ 命中 `(inp.message && !inp.message.type)` 第二操作数
      maResp('2026-01-01T00:00:20Z', [tu('sm', 'SendMessage', { to: 'team-lead', message: { summary: 'done', foo: 1 } })]),
    ];
    const out = buildTeamModalData(team({ startTime: '2026-01-01T00:00:00Z', endTime: '2026-01-01T00:01:00Z', requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.ok(out.leadSegments.some(s => s.label === 'report-received'));
  });
});

// ────────────────────── L266 / L267 第二遍 teammate tool ──────────────────────

describe('teamModalBuilder 分支 — 第二遍 resp/ts 回退', () => {
  it('L266: 第二遍中 teammate 请求 response 非数组 → continue(无 tool 事件)', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      // 非 MainAgent 的 teammate 请求,但 response.body.content 非数组
      { teammate: 'worker-1', timestamp: '2026-01-01T00:00:10Z',
        body: { system: TM_SYS, tools: [{ name: 'SendMessage' }], messages: [] },
        response: { timestamp: '2026-01-01T00:00:10Z', body: { content: undefined } } },
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents.find(a => a.name === 'worker-1');
    assert.equal(ag.events.some(e => e.label.startsWith('tool:')), false);
  });

  it('L267: 第二遍无 response.timestamp → tsStr 回退 req.timestamp(tool 事件 ts 取该值)', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      { teammate: 'worker-1', timestamp: '2026-01-01T00:00:14Z',
        body: { system: TM_SYS, tools: [{ name: 'SendMessage' }], messages: [] },
        response: { body: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: {} }] } } }, // 无 response.timestamp
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const ag = out.teamAgents.find(a => a.name === 'worker-1');
    const toolEv = ag.events.find(e => e.label === 'tool:Read');
    assert.ok(toolEv);
    assert.equal(toolEv.ts, new Date('2026-01-01T00:00:14Z').getTime());
  });
});

// ────────────────────── L296 / L300 / L310 / L313 teammate-report ──────────────────────

describe('teamModalBuilder 分支 — teammate-report 扫描', () => {
  it('L296: 扫描时遇到 body.messages 缺失的请求 → `|| []` 不抛错', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      // body 无 messages 字段(也无 _slimmed)→ 扫描走 `|| []`
      { mainAgent: true, timestamp: '2026-01-01T00:00:30Z', body: { system: MA_SYS, tools: [] },
        response: { timestamp: '2026-01-01T00:00:30Z', body: { content: [{ type: 'text', text: 'ack' }] } } },
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    assert.equal(out.entries.filter(e => e.type === 'teammate-report').length, 0);
  });

  it('L300: user 消息中含非 text 块或空 text 块 → continue(只命中真正的报告块)', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      ma({
        timestamp: '2026-01-01T00:00:30Z',
        body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: [
          { type: 'tool_result', tool_use_id: 'x', content: 'ignored non-text' }, // 非 text → continue
          { type: 'text', text: '' }, // 空 text → continue
          { type: 'text', text: '<teammate-message teammate_id="worker-1" summary="s">real report</teammate-message>' },
        ] }] },
        response: { timestamp: '2026-01-01T00:00:30Z', body: { content: [{ type: 'text', text: 'ack' }] } },
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const reps = out.entries.filter(e => e.type === 'teammate-report');
    assert.equal(reps.length, 1);
    assert.equal(reps[0].content, 'real report');
  });

  it('L310: tid.includes(ag.name) —— agent 名 "worker" 是报告 id "worker-7" 的子串', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker' })]),
      ma({
        timestamp: '2026-01-01T00:00:30Z',
        body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: [
          { type: 'text', text: '<teammate-message teammate_id="worker-7" summary="s">via tid.includes</teammate-message>' },
        ] }] },
        response: { timestamp: '2026-01-01T00:00:30Z', body: { content: [{ type: 'text', text: 'ack' }] } },
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const rep = out.entries.find(e => e.type === 'teammate-report');
    assert.ok(rep);
    assert.equal(rep.agentName, 'worker');
    assert.equal(rep.content, 'via tid.includes');
  });

  it('L310: ag.name.includes(tid) —— 报告 id "rev" 是 agent 名 "reviewer" 的子串', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'reviewer' })]),
      ma({
        timestamp: '2026-01-01T00:00:30Z',
        body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: [
          { type: 'text', text: '<teammate-message teammate_id="rev" summary="s">via name.includes</teammate-message>' },
        ] }] },
        response: { timestamp: '2026-01-01T00:00:30Z', body: { content: [{ type: 'text', text: 'ack' }] } },
      }),
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const rep = out.entries.find(e => e.type === 'teammate-report');
    assert.ok(rep);
    assert.equal(rep.agentName, 'reviewer');
    assert.equal(rep.content, 'via name.includes');
  });

  it('L313: 报告请求无 req.timestamp → reqTs 回退到 req.response.timestamp', () => {
    const reqs = [
      maResp('2026-01-01T00:00:00Z', [tu('a1', 'Agent', { name: 'worker-1' })]),
      {
        mainAgent: true,
        // 无顶层 timestamp ⇒ reqTs = req.timestamp(undefined) || req.response.timestamp
        body: { system: MA_SYS, tools: [], messages: [{ role: 'user', content: [
          { type: 'text', text: '<teammate-message teammate_id="worker-1" summary="s">ts via response</teammate-message>' },
        ] }] },
        response: { timestamp: '2026-01-01T00:00:45Z', body: { content: [{ type: 'text', text: 'ack' }] } },
      },
    ];
    const out = buildTeamModalData(team({ requestIndex: 0, endRequestIndex: 1 }), reqs, null);
    const rep = out.entries.find(e => e.type === 'teammate-report');
    assert.ok(rep);
    assert.equal(rep.timestamp, '2026-01-01T00:00:45Z');
  });
});
