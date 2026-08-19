/**
 * Web search rendering helpers.
 *
 * Anthropic 的 server-side web_search 工具在 assistant message 的 content 数组里
 * 直接放两个兄弟块：server_tool_use（搜索发起）+ web_search_tool_result（结果）。
 * 紧随其后的 text 块（含带 citations 的）是模型基于结果生成的综合回复。
 *
 * 本文件提供：
 *   - extractWebSearchGroups(content): 识别 [server_tool_use, web_search_tool_result, ...synthesis text]
 *     子序列，返回 groups + content 全局 index 的 consumedIndices Set。
 *   - safeHref(url): URL 协议白名单（仅 http/https），防 javascript:/data:/file:// 协议 XSS。
 *   - getHostname(url): try/catch 包装的 new URL(url).hostname。
 *
 * 设计上故意做成纯 JS（无 React/CSS 依赖），让 Node test runner 能直接 import。
 */

export function extractWebSearchGroups(content) {
  const groups = [];
  const consumedIndices = new Set();

  if (!Array.isArray(content) || content.length === 0) {
    return { groups, consumedIndices };
  }

  for (let i = 0; i < content.length; i++) {
    const block = content[i];
    if (!block || typeof block !== 'object') continue;

    if (block.type === 'server_tool_use') {
      let resultIdx = -1;
      for (let j = i + 1; j < content.length; j++) {
        const b = content[j];
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'thinking') continue;
        if (b.type === 'web_search_tool_result' && b.tool_use_id === block.id) {
          resultIdx = j;
        }
        break;
      }

      if (resultIdx === -1) {
        groups.push({
          serverToolUseIndex: i,
          serverToolUse: block,
          webSearchResultIndex: -1,
          webSearchResult: null,
          synthesisTextIndices: [],
        });
        consumedIndices.add(i);
        continue;
      }

      const synthesisIndices = [];
      for (let k = resultIdx + 1; k < content.length; k++) {
        const b = content[k];
        if (!b || typeof b !== 'object') break;
        if (b.type === 'text') {
          synthesisIndices.push(k);
          continue;
        }
        if (b.type === 'thinking') break;
        if (b.type === 'tool_use' || b.type === 'server_tool_use') break;
        break;
      }

      groups.push({
        serverToolUseIndex: i,
        serverToolUse: block,
        webSearchResultIndex: resultIdx,
        webSearchResult: content[resultIdx],
        synthesisTextIndices: synthesisIndices,
      });
      consumedIndices.add(i);
      consumedIndices.add(resultIdx);
      for (const k of synthesisIndices) consumedIndices.add(k);
    } else if (block.type === 'web_search_tool_result') {
      if (consumedIndices.has(i)) continue;
      groups.push({
        serverToolUseIndex: -1,
        serverToolUse: null,
        webSearchResultIndex: i,
        webSearchResult: block,
        synthesisTextIndices: [],
      });
      consumedIndices.add(i);
    }
  }

  return { groups, consumedIndices };
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

export function safeHref(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    return SAFE_PROTOCOLS.has(u.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function getHostname(url) {
  if (typeof url !== 'string' || !url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return url.length > 40 ? url.slice(0, 40) + '…' : url;
  }
}
