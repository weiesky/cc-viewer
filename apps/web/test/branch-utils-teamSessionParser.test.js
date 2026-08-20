// 分支覆盖补强：src/utils/teamSessionParser.js
// 目标：把 single-run 口径 branch% 抬到 >= 95。仅新增本文件,不改源码/既有测试。
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let extractTeamSessions, isStrongTerminal, END_REASON;

before(async () => {
  const mod = await import('../src/utils/teamSessionParser.js');
  extractTeamSessions = mod.extractTeamSessions;
  isStrongTerminal = mod.isStrongTerminal;
  END_REASON = mod.END_REASON;
});

// ---- helpers (与邻近测试风格一致) ----
function toolUse(id, name, input = {}) {
  return { type: 'tool_use', id, name, input };
}
function toolResult(toolUseId, content) {
  return { type: 'tool_result', tool_use_id: toolUseId, content };
}
function makeReq({ ts, toolUses = [], resultPairs = [] }) {
  const req = { timestamp: ts };
  if (toolUses.length > 0) req.response = { body: { content: toolUses }, timestamp: ts };
  if (resultPairs.length > 0) {
    req.body = { messages: [{ role: 'user', content: resultPairs.map(([id, text]) => toolResult(id, text)) }] };
  }
  return req;
}

describe('teamSessionParser 分支补强', () => {

  // ── findToolResult 内部分支 ─────────────────────────────────

  it('B1: _slimmed entry 走 restoreSlimmedEntry 还原后命中 tool_result', () => {
    // index1 是被 slim 掉的 entry,指向 index2 的完整 body。还原后 messages 含 tc1 的 result。
    const slimmed = { timestamp: 't1', _slimmed: true, _fullEntryIndex: 2, _messageCount: 1, body: { model: 'x' } };
    const full = {
      timestamp: 't2',
      body: { messages: [{ role: 'user', content: [toolResult('tc1', '{"success":true}')] }] },
    };
    const requests = [
      makeReq({ ts: 't0', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'sl' })] }),
      slimmed,
      full,
      makeReq({ ts: 't3', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: 't4', resultPairs: [['td1', '{"success":true}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'sl');
    assert.equal(teams[0].endReason, END_REASON.DELETE_CONFIRMED);
  });

  it('B2: tool_result.content 为对象(非字符串)→ 走 JSON.stringify 分支', () => {
    // TeamCreate 的 result 是对象且 stringify 后含 "success":true(无空格)
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'obj' })] }),
      // content 为对象 → typeof !== 'string' 分支,JSON.stringify 后含 success
      { timestamp: '2', body: { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: { success: true } }] }] } },
      makeReq({ ts: '3' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'obj');
  });

  it('B3: tool_result.content 为 falsy(null)→ JSON.stringify(... || "") 默认空串', () => {
    // createResult 还原为 '""'(stringify 空串),不含 error → 不跳过
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'nul' })] }),
      { timestamp: '2', body: { messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: null }] }] } },
      makeReq({ ts: '3' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'nul');
  });

  it('B4: findToolResult 窗口内 messages 非数组 / body 缺失 → continue', () => {
    // 主循环不保护 undefined slot(line70 req.response 直读),故不放 undefined。
    // 这里覆盖 findToolResult 内 !Array.isArray(msgs) 与 entry?.body?.messages 为空两种跳过。
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'gap' })] }),
      { timestamp: '1a' }, // entry?.body?.messages 为 undefined
      { timestamp: '2', body: { messages: 'not-an-array' } }, // !Array.isArray(msgs)
      makeReq({ ts: '3', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '4' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'gap');
  });

  it('B5: msg.role 非 user / msg.content 非数组 → blocks 为空跳过', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'role' })] }),
      // role=assistant(非 user) 与 content 非数组 两种情况
      { timestamp: '2', body: { messages: [
        { role: 'assistant', content: [toolResult('tc1', '{"success":true}')] },
        { role: 'user', content: 'string-not-array' },
      ] } },
      makeReq({ ts: '3', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '4' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'role');
  });

  // ── isDeleteSuccessful 全分支 ───────────────────────────────

  it('B6: TeamDelete result=null(找不到)→ isDeleteSuccessful 默认成功', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      // 无对应 td1 result → resultText=null → return true(成功关闭)
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endReason, END_REASON.DELETE_CONFIRMED);
  });

  it('B7: TeamDelete result 含空格变体 "success": true', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '4', resultPairs: [['td1', '{ "success": true }']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].endReason, END_REASON.DELETE_CONFIRMED);
  });

  it('B8: TeamDelete result 含 "Cleaned up" 但无 success 标记', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '4', resultPairs: [['td1', 'Cleaned up the team directory']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].endReason, END_REASON.DELETE_CONFIRMED);
  });

  it('B9: TeamDelete result 既无 success/Cleaned/Cannot → 落到默认 return true', () => {
    // 命中 isDeleteSuccessful 末尾 line64-65 默认分支
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '4', resultPairs: [['td1', '{"note":"no explicit marker here"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endReason, END_REASON.DELETE_CONFIRMED);
  });

  // ── input 解析分支 ─────────────────────────────────────────

  it('B10: block.input 为 JSON 字符串(可解析)', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [{ type: 'tool_use', id: 'tc1', name: 'TeamCreate', input: '{"team_name":"strinput"}' }] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].name, 'strinput');
  });

  it('B11: block.input 为不可解析字符串 → catch → {} → name=unknown', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [{ type: 'tool_use', id: 'tc1', name: 'TeamCreate', input: '{not valid json' }] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'unknown'); // input.team_name 缺失 → 'unknown'
  });

  it('B12: block.input 为 null → block.input || {}', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [{ type: 'tool_use', id: 'tc1', name: 'TeamCreate', input: null }] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].name, 'unknown');
  });

  it('B13: teamName 用 camelCase teamName(team_name 缺失)', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { teamName: 'camel' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].name, 'camel');
  });

  // ── TeamCreate 错误标记变体 ─────────────────────────────────

  it('B14: createResult 含带空格的 "error" : 变体 → 跳过', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"error" : "boom"}']] }),
    ];
    assert.equal(extractTeamSessions(requests).length, 0);
  });

  it('B15: createResult 含 "Already leading team" → 跳过', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', 'Already leading team alpha']] }),
    ];
    assert.equal(extractTeamSessions(requests).length, 0);
  });

  // ── 时间戳 fallback ────────────────────────────────────────

  it('B16: TeamCreate req.timestamp 缺失 → 用 response.timestamp', () => {
    // 构造无顶层 timestamp,仅 response.timestamp
    const requests = [
      { response: { body: { content: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }, timestamp: 'R1' } },
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      { response: { timestamp: 'R3' } }, // 末尾请求用于 logTail 推断
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].startTime, 'R1');
  });

  // ── SendMessage 分支 ───────────────────────────────────────

  it('B17: SendMessage 无 currentTeam(team 已关闭)→ 不记录 shutdown', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('sm', 'SendMessage', { message: { type: 'shutdown_request' } })] }),
      makeReq({ ts: '2' }),
    ];
    assert.deepEqual(extractTeamSessions(requests), []);
  });

  it('B18: SendMessage message 非 shutdown_request(或 message 缺失)→ 不记录', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc', '{"success":true}']] }),
      // message 缺失(可选链 input.message?.type)
      makeReq({ ts: '3', toolUses: [toolUse('sm1', 'SendMessage', { to: 'w' })] }),
      // message.type 非 shutdown_request
      makeReq({ ts: '4', toolUses: [toolUse('sm2', 'SendMessage', { message: { type: 'hello' } })] }),
      makeReq({ ts: '5' }),
    ];
    const teams = extractTeamSessions(requests);
    // 没有 shutdown → 落 logTail,不是 shutdownRequest
    assert.equal(teams[0].endReason, END_REASON.LOG_TAIL);
  });

  // ── TaskCreate/TaskUpdate 无 currentTeam ───────────────────

  it('B19: TaskCreate 在无打开 team 时不增加计数', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('t1', 'TaskCreate', { subject: 'x' })] }),
      makeReq({ ts: '2' }),
    ];
    assert.deepEqual(extractTeamSessions(requests), []);
  });

  // ── Agent 匹配分支 ─────────────────────────────────────────

  it('B20: Agent 有 team_name 但无匹配的打开 team → 不计入(targetIdx<0,currentTeamIdx<0)', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('a1', 'Agent', { team_name: 'ghost', name: 'w1' })] }),
      makeReq({ ts: '2' }),
    ];
    assert.deepEqual(extractTeamSessions(requests), []);
  });

  it('B21: Agent team_name 指向已关闭 team → 名字匹配但 endTime 存在,不命中', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '4', resultPairs: [['td1', '{"success":true}']] }),
      // alpha 已关闭,且无打开 team(currentTeamIdx=-1)→ Agent 不计入
      makeReq({ ts: '5', toolUses: [toolUse('a1', 'Agent', { team_name: 'alpha', name: 'late' })] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].teammateCount, 0);
  });

  it('B22: Agent 无 team_name 也无 camelCase → fallback 到 currentTeamIdx,agentName 默认空串', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      // Agent 无 team_name 且无 name → fallback currentTeam, agentName=''
      makeReq({ ts: '3', toolUses: [toolUse('a1', 'Agent', {})] }),
      makeReq({ ts: '4' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].teammateCount, 1); // 空串 agentName 计 1 次
  });

  // ── 跨文件 TeamDelete 反推分支 ──────────────────────────────

  it('B23: 跨文件 TeamDelete,resultText 不可 JSON.parse → catch,teamName=unknown', () => {
    // currentTeamIdx<0,无 TeamCreate;result 非合法 JSON → JSON.parse 抛错被 catch
    const requests = [
      makeReq({ ts: '1' }),
      makeReq({ ts: '2', toolUses: [toolUse('td', 'TeamDelete', {})] }),
      makeReq({ ts: '3', resultPairs: [['td', 'Cleaned up (non-json text)']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'unknown'); // parse 失败 → 默认
    assert.equal(teams[0]._inferredStart, true);
    assert.equal(teams[0].startTime, '1'); // requests[0].timestamp 兜底
  });

  it('B24: 跨文件 TeamDelete 回溯命中 Agent(camelCase teamName)设 startIdx/startTs', () => {
    const requests = [
      makeReq({ ts: '0' }), // filler,无 team 工具
      // Agent 用 camelCase teamName 匹配反推出的 team 名
      makeReq({ ts: '1', toolUses: [toolUse('a1', 'Agent', { teamName: 'cross', name: 'w1' })] }),
      makeReq({ ts: '2', toolUses: [toolUse('a2', 'Agent', { teamName: 'cross', name: 'w1' })] }), // 重复 w1 去重
      makeReq({ ts: '3', toolUses: [toolUse('tk', 'TaskUpdate', {})] }),
      makeReq({ ts: '4', toolUses: [toolUse('td', 'TeamDelete', {})] }),
      makeReq({ ts: '5', resultPairs: [['td', '{"success":true,"team_name":"cross"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'cross');
    assert.equal(teams[0].startTime, '1'); // 首个匹配 Agent
    assert.equal(teams[0].requestIndex, 1);
    assert.equal(teams[0].teammateCount, 1); // w1 去重
    assert.equal(teams[0].taskCount, 1); // 1 TaskUpdate 回填
  });

  it('B25: 跨文件回溯 Agent 的 kResp 非数组/kb 非 tool_use 安全跳过;requests[0] 用 response.timestamp', () => {
    const requests = [
      { response: { timestamp: 'R0' } }, // requests[0] 无顶层 timestamp → startTs 兜底用 response.timestamp
      { response: { body: { content: 'not-array' } } }, // kResp 非数组
      makeReq({ ts: '2', toolUses: [{ type: 'text', text: 'hi' }] }), // kb 非 tool_use
      makeReq({ ts: '3', toolUses: [toolUse('td', 'TeamDelete', {})] }),
      makeReq({ ts: '4', resultPairs: [['td', '{"success":true,"team_name":"none-matched"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'none-matched');
    // 无匹配 Agent → startIdx=0,startTs=requests[0].response.timestamp
    assert.equal(teams[0].startTime, 'R0');
    assert.equal(teams[0].requestIndex, 0);
  });

  it('B26: 跨文件回溯 Agent input 为不可解析字符串 → catch,不匹配', () => {
    const requests = [
      makeReq({ ts: '0', toolUses: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: '{bad json' }] }),
      makeReq({ ts: '1', toolUses: [toolUse('td', 'TeamDelete', {})] }),
      makeReq({ ts: '2', resultPairs: [['td', '{"success":true,"team_name":"zz"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'zz');
    // bad-json Agent input 解析失败 → 不匹配 zz → startIdx=0
    assert.equal(teams[0].requestIndex, 0);
  });

  it('B27: 跨文件回填 Agent input 为字符串且 name 缺失 → kInp.name || ""', () => {
    const requests = [
      makeReq({ ts: '0', toolUses: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: '{"team_name":"qq"}' }] }),
      makeReq({ ts: '1', toolUses: [toolUse('td', 'TeamDelete', {})] }),
      makeReq({ ts: '2', resultPairs: [['td', '{"success":true,"team_name":"qq"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'qq');
    assert.equal(teams[0].teammateCount, 1); // 空名也计 1
  });

  // ── 后处理 logTail 边界 ────────────────────────────────────

  it('B28: 后处理 lastReq 无 response.timestamp → 用 lastReq.timestamp', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc', '{"success":true}']] }),
      { timestamp: '9' }, // 末尾请求无 response → lastTs = timestamp
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].endReason, END_REASON.LOG_TAIL);
    assert.equal(teams[0].endTime, '9');
  });

  it('B29: 后处理 startTime === lastTs → 不推断,endTime 保持 null', () => {
    const requests = [
      makeReq({ ts: 'SAME', toolUses: [toolUse('tc', 'TeamCreate', { team_name: 'a' })] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].endTime, null);
    assert.equal(teams[0].endReason, undefined);
  });

  it('B30: 后处理 lastTs 为 falsy → 不推断', () => {
    // 末尾请求既无 response.timestamp 也无 timestamp
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc', '{"success":true}']] }),
      { response: { body: { content: [] } } }, // 无任何 timestamp
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].endTime, null);
  });

  // ── isStrongTerminal 直接覆盖 ──────────────────────────────

  it('B31: isStrongTerminal 各分支', () => {
    assert.equal(isStrongTerminal(null), false);
    assert.equal(isStrongTerminal(undefined), false);
    assert.equal(isStrongTerminal({}), false);
    assert.equal(isStrongTerminal({ endReason: END_REASON.DELETE_CONFIRMED }), true);
    assert.equal(isStrongTerminal({ endReason: END_REASON.SUCCESSOR_CREATE }), true);
    assert.equal(isStrongTerminal({ endReason: END_REASON.SHUTDOWN_REQUEST }), false);
  });

  // ── respContent 非数组提前 continue ────────────────────────

  it('B32: response.body.content 非数组 → continue', () => {
    const requests = [
      { timestamp: '1', response: { body: { content: 'nope' } } },
      { timestamp: '2', response: { body: {} } },
      { timestamp: '3' },
    ];
    assert.deepEqual(extractTeamSessions(requests), []);
  });

  it('B33: block 非 tool_use(text 块)→ continue', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [{ type: 'text', text: 'thinking' }] }),
      makeReq({ ts: '2' }),
    ];
    assert.deepEqual(extractTeamSessions(requests), []);
  });
});
