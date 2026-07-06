/**
 * Parse team lifecycle (TeamCreate → TeamDelete) from requests.
 * Pure function, no React/state dependencies.
 */

import { restoreSlimmedEntry } from './entry-slim.js';

// 从 requests 中提取 Team 会话列表
export function extractTeamSessions(requests) {
  const teams = [];
  let currentTeamIdx = -1; // 当前唯一打开的 team 在 teams[] 中的 index

  // 查找 tool_use 对应的 tool_result（在后续 request 的 messages 中）
  // 搜索窗口扩大到 10 以应对空行/非主agent请求插入导致的距离增大
  function findToolResult(toolUseId, fromRequestIdx) {
    for (let j = fromRequestIdx + 1; j < requests.length && j <= fromRequestIdx + 10; j++) {
      const entry = requests[j]?._slimmed ? restoreSlimmedEntry(requests[j], requests) : requests[j];
      const msgs = entry?.body?.messages;
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
    // tool_result 可能因 entry-slim/delta 压缩而不可达，默认视为成功
    // 只有明确包含 "Cannot cleanup" 才判定失败
    if (!resultText) return true;
    if (resultText.includes('"success":true') || resultText.includes('"success": true')) return true;
    if (resultText.includes('Cleaned up')) return true;
    if (resultText.includes('Cannot cleanup')) return false;
    // 没有明确失败标记的默认视为成功
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
        // 检查 TeamCreate 是否成功（tool_result 中不能有错误标记）
        const createResult = findToolResult(block.id, i);
        if (createResult && (createResult.includes('"error":') || createResult.includes('"error" :') || createResult.includes('Already leading team'))) continue;
        const teamName = input.team_name || input.teamName || 'unknown';
        const ts = req.timestamp || req.response?.timestamp;
        // 新 TeamCreate 出现时，自动关闭前一个未关闭的 team（避免孤立）
        if (currentTeamIdx >= 0 && !teams[currentTeamIdx].endTime) {
          teams[currentTeamIdx].endTime = ts;
          teams[currentTeamIdx].endRequestIndex = Math.max(teams[currentTeamIdx].requestIndex, i - 1);
          teams[currentTeamIdx]._inferredEnd = true;
        }
        const team = { name: teamName, startTime: ts, endTime: null, requestIndex: i, endRequestIndex: null, taskCount: 0, teammateCount: 0, _teammates: new Set() };
        teams.push(team);
        currentTeamIdx = teams.length - 1;
      } else if (name === 'TeamDelete') {
        const resultText = findToolResult(block.id, i);
        if (!isDeleteSuccessful(resultText)) continue; // 失败的 TeamDelete 不关闭 team
        const ts = req.timestamp || req.response?.timestamp;
        if (currentTeamIdx < 0) {
          // Cross-file: TeamCreate 在上一个 JSONL 中，从 tool_result 反向推断 team
          let teamName = 'unknown';
          try { const parsed = JSON.parse(resultText); teamName = parsed.team_name || teamName; } catch {}
          // 回溯寻找最早的关联 Agent 调用作为 startTime
          let startIdx = 0;
          let startTs = requests[0]?.timestamp || requests[0]?.response?.timestamp;
          for (let k = 0; k < i; k++) {
            const kResp = requests[k]?.response?.body?.content;
            if (!Array.isArray(kResp)) continue;
            for (const kb of kResp) {
              if (kb.type === 'tool_use' && kb.name === 'Agent') {
                const kInp = typeof kb.input === 'string' ? (() => { try { return JSON.parse(kb.input); } catch { return {}; } })() : (kb.input || {});
                if ((kInp.team_name || kInp.teamName) === teamName) {
                  startIdx = k;
                  startTs = requests[k]?.timestamp || requests[k]?.response?.timestamp;
                  break;
                }
              }
            }
            if (startIdx > 0) break;
          }
          const team = { name: teamName, startTime: startTs, endTime: ts, requestIndex: startIdx, endRequestIndex: i, taskCount: 0, teammateCount: 0, _teammates: new Set(), _inferredStart: true };
          // 回填 teammate 和 task 计数
          for (let k = startIdx; k < i; k++) {
            const kResp = requests[k]?.response?.body?.content;
            if (!Array.isArray(kResp)) continue;
            for (const kb of kResp) {
              if (kb.type !== 'tool_use') continue;
              if (kb.name === 'Agent') {
                const kInp = typeof kb.input === 'string' ? (() => { try { return JSON.parse(kb.input); } catch { return {}; } })() : (kb.input || {});
                const an = kInp.name || '';
                if (!team._teammates.has(an)) { team._teammates.add(an); team.teammateCount++; }
              } else if (kb.name === 'TaskCreate' || kb.name === 'TaskUpdate') {
                team.taskCount++;
              }
            }
          }
          teams.push(team);
          continue;
        }
        teams[currentTeamIdx].endTime = ts;
        teams[currentTeamIdx].endRequestIndex = i;
        currentTeamIdx = -1; // 清理：team 已关闭
      } else if (name === 'SendMessage') {
        // 跟踪 shutdown_request 作为备用结束信号
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
          // 按 team_name 精确匹配（使用反向搜索，优先匹配最近的同名 team）
          for (let ti = teams.length - 1; ti >= 0; ti--) {
            if (teams[ti].name === teamName && !teams[ti].endTime) { targetIdx = ti; break; }
          }
        }
        // fallback：如果没有 team_name 但有唯一打开的 team
        if (targetIdx < 0 && currentTeamIdx >= 0) targetIdx = currentTeamIdx;
        if (targetIdx >= 0) {
          const t = teams[targetIdx];
          if (!t._teammates.has(agentName)) { t._teammates.add(agentName); t.teammateCount++; }
        }
      }
    }
  }
  // 后处理：为未关闭的 team 推断 endTime
  for (const team of teams) {
    if (team.endTime) continue;
    // 优先使用 shutdown_request 时间戳，其次使用最后一条请求的时间戳
    if (team._lastShutdownTime) {
      team.endTime = team._lastShutdownTime;
      team.endRequestIndex = team._lastShutdownRequestIdx;
      team._inferredEnd = true;
    } else {
      const lastReq = requests[requests.length - 1];
      const lastTs = lastReq?.response?.timestamp || lastReq?.timestamp;
      if (lastTs && team.startTime !== lastTs) {
        team.endTime = lastTs;
        team.endRequestIndex = requests.length - 1;
        team._inferredEnd = true;
      }
    }
  }
  return teams;
}
