import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTeamSessions, isStrongTerminal } from '../src/utils/teamSessionParser.js';

// Inlined function removed — now imported from src/utils/teamSessionParser.js

function extractTeamSessions_REMOVED_UNUSED(requests) {
  const teams = [];
  let currentTeamIdx = -1;

  function findToolResult(toolUseId, fromRequestIdx) {
    for (let j = fromRequestIdx + 1; j < requests.length && j <= fromRequestIdx + 10; j++) {
      const msgs = requests[j]?.body?.messages;
      if (!Array.isArray(msgs)) continue;
      for (const msg of msgs) {
        const blocks = msg.role === 'user' && Array.isArray(msg.content) ? msg.content : [];
        for (const b of blocks) {
          if (b.type === 'tool_result' && b.tool_use_id === toolUseId) {
            return typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
          }
        }
      }
    }
    return null;
  }

  function isDeleteSuccessful(resultText) {
    if (!resultText) return false;
    if (resultText.includes('"success":true') || resultText.includes('"success": true')) return true;
    if (resultText.includes('Cleaned up')) return true;
    if (resultText.includes('Cannot cleanup')) return false;
    return true;
  }

  for (let i = 0; i < requests.length; i++) {
    const req = requests[i];
    const respContent = req.response?.body?.content;
    if (!Array.isArray(respContent)) continue;
    for (const block of respContent) {
      if (block.type !== 'tool_use') continue;
      const name = block.name;
      const input = typeof block.input === 'string' ? (() => { try { return JSON.parse(block.input); } catch { return {}; } })() : (block.input || {});
      if (name === 'TeamCreate') {
        const createResult = findToolResult(block.id, i);
        if (createResult && (createResult.includes('"error":') || createResult.includes('"error" :') || createResult.includes('Already leading team'))) continue;
        const teamName = input.team_name || input.teamName || 'unknown';
        const ts = req.timestamp || req.response?.timestamp;
        if (currentTeamIdx >= 0 && !teams[currentTeamIdx].endTime) {
          teams[currentTeamIdx].endTime = ts;
          teams[currentTeamIdx].endRequestIndex = Math.max(teams[currentTeamIdx].requestIndex, i - 1);
          teams[currentTeamIdx]._hasInferredEnd = true;
        }
        const team = { name: teamName, startTime: ts, endTime: null, requestIndex: i, endRequestIndex: null, taskCount: 0, teammateCount: 0, _teammates: new Set() };
        teams.push(team);
        currentTeamIdx = teams.length - 1;
      } else if (name === 'TeamDelete') {
        const resultText = findToolResult(block.id, i);
        if (!isDeleteSuccessful(resultText)) continue;
        const ts = req.timestamp || req.response?.timestamp;
        if (currentTeamIdx < 0) {
          let teamName = 'unknown';
          try { const parsed = JSON.parse(resultText); teamName = parsed.team_name || teamName; } catch {}
          let startIdx = 0;
          let startTs = requests[0]?.timestamp || requests[0]?.response?.timestamp;
          for (let k = 0; k < i; k++) {
            const kResp = requests[k]?.response?.body?.content;
            if (!Array.isArray(kResp)) continue;
            for (const kb of kResp) {
              if (kb.type === 'tool_use' && kb.name === 'Agent') {
                const kInp = typeof kb.input === 'string' ? (() => { try { return JSON.parse(kb.input); } catch { return {}; } })() : (kb.input || {});
                if ((kInp.team_name || kInp.teamName) === teamName) { startIdx = k; startTs = requests[k]?.timestamp || requests[k]?.response?.timestamp; break; }
              }
            }
            if (startIdx > 0) break;
          }
          const team = { name: teamName, startTime: startTs, endTime: ts, requestIndex: startIdx, endRequestIndex: i, taskCount: 0, teammateCount: 0, _teammates: new Set(), _inferredStart: true };
          for (let k = startIdx; k < i; k++) {
            const kResp = requests[k]?.response?.body?.content;
            if (!Array.isArray(kResp)) continue;
            for (const kb of kResp) {
              if (kb.type !== 'tool_use') continue;
              if (kb.name === 'Agent') {
                const kInp = typeof kb.input === 'string' ? (() => { try { return JSON.parse(kb.input); } catch { return {}; } })() : (kb.input || {});
                const an = kInp.name || '';
                if (!team._teammates.has(an)) { team._teammates.add(an); team.teammateCount++; }
              } else if (kb.name === 'TaskCreate' || kb.name === 'TaskUpdate') { team.taskCount++; }
            }
          }
          teams.push(team);
          continue;
        }
        teams[currentTeamIdx].endTime = ts;
        teams[currentTeamIdx].endRequestIndex = i;
        currentTeamIdx = -1;
      } else if (name === 'SendMessage') {
        if (currentTeamIdx >= 0 && input.message?.type === 'shutdown_request') {
          const shutdownTs = req.timestamp || req.response?.timestamp;
          teams[currentTeamIdx]._lastShutdownTime = shutdownTs;
          teams[currentTeamIdx]._lastShutdownRequestIdx = i;
        }
      } else if (name === 'TaskCreate' || name === 'TaskUpdate') {
        if (currentTeamIdx >= 0) teams[currentTeamIdx].taskCount++;
      } else if (name === 'Agent') {
        const teamName = input.team_name || input.teamName;
        const agentName = input.name || '';
        let targetIdx = -1;
        if (teamName) {
          for (let ti = teams.length - 1; ti >= 0; ti--) {
            if (teams[ti].name === teamName && !teams[ti].endTime) { targetIdx = ti; break; }
          }
        }
        if (targetIdx < 0 && currentTeamIdx >= 0) targetIdx = currentTeamIdx;
        if (targetIdx >= 0) {
          const t = teams[targetIdx];
          if (!t._teammates.has(agentName)) { t._teammates.add(agentName); t.teammateCount++; }
        }
      }
    }
  }
  for (const team of teams) {
    if (team.endTime) continue;
    if (team._lastShutdownTime) {
      team.endTime = team._lastShutdownTime;
      team.endRequestIndex = team._lastShutdownRequestIdx;
      team._hasInferredEnd = true;
    } else {
      const lastReq = requests[requests.length - 1];
      const lastTs = lastReq?.response?.timestamp || lastReq?.timestamp;
      if (lastTs && team.startTime !== lastTs) {
        team.endTime = lastTs;
        team.endRequestIndex = requests.length - 1;
        team._hasInferredEnd = true;
      }
    }
  }
  return teams;
}

