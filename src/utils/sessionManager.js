export const HOT_SESSION_COUNT = 8;

/**
 * 构建轻量 session 索引。
 * 遍历 entries 按 _sessionId 分组统计 firstTs/lastTs/entryCount。
 * 遍历 mainAgentSessions 提取 msgCount/preview/userId。
 * @param {Array} entries - 已标记 _sessionId 的 entries
 * @param {Array} mainAgentSessions - _processEntries 产出的 sessions
 * @returns {Array} sessionIndex
 */
export function buildSessionIndex(entries, mainAgentSessions) {
  // 按 _sessionId 分组统计 entry 级别的 firstTs/lastTs/entryCount
  const groupMap = new Map();
  for (const entry of entries) {
    const id = entry._sessionId;
    if (id == null) continue;
    const ts = entry.timestamp || null;
    let g = groupMap.get(id);
    if (!g) {
      g = { firstTs: ts, lastTs: ts, entryCount: 0 };
      groupMap.set(id, g);
    }
    g.entryCount++;
    if (ts) {
      if (!g.firstTs || ts < g.firstTs) g.firstTs = ts;
      if (!g.lastTs || ts > g.lastTs) g.lastTs = ts;
    }
  }

  // 合并 mainAgentSessions 的信息：按 session 顺序遍历
  // _sessionId 按时间排序，与 mainAgentSessions 的顺序一致
  const sortedGroupKeys = Array.from(groupMap.keys()).sort();
  const result = [];

  for (let i = 0; i < mainAgentSessions.length; i++) {
    const session = mainAgentSessions[i];
    // 用 groupMap 的排序 key 对齐 session（而非 session.entryTimestamp，后者会被更新为最后一条 entry 的 timestamp）
    const sessionId = sortedGroupKeys[i] || session?.entryTimestamp || null;
    const g = sessionId ? (groupMap.get(sessionId) || { firstTs: null, lastTs: null, entryCount: 0 }) : { firstTs: null, lastTs: null, entryCount: 0 };

    let msgCount = 0;
    let preview = '';
    let userId = null;

    if (session) {
      msgCount = session.messages ? session.messages.length : 0;
      userId = session.userId || null;
      // preview: 第一条 role==='user' 的 message 的 text content 前 80 字符
      if (session.messages) {
        for (const msg of session.messages) {
          if (msg.role === 'user') {
            const text = extractTextContent(msg);
            if (text) {
              preview = text.slice(0, 80);
              break;
            }
          }
        }
      }
    }

    result.push({
      sessionId,
      firstTs: g.firstTs,
      lastTs: g.lastTs || session?.entryTimestamp || null,
      entryCount: g.entryCount,
      msgCount,
      preview,
      userId,
    });
  }

  return result;
}

/**
 * 从 message 中提取 text content。
 */
function extractTextContent(msg) {
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    for (const block of msg.content) {
      if (block.type === 'text' && block.text) return block.text;
    }
  }
  return '';
}

/**
 * 分离热/冷数据。
 * @param {Array} entries - 全量 entries
 * @param {Array} mainAgentSessions - 全量 sessions
 * @param {Array} sessionIndex - buildSessionIndex 的输出
 * @param {number} hotCount - 热 session 数量
 * @param {Set} pinnedSessionIds - 强制为热的 sessionId 集合（不参与淘汰）
 * @returns {{ hotEntries, allSessions, coldGroups: Map<string, Array> }}
 */
export function splitHotCold(entries, mainAgentSessions, sessionIndex, hotCount, pinnedSessionIds = new Set()) {
  const totalSessions = sessionIndex.length;
  if (totalSessions <= hotCount) {
    return { hotEntries: entries, allSessions: mainAgentSessions, coldGroups: new Map() };
  }

  // 计算哪些 sessionId 是热的：最新 hotCount 个 + pinned
  // sessionIndex 按顺序排列，最新的在末尾
  const hotSessionIds = new Set(pinnedSessionIds);
  // 从末尾开始填充热 slot，跳过已 pinned 的
  let remaining = hotCount - hotSessionIds.size;
  for (let i = sessionIndex.length - 1; i >= 0 && remaining > 0; i--) {
    const sid = sessionIndex[i].sessionId;
    if (!hotSessionIds.has(sid)) {
      hotSessionIds.add(sid);
      remaining--;
    }
  }

  // 分离 entries
  const hotEntries = [];
  const coldGroups = new Map();
  for (const entry of entries) {
    if (hotSessionIds.has(entry._sessionId)) {
      hotEntries.push(entry);
    } else {
      let group = coldGroups.get(entry._sessionId);
      if (!group) {
        group = [];
        coldGroups.set(entry._sessionId, group);
      }
      group.push(entry);
    }
  }

  // 构建 allSessions：冷 session 替换为占位符
  const allSessions = mainAgentSessions.map((session, i) => {
    const meta = sessionIndex[i];
    const sid = meta?.sessionId;
    if (sid && !hotSessionIds.has(sid)) {
      return {
        _cold: true,
        sessionId: sid,
        preview: meta.preview,
        msgCount: meta.msgCount,
        firstTs: meta.firstTs,
        lastTs: meta.lastTs,
        userId: meta.userId,
        messages: null,
        response: null,
        entryTimestamp: meta.lastTs,
      };
    }
    return session;
  });

  return { hotEntries, allSessions, coldGroups };
}

/**
 * 合并两个 sessionIndex（用于 loadMoreHistory 后合并旧索引和新索引）。
 * 策略：新索引完全覆盖重叠的 sessionId，旧索引中不在新索引范围内的保留。
 * @param {Array} oldIndex - 旧索引（可能包含更早的 cold session 信息）
 * @param {Array} newIndex - 新索引（从最新的 merged entries 构建）
 * @returns {Array} 合并后的完整索引
 */
export function mergeSessionIndices(oldIndex, newIndex) {
  if (!oldIndex || oldIndex.length === 0) return newIndex || [];
  if (!newIndex || newIndex.length === 0) return oldIndex;

  // 新索引覆盖的 sessionId 范围
  const newIdSet = new Set(newIndex.map(s => s.sessionId));

  // 从旧索引中保留不在新索引范围内的条目
  const merged = [];
  for (const item of oldIndex) {
    if (!newIdSet.has(item.sessionId)) {
      merged.push(item);
    }
  }

  // 添加新索引的所有条目
  for (const item of newIndex) {
    merged.push(item);
  }

  // 按 sessionId (timestamp string) 排序
  merged.sort((a, b) => {
    if (a.sessionId === b.sessionId) return 0;
    if (a.sessionId == null) return -1;
    if (b.sessionId == null) return 1;
    return a.sessionId < b.sessionId ? -1 : 1;
  });

  return merged;
}
