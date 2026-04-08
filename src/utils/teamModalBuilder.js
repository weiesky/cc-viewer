/**
 * Build team modal visualization data from requests and sessions.
 * Pure function — no React/state dependencies.
 */

import { classifyUserContent, isSystemText, isMainAgent } from './contentFilter';
import { restoreSlimmedEntry } from './entry-slim.js';
import { classifyRequest, formatRequestTag, formatTeammateLabel } from './requestType';
import { getModelInfo } from './helpers';
import { getTeammateAvatar } from './teammateAvatars';

export function buildTeamModalData(team, requests, mainAgentSessions) {
  const startIdx = team.requestIndex;
  const endIdx = team.endRequestIndex != null ? team.endRequestIndex + 1 : requests.length;
  const teamRequests = requests.slice(startIdx, endIdx);
  const teamStartTime = team.startTime;
  const teamEndTime = team.endTime || (requests[endIdx - 1]?.response?.timestamp || requests[endIdx - 1]?.timestamp);

  // 构建 tsToIndex 和 modelInfo
  const tsToIndex = {};
  let modelName = null;
  for (let i = startIdx; i < endIdx && i < requests.length; i++) {
    const req = requests[i];
    if (req.timestamp) tsToIndex[req.timestamp] = i;
    if (req.body?.model) modelName = req.body.model;
  }
  const modelInfo = getModelInfo(modelName);

  // 用户消息提取：展示触发 team 的用户 prompt，帮助理解 team 要解决什么问题。
  const entries = [];
  let hasUserMsg = false;

  // 策略 1：从 mainAgentSessions 按时间范围提取
  if (mainAgentSessions) {
    let closestBeforeTs = null;
    for (const session of mainAgentSessions) {
      for (const msg of session.messages || []) {
        const ts = msg._timestamp;
        if (!ts || msg.role !== 'user') continue;
        if (ts <= teamStartTime && (!closestBeforeTs || ts > closestBeforeTs)) {
          closestBeforeTs = ts;
        }
      }
    }
    const effectiveStart = closestBeforeTs || teamStartTime;
    for (const session of mainAgentSessions) {
      for (const msg of session.messages || []) {
        const ts = msg._timestamp;
        if (!ts || ts < effectiveStart) continue;
        if (teamEndTime && ts > teamEndTime) continue;
        if (msg.role !== 'user') continue;
        const content = msg.content;
        if (Array.isArray(content)) {
          const { textBlocks } = classifyUserContent(content);
          for (const tb of textBlocks) {
            if (tb.text && tb.text.trim()) {
              entries.push({ type: 'user', text: tb.text, timestamp: ts });
              hasUserMsg = true;
            }
          }
        } else if (typeof content === 'string' && !isSystemText(content)) {
          entries.push({ type: 'user', text: content, timestamp: ts });
          hasUserMsg = true;
        }
      }
    }
  }

  // 策略 2：从 TeamCreate request 的 body.messages 直接提取
  if (!hasUserMsg) {
    const tcRaw = requests[team.requestIndex];
    const tcReq = tcRaw?._slimmed ? restoreSlimmedEntry(tcRaw, requests) : tcRaw;
    const tcMsgs = tcReq?.body?.messages || [];
    for (let m = tcMsgs.length - 1; m >= 0; m--) {
      if (tcMsgs[m].role !== 'user') continue;
      const c = tcMsgs[m].content;
      if (Array.isArray(c)) {
        const { textBlocks } = classifyUserContent(c);
        for (const tb of textBlocks) {
          if (tb.text && tb.text.trim()) {
            entries.push({ type: 'user', text: tb.text, timestamp: teamStartTime });
            hasUserMsg = true;
          }
        }
      } else if (typeof c === 'string' && !isSystemText(c)) {
        entries.push({ type: 'user', text: c, timestamp: teamStartTime });
        hasUserMsg = true;
      }
      if (hasUserMsg) break;
    }
  }

  // 策略 3 兜底：/clear 后 messages=[] 时，用首条 assistant 文本作为上下文
  if (!hasUserMsg) {
    for (let i = 0; i < teamRequests.length; i++) {
      const resp = teamRequests[i].response?.body?.content;
      if (!Array.isArray(resp)) continue;
      for (const block of resp) {
        if (block.type === 'text' && block.text && block.text.trim()) {
          entries.push({ type: 'context', text: block.text.trim(), timestamp: teamRequests[i].response?.timestamp || teamRequests[i].timestamp });
          hasUserMsg = true;
          break;
        }
      }
      if (hasUserMsg) break;
    }
  }

  // 收集 assistant + sub-agent 条目
  for (let i = 0; i < teamRequests.length; i++) {
    const req = teamRequests[i];
    const respContent = req.response?.body?.content;
    if (!Array.isArray(respContent) || respContent.length === 0) continue;
    const cls = classifyRequest(req, teamRequests[i + 1]);
    const isMA = isMainAgent(req);
    const isSub = cls.type === 'SubAgent' || cls.type === 'Teammate';

    if (isMA) {
      entries.push({ type: 'assistant', content: respContent, timestamp: req.response?.timestamp || req.timestamp, requestIndex: startIdx + i, modelInfo });
    } else if (isSub) {
      const subToolResultMap = {};
      const msgs = req.body?.messages || [];
      for (const msg of msgs) {
        if (msg.role === 'tool_result' || (msg.role === 'user' && Array.isArray(msg.content))) {
          const blocks = Array.isArray(msg.content) ? msg.content : [msg];
          for (const b of blocks) {
            if (b.type === 'tool_result' && b.tool_use_id) {
              subToolResultMap[b.tool_use_id] = { resultText: typeof b.content === 'string' ? b.content : JSON.stringify(b.content) };
            }
          }
        }
      }
      entries.push({
        type: 'sub-agent',
        content: respContent,
        toolResultMap: subToolResultMap,
        label: cls.type === 'Teammate' ? formatTeammateLabel(cls.subType, req.body?.model) : formatRequestTag(cls.type, cls.subType),
        isTeammate: cls.type === 'Teammate',
        timestamp: req.timestamp,
        requestIndex: startIdx + i,
      });
    }
  }

  // 按时间排序
  entries.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));

  // 提取每个 agent 的时间数据（用于状态卡片和甘特图）
  const palette = ['#1668dc', '#52c41a', '#faad14', '#eb2f96', '#722ed1', '#13c2c2', '#fa541c', '#2f54eb'];
  const teamAgents = [];
  const agentMap = new Map();
  const teamTotalStart = new Date(teamStartTime).getTime();
  const teamTotalEnd = new Date(teamEndTime || Date.now()).getTime();
  const leadSegments = [];
  let lastLeadTs = teamTotalStart;
  const _taskCreateSubjects = new Map();
  const _taskOwnerMap = new Map();
  let _taskCreateCounter = 1;

  for (let i = 0; i < teamRequests.length; i++) {
    const req = teamRequests[i];
    const resp = req.response?.body?.content;
    if (!Array.isArray(resp)) continue;
    const tsStr = req.response?.timestamp || req.timestamp;
    const ts = tsStr;
    const tsMs = new Date(tsStr).getTime();
    const isMA = isMainAgent(req);
    for (const block of resp) {
      if (block.type !== 'tool_use') continue;
      const n = block.name;
      const inp = typeof block.input === 'string' ? (() => { try { return JSON.parse(block.input); } catch { return {}; } })() : (block.input || {});
      if (n === 'Agent' && inp.name) {
        const idx = teamAgents.length;
        teamAgents.push({
          name: inp.name,
          color: palette[idx % palette.length],
          type: inp.subagent_type?.split(':').pop() || '',
          spawnTime: ts,
          claimTime: null,
          doneTime: null,
          shutdownTime: null,
          taskSubject: null,
          events: [{ ts: tsMs, label: 'spawn' }],
        });
        agentMap.set(inp.name, idx);
      } else if (n === 'TaskCreate') {
        if (inp.subject) {
          const tId = String(inp.taskId || _taskCreateCounter++);
          _taskCreateSubjects.set(tId, inp.subject);
        }
      } else if (n === 'TaskUpdate') {
        const owner = inp.owner;
        const taskId = inp.taskId != null ? String(inp.taskId) : null;
        if (owner && taskId) _taskOwnerMap.set(taskId, owner);

        let targetAg = null;
        if (owner && agentMap.has(owner)) {
          targetAg = teamAgents[agentMap.get(owner)];
        } else if (taskId) {
          const prevOwner = _taskOwnerMap.get(taskId);
          if (prevOwner && agentMap.has(prevOwner)) {
            targetAg = teamAgents[agentMap.get(prevOwner)];
          } else {
            const taskNum = parseInt(taskId, 10);
            if (taskNum > 0 && taskNum <= teamAgents.length) {
              targetAg = teamAgents[taskNum - 1];
              _taskOwnerMap.set(taskId, targetAg.name);
            }
          }
        }
        if (targetAg) {
          if (inp.status === 'in_progress' && !targetAg.claimTime) {
            targetAg.claimTime = ts;
            targetAg.events.push({ ts: tsMs, label: 'claim' });
          }
          if (inp.status === 'completed' && !targetAg.doneTime) {
            targetAg.doneTime = ts;
            targetAg.events.push({ ts: tsMs, label: 'done' });
          }
          if (taskId && _taskCreateSubjects.has(taskId) && !targetAg.taskSubject) {
            targetAg.taskSubject = _taskCreateSubjects.get(taskId);
          }
        }
      } else if (n === 'SendMessage') {
        if (inp.message?.type === 'shutdown_request' && inp.to && agentMap.has(inp.to)) {
          const ag = teamAgents[agentMap.get(inp.to)];
          ag.shutdownTime = ts;
          ag.events.push({ ts: tsMs, label: 'shutdown' });
        } else if (inp.message?.type === 'shutdown_response' && agentMap.has(inp.to === 'team-lead' ? '' : inp.to)) {
          // skip
        } else if (inp.to && inp.to !== 'team-lead' && agentMap.has(inp.to)) {
          teamAgents[agentMap.get(inp.to)].events.push({ ts: tsMs, label: 'msg-in' });
        } else if (inp.to === 'team-lead') {
          if (typeof inp.message === 'string' || (inp.message && !inp.message.type)) {
            if (tsMs > lastLeadTs) {
              leadSegments.push({ start: lastLeadTs, end: tsMs, label: 'report-received', color: '#52c41a' });
              lastLeadTs = tsMs;
            }
          }
        }
      }
      if (isMA && (n === 'TeamCreate' || n === 'TaskCreate' || n === 'Agent' || n === 'SendMessage' || n === 'TeamDelete')) {
        const label = n === 'TeamCreate' ? 'create' : n === 'TaskCreate' ? 'tasks' : n === 'Agent' ? 'spawn' : n === 'SendMessage' ? 'msg' : 'cleanup';
        if (tsMs > lastLeadTs) {
          leadSegments.push({ start: lastLeadTs, end: tsMs, label, color: n === 'TeamDelete' ? '#52c41a' : n === 'SendMessage' ? '#ff4d4f' : '#1668dc' });
          lastLeadTs = tsMs;
        }
      }
    }
    if (isMA) {
      for (const block of resp) {
        if (block.type === 'text' && block.text) {
          if (tsMs > lastLeadTs) {
            leadSegments.push({ start: lastLeadTs, end: tsMs, label: 'text', color: '#196ae1' });
            lastLeadTs = tsMs;
          }
        } else if (block.type === 'thinking') {
          if (tsMs > lastLeadTs) {
            leadSegments.push({ start: lastLeadTs, end: tsMs, label: 'thinking', color: '#722ed1' });
            lastLeadTs = tsMs;
          }
        }
      }
    }
  }
  // Second pass: teammate own tool calls (non-MainAgent requests)
  for (let i = 0; i < teamRequests.length; i++) {
    const req = teamRequests[i];
    if (isMainAgent(req)) continue;
    const resp = req.response?.body?.content;
    if (!Array.isArray(resp)) continue;
    const tsStr = req.response?.timestamp || req.timestamp;
    const tsMs = new Date(tsStr).getTime();
    const cls = classifyRequest(req, teamRequests[i + 1]);
    const label = cls.type === 'Teammate' ? cls.subType : null;
    if (label) {
      let agIdx = agentMap.has(label) ? agentMap.get(label) : undefined;
      if (agIdx === undefined) {
        for (const [name, idx] of agentMap) {
          if (label.includes(name) || name.includes(label)) { agIdx = idx; break; }
        }
      }
      if (agIdx !== undefined) {
        const ag = teamAgents[agIdx];
        for (const block of resp) {
          if (block.type === 'tool_use' && block.name) {
            ag.events.push({ ts: tsMs, label: 'tool:' + block.name });
          }
        }
      }
    }
  }

  // 提取 <teammate-message> 报告内容
  const teammateMessageRe = /<teammate-message\s+teammate_id="([^"]+)"[^>]*summary="([^"]*)"[^>]*>([\s\S]*?)<\/teammate-message>/g;
  const seenTmMsg = new Set();
  teamAgents.forEach(ag => { ag.teammateMessages = []; });
  for (let i = 0; i < teamRequests.length; i++) {
    const raw = teamRequests[i];
    const req = raw?._slimmed ? restoreSlimmedEntry(raw, requests) : raw;
    const msgs = req.body?.messages || [];
    for (const m of msgs) {
      if (m.role !== 'user' || !Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b.type !== 'text' || !b.text) continue;
        let match;
        teammateMessageRe.lastIndex = 0;
        while ((match = teammateMessageRe.exec(b.text)) !== null) {
          const [, tid, summary, content] = match;
          if (tid === 'system' || tid === 'team-lead') continue;
          const dedupKey = tid + '|' + summary + '|' + content.trim().slice(0, 100);
          if (seenTmMsg.has(dedupKey)) continue;
          seenTmMsg.add(dedupKey);
          for (const ag of teamAgents) {
            if (tid === ag.name || tid.includes(ag.name) || ag.name.includes(tid)) {
              if (summary && content.trim()) {
                ag.teammateMessages.push({ summary, content: content.trim() });
                const reqTs = req.timestamp || req.response?.timestamp;
                entries.push({ type: 'teammate-report', agentName: ag.name, agentColor: getTeammateAvatar(ag.name).color, summary, content: content.trim(), timestamp: reqTs });
              }
              break;
            }
          }
        }
      }
    }
  }

  // 闭合 lead 最后一段
  if (lastLeadTs < teamTotalEnd) {
    leadSegments.push({ start: lastLeadTs, end: teamTotalEnd, label: 'idle', color: '#333' });
  }

  // 从事件节点构建每个 agent 的分段 + 计算持续时间
  const segColors = { spawn: '#555', claim: '#faad14', done: '#52c41a', shutdown: '#ff4d4f', 'msg-in': '#1668dc', report: '#52c41a', 'report-received': '#52c41a', text: '#196ae1', thinking: '#722ed1' };
  teamAgents.forEach(ag => {
    const start = new Date(ag.spawnTime).getTime();
    const end = new Date(ag.doneTime || ag.shutdownTime || teamEndTime || Date.now()).getTime();
    ag.duration = end - start;
    ag.events.sort((a, b) => a.ts - b.ts);
    ag.segments = [];
    for (let e = 0; e < ag.events.length; e++) {
      const ev = ag.events[e];
      const nextTs = ag.events[e + 1]?.ts || (ag.shutdownTime ? new Date(ag.shutdownTime).getTime() : teamTotalEnd);
      ag.segments.push({ start: ev.ts, end: nextTs, label: ev.label, color: segColors[ev.label] || (ev.label.startsWith('tool:') ? '#888' : ag.color) });
    }
  });

  return { entries, teamAgents, leadSegments, teamTotalStart, teamTotalEnd, modelInfo, teamRequests };
}