// ====================================================================
// Test helpers
// ====================================================================

function toolUse(id, name, input = {}) {
  return { type: 'tool_use', id, name, input };
}

function toolResult(toolUseId, content) {
  return { type: 'tool_result', tool_use_id: toolUseId, content };
}

function makeReq({ ts, toolUses = [], resultPairs = [] }) {
  const req = { timestamp: ts };
  if (toolUses.length > 0) {
    req.response = { body: { content: toolUses }, timestamp: ts };
  }
  if (resultPairs.length > 0) {
    req.body = {
      messages: [{ role: 'user', content: resultPairs.map(([id, text]) => toolResult(id, text)) }],
    };
  }
  return req;
}

// ====================================================================
// Tests
// ====================================================================

describe('extractTeamSessions', () => {

  it('T1: normal lifecycle — TeamCreate then TeamDelete', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '2026-01-01T00:01:00Z', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '2026-01-01T00:01:01Z', resultPairs: [['td1', '{"success":true,"message":"Cleaned up"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'alpha');
    assert.equal(teams[0].startTime, '2026-01-01T00:00:00Z');
    assert.equal(teams[0].endTime, '2026-01-01T00:01:00Z');
    assert.equal(teams[0].endRequestIndex, 2);
    assert.ok(!teams[0]._hasInferredEnd, 'should not be inferred end');
  });

  it('T2: failed TeamCreate (error in result) is skipped', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"error":"Already leading team"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 0);
  });

  it('T2b: error check does not false-positive on value containing "error"', () => {
    // Result text contains "error" in a value, not as a key — should NOT be filtered
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'fix-errors' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"team_name":"fix-errors","message":"no error occurred"}']] }),
      makeReq({ ts: '2026-01-01T00:02:00Z' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'fix-errors');
  });

  it('T3: tool result beyond old window of 3 but within 10', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'beta' })] }),
      // 7 filler requests (no messages array)
      ...Array.from({ length: 7 }, (_, i) => makeReq({ ts: `2026-01-01T00:00:0${i + 1}Z` })),
      // tool_result at index 8 (distance = 8 from index 0)
      makeReq({ ts: '2026-01-01T00:00:09Z', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '2026-01-01T00:01:00Z', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '2026-01-01T00:01:01Z', resultPairs: [['td1', '{"success":true}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'beta');
    assert.equal(teams[0].endTime, '2026-01-01T00:01:00Z');
    assert.ok(!teams[0]._hasInferredEnd);
  });

  it('T4: auto-close unclosed team when new TeamCreate appears', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"success":true}']] }),
      // second team created without closing first
      makeReq({ ts: '2026-01-01T00:05:00Z', toolUses: [toolUse('tc2', 'TeamCreate', { team_name: 'beta' })] }),
      makeReq({ ts: '2026-01-01T00:05:01Z', resultPairs: [['tc2', '{"success":true}']] }),
      makeReq({ ts: '2026-01-01T00:10:00Z', toolUses: [toolUse('td2', 'TeamDelete', {})] }),
      makeReq({ ts: '2026-01-01T00:10:01Z', resultPairs: [['td2', '{"success":true}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 2);
    // alpha auto-closed when beta was created
    assert.equal(teams[0].name, 'alpha');
    assert.equal(teams[0].endTime, '2026-01-01T00:05:00Z');
    assert.equal(teams[0]._hasInferredEnd, true);
    assert.equal(teams[0].endRequestIndex, 1); // i-1 = 2-1 = 1
    // beta closed normally
    assert.equal(teams[1].name, 'beta');
    assert.equal(teams[1].endTime, '2026-01-01T00:10:00Z');
    assert.ok(!teams[1]._hasInferredEnd);
  });

  it('T5: shutdown_request as fallback end signal', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '2026-01-01T00:05:00Z', toolUses: [toolUse('sm1', 'SendMessage', { message: { type: 'shutdown_request' }, to: 'worker-1' })] }),
      makeReq({ ts: '2026-01-01T00:06:00Z' }), // trailing request
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endTime, '2026-01-01T00:05:00Z');
    assert.equal(teams[0]._hasInferredEnd, true);
  });

  it('T6: no TeamDelete, no shutdown — fallback to last request timestamp', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '2026-01-01T00:10:00Z' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endTime, '2026-01-01T00:10:00Z');
    assert.equal(teams[0]._hasInferredEnd, true);
  });

  it('T7: single request only — startTime === lastTs, endTime stays null', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endTime, null);
  });

  it('T8: reverse search matches most recent open team with same name', () => {
    const requests = [
      // first alpha
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '2026-01-01T00:01:00Z', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '2026-01-01T00:01:01Z', resultPairs: [['td1', '{"success":true}']] }),
      // second alpha (same name)
      makeReq({ ts: '2026-01-01T00:02:00Z', toolUses: [toolUse('tc2', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:02:01Z', resultPairs: [['tc2', '{"success":true}']] }),
      // Agent targeting alpha — should match second (open) alpha, not first (closed)
      makeReq({ ts: '2026-01-01T00:03:00Z', toolUses: [toolUse('ag1', 'Agent', { team_name: 'alpha', name: 'worker-1' })] }),
      makeReq({ ts: '2026-01-01T00:05:00Z' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 2);
    assert.equal(teams[0].teammateCount, 0); // first alpha: no agents
    assert.equal(teams[1].teammateCount, 1); // second alpha: worker-1
  });

  it('T9: _hasInferredEnd flag correctness for different close paths', () => {
    // Case A: TeamDelete → no _hasInferredEnd
    const reqsA = [
      makeReq({ ts: '100', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '101', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '200', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '201', resultPairs: [['td1', '{"success":true}']] }),
    ];
    assert.ok(!extractTeamSessions(reqsA)[0]._hasInferredEnd);

    // Case B: new TeamCreate → _hasInferredEnd = true
    const reqsB = [
      makeReq({ ts: '100', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '101', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '200', toolUses: [toolUse('tc2', 'TeamCreate', { team_name: 'b' })] }),
      makeReq({ ts: '201', resultPairs: [['tc2', '{"success":true}']] }),
      makeReq({ ts: '300' }),
    ];
    assert.equal(extractTeamSessions(reqsB)[0]._hasInferredEnd, true);

    // Case C: shutdown_request → _hasInferredEnd = true
    const reqsC = [
      makeReq({ ts: '100', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '101', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '200', toolUses: [toolUse('sm1', 'SendMessage', { message: { type: 'shutdown_request' } })] }),
      makeReq({ ts: '300' }),
    ];
    assert.equal(extractTeamSessions(reqsC)[0]._hasInferredEnd, true);

    // Case D: last-request fallback → _hasInferredEnd = true
    const reqsD = [
      makeReq({ ts: '100', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '101', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '300' }),
    ];
    assert.equal(extractTeamSessions(reqsD)[0]._hasInferredEnd, true);
  });

  it('T10: failed TeamDelete does not close team', () => {
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '2026-01-01T00:00:01Z', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '2026-01-01T00:05:00Z', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '2026-01-01T00:05:01Z', resultPairs: [['td1', '{"success":false,"message":"Cannot cleanup team with 2 active member(s)"}']] }),
      makeReq({ ts: '2026-01-01T00:10:00Z' }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    // Should NOT be closed by the failed delete; instead inferred from last request
    assert.equal(teams[0].endTime, '2026-01-01T00:10:00Z');
    assert.equal(teams[0]._hasInferredEnd, true);
  });

  it('T11: taskCount increments via TaskCreate and TaskUpdate', () => {
    const requests = [
      makeReq({ ts: '100', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '101', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '102', toolUses: [toolUse('t1', 'TaskCreate', { subject: 'task 1' }), toolUse('t2', 'TaskCreate', { subject: 'task 2' })] }),
      makeReq({ ts: '103', toolUses: [toolUse('t3', 'TaskUpdate', { taskId: '1', status: 'completed' })] }),
      makeReq({ ts: '200', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '201', resultPairs: [['td1', '{"success":true}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].taskCount, 3); // 2 TaskCreate + 1 TaskUpdate
  });

  it('T12: teammateCount via Agent — deduplication and fallback', () => {
    const requests = [
      makeReq({ ts: '100', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'alpha' })] }),
      makeReq({ ts: '101', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '102', toolUses: [
        toolUse('a1', 'Agent', { team_name: 'alpha', name: 'worker-1' }),
        toolUse('a2', 'Agent', { team_name: 'alpha', name: 'worker-2' }),
      ] }),
      // duplicate worker-1 (should be deduplicated)
      makeReq({ ts: '103', toolUses: [toolUse('a3', 'Agent', { team_name: 'alpha', name: 'worker-1' })] }),
      // Agent without team_name — fallback to currentTeamIdx
      makeReq({ ts: '104', toolUses: [toolUse('a4', 'Agent', { name: 'worker-3' })] }),
      makeReq({ ts: '200', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '201', resultPairs: [['td1', '{"success":true}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams[0].teammateCount, 3); // worker-1, worker-2, worker-3 (deduplicated)
  });

  it('T13: empty requests array returns no teams', () => {
    assert.deepEqual(extractTeamSessions([]), []);
  });

  it('T14: requests with no tool_use blocks return no teams', () => {
    const requests = [
      makeReq({ ts: '100' }),
      makeReq({ ts: '200' }),
    ];
    assert.deepEqual(extractTeamSessions(requests), []);
  });

  it('T15: cross-file — TeamDelete without TeamCreate reconstructs team from result', () => {
    // Simulates a JSONL file where TeamCreate happened in a previous file.
    // This file only has Agent calls and TeamDelete.
    const requests = [
      makeReq({ ts: '2026-01-01T00:00:00Z' }), // no team tools, just filler
      makeReq({ ts: '2026-01-01T00:01:00Z', toolUses: [
        toolUse('a1', 'Agent', { team_name: 'my-team', name: 'worker-1' }),
        toolUse('a2', 'Agent', { team_name: 'my-team', name: 'worker-2' }),
      ] }),
      makeReq({ ts: '2026-01-01T00:02:00Z', toolUses: [toolUse('t1', 'TaskCreate', { subject: 'task 1' })] }),
      makeReq({ ts: '2026-01-01T00:05:00Z', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '2026-01-01T00:05:01Z', resultPairs: [['td1', '{"success":true,"message":"Cleaned up","team_name":"my-team"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'my-team');
    assert.equal(teams[0]._inferredStart, true);
    assert.equal(teams[0].startTime, '2026-01-01T00:01:00Z'); // first Agent call
    assert.equal(teams[0].endTime, '2026-01-01T00:05:00Z');
    assert.equal(teams[0].teammateCount, 2); // worker-1, worker-2
    assert.equal(teams[0].taskCount, 1); // 1 TaskCreate backfilled
  });

  it('T16: cross-file — failed TeamDelete without TeamCreate is still skipped', () => {
    const requests = [
      makeReq({ ts: '100', toolUses: [toolUse('a1', 'Agent', { team_name: 'x', name: 'w1' })] }),
      makeReq({ ts: '200', toolUses: [toolUse('td1', 'TeamDelete', {})] }),
      makeReq({ ts: '201', resultPairs: [['td1', '{"success":false,"message":"Cannot cleanup team with 2 active member(s)"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    // Failed delete should NOT create a team entry
    assert.equal(teams.length, 0);
  });

  // ==================================================================
  // endReason 分类（v2 状态收敛）
  // ==================================================================

  it('T17: endReason=deleteConfirmed when TeamDelete succeeds', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc', 'TeamCreate', { team_name: 'a' })] }),
      makeReq({ ts: '2', resultPairs: [['tc', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('td', 'TeamDelete', {})] }),
      makeReq({ ts: '4', resultPairs: [['td', '{"success":true,"message":"Cleaned up"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endReason, 'deleteConfirmed');
    assert.ok(!teams[0]._hasInferredEnd);
    assert.equal(isStrongTerminal(teams[0]), true);
  });

  it('T18: endReason=successorCreate when a new TeamCreate displaces the previous', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'first' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('tc2', 'TeamCreate', { team_name: 'second' })] }),
      makeReq({ ts: '4', resultPairs: [['tc2', '{"success":true}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 2);
    assert.equal(teams[0].name, 'first');
    assert.equal(teams[0].endReason, 'successorCreate');
    assert.equal(teams[0]._hasInferredEnd, true);
    assert.equal(isStrongTerminal(teams[0]), true, 'successorCreate is a strong terminal');
    // second team has no close yet, falls through to logTail in post-processing
    assert.equal(teams[1].endReason, 'logTail');
  });

  it('T19: endReason=shutdownRequest when only shutdown_request is found', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc', 'TeamCreate', { team_name: 'x' })] }),
      makeReq({ ts: '2', resultPairs: [['tc', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('sm', 'SendMessage', { to: 'worker', message: { type: 'shutdown_request' } })] }),
      makeReq({ ts: '4', toolUses: [toolUse('noop', 'TaskCreate', { subject: 'extend' })] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endReason, 'shutdownRequest');
    assert.equal(teams[0].endTime, '3'); // shutdown_request timestamp
    assert.equal(teams[0]._hasInferredEnd, true);
    assert.equal(isStrongTerminal(teams[0]), false, 'shutdownRequest is weak evidence');
  });

  it('T20: endReason=logTail when nothing signals termination', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc', 'TeamCreate', { team_name: 'x' })] }),
      makeReq({ ts: '2', resultPairs: [['tc', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('task', 'TaskCreate', { subject: 't1' })] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].endReason, 'logTail');
    assert.equal(teams[0].endTime, '3');
    assert.equal(teams[0]._hasInferredEnd, true);
    assert.equal(isStrongTerminal(teams[0]), false, 'logTail is weak evidence');
  });

  it('T21: isStrongTerminal helper returns correctly for all endReason values', () => {
    assert.equal(isStrongTerminal({ endReason: 'deleteConfirmed' }), true);
    assert.equal(isStrongTerminal({ endReason: 'successorCreate' }), true);
    assert.equal(isStrongTerminal({ endReason: 'shutdownRequest' }), false);
    assert.equal(isStrongTerminal({ endReason: 'logTail' }), false);
    assert.equal(isStrongTerminal({ endReason: undefined }), false);
    assert.equal(isStrongTerminal(null), false);
    assert.equal(isStrongTerminal(undefined), false);
  });

  it('T22: cross-file TeamDelete yields endReason=deleteConfirmed (_inferredStart preserved)', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('a1', 'Agent', { team_name: 'cross', name: 'w1' })] }),
      makeReq({ ts: '2', toolUses: [toolUse('td', 'TeamDelete', {})] }),
      makeReq({ ts: '3', resultPairs: [['td', '{"success":true,"team_name":"cross","message":"Cleaned up"}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 1);
    assert.equal(teams[0].name, 'cross');
    assert.equal(teams[0].endReason, 'deleteConfirmed');
    assert.equal(teams[0]._inferredStart, true);
  });

  it('T23: three consecutive TeamCreate of same name — first two get successorCreate', () => {
    const requests = [
      makeReq({ ts: '1', toolUses: [toolUse('tc1', 'TeamCreate', { team_name: 'same' })] }),
      makeReq({ ts: '2', resultPairs: [['tc1', '{"success":true}']] }),
      makeReq({ ts: '3', toolUses: [toolUse('tc2', 'TeamCreate', { team_name: 'same' })] }),
      makeReq({ ts: '4', resultPairs: [['tc2', '{"success":true}']] }),
      makeReq({ ts: '5', toolUses: [toolUse('tc3', 'TeamCreate', { team_name: 'same' })] }),
      makeReq({ ts: '6', resultPairs: [['tc3', '{"success":true}']] }),
    ];
    const teams = extractTeamSessions(requests);
    assert.equal(teams.length, 3);
    assert.equal(teams[0].endReason, 'successorCreate');
    assert.equal(teams[1].endReason, 'successorCreate');
    // last one falls through to logTail
    assert.equal(teams[2].endReason, 'logTail');
  });
});
