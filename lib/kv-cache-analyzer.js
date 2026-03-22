/**
 * Server-side KV-Cache content analyzer.
 * Ported from src/utils/helpers.js + src/utils/contentFilter.js
 */

const SUBAGENT_SYSTEM_RE = /command execution specialist|file search specialist|planning specialist|general-purpose agent/i;
const TEAMMATE_SYSTEM_RE = /running as an agent in a team|Agent Teammate Communication/i;

function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

/**
 * Determine if a log entry is from the MainAgent (not a teammate or subagent).
 */
export function isMainAgentEntry(entry) {
  if (!entry) return false;

  // Teammate subprocess requests are not MainAgent
  if (entry.teammate) return false;
  const sysText = getSystemText(entry.body || {});
  if (TEAMMATE_SYSTEM_RE.test(sysText)) return false;

  if (entry.mainAgent === true) {
    if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
    return true;
  }

  // Fallback detection for entries without mainAgent flag
  const body = entry.body || {};
  if (!body.system || !Array.isArray(body.tools)) return false;

  if (!sysText.includes('You are Claude Code')) return false;
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;

  // New architecture (v2.1.69+): deferred tool loading
  const isSystemArray = Array.isArray(body.system);
  const hasToolSearch = body.tools.some(t => t.name === 'ToolSearch');
  if (isSystemArray && hasToolSearch) {
    const messages = body.messages || [];
    const firstMsgContent = messages.length > 0
      ? (typeof messages[0].content === 'string' ? messages[0].content
        : Array.isArray(messages[0].content) ? messages[0].content.map(c => c.text || '').join('') : '')
      : '';
    if (firstMsgContent.includes('<available-deferred-tools>')) return true;
  }

  // v2.1.81+: lightweight MainAgent may have < 10 tools, lowered threshold
  if (body.tools.length > 5) {
    const hasEdit = body.tools.some(t => t.name === 'Edit');
    const hasBash = body.tools.some(t => t.name === 'Bash');
    const hasTaskOrAgent = body.tools.some(t => t.name === 'Task' || t.name === 'Agent');
    if (hasEdit && hasBash && hasTaskOrAgent) return true;
  }

  return false;
}

/**
 * Extract text from a tool_result content block.
 */
export function extractToolResultText(toolResult) {
  if (!toolResult.content) return String(toolResult.content ?? '');
  if (typeof toolResult.content === 'string') return toolResult.content;
  if (Array.isArray(toolResult.content)) {
    return toolResult.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }
  return JSON.stringify(toolResult.content);
}

/**
 * Extract cached content from a single log entry (MainAgent or SubAgent).
 * Returns null if the entry has no body; returns object with empty arrays
 * if no cache_control markers are found.
 */
export function extractCachedContent(entry) {
  if (!entry?.body) return null;

  const body = entry.body;
  const usage = entry.response?.body?.usage;

  const result = {
    system: [],
    messages: [],
    tools: [],
    cacheCreateTokens: usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
  };

  // system: find last block with cache_control, collect 0..lastIndex
  if (Array.isArray(body.system)) {
    let lastCacheIndex = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i].cache_control) { lastCacheIndex = i; break; }
    }
    if (lastCacheIndex >= 0) {
      for (let i = 0; i <= lastCacheIndex; i++) {
        const block = body.system[i];
        if (block.type === 'text' && block.text) result.system.push(block.text);
      }
    }
  }

  // messages: find last message with cache_control in content, collect 0..lastIndex
  if (Array.isArray(body.messages)) {
    let lastCacheIndex = -1;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const content = body.messages[i].content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.cache_control) { lastCacheIndex = i; break; }
        }
        if (lastCacheIndex >= 0) break;
      }
    }
    if (lastCacheIndex >= 0) {
      for (let i = 0; i <= lastCacheIndex; i++) {
        const msg = body.messages[i];
        const content = msg.content;
        if (typeof content === 'string') {
          result.messages.push(`[${msg.role}] ${content}`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              result.messages.push(`[${msg.role}] ${block.text}`);
            } else if (block.type === 'tool_result') {
              const toolText = extractToolResultText(block);
              if (toolText) result.messages.push(`[tool_result: ${block.tool_use_id}] ${toolText}`);
            }
          }
        }
      }
    }
  }

  // tools: if any tool has cache_control, all tools are cached
  if (Array.isArray(body.tools)) {
    const hasCache = body.tools.some(tool => tool.cache_control);
    if (hasCache) {
      for (const tool of body.tools) {
        result.tools.push(`${tool.name}: ${tool.description || ''}`);
      }
    }
  }

  return result;
}
