/**
 * Server-side KV-Cache content analyzer.
 * Ported from src/utils/helpers.js + src/utils/contentFilter.js
 */

// --- Tool XML serializer (keep in sync with src/utils/toolsXmlFormatter.js) ---

function indentLines(text, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map((line) => (line.length > 0 ? pad + line : line)).join('\n');
}

function formatToolParameter(name, schema, required) {
  const s = schema && typeof schema === 'object' ? schema : {};
  const type = s.type || (Array.isArray(s.enum) ? 'enum' : 'any');
  const desc = typeof s.description === 'string' ? s.description : '';
  const lines = ['<parameter>', `  <name>${name}</name>`, `  <type>${type}</type>`];
  if (desc) lines.push(`  <description>${desc}</description>`);
  lines.push(`  <required>${required ? 'true' : 'false'}</required>`);
  if (Array.isArray(s.enum) && s.enum.length > 0) {
    lines.push(`  <enum>${s.enum.map((v) => String(v)).join(', ')}</enum>`);
  }
  if (s.default !== undefined) lines.push(`  <default>${JSON.stringify(s.default)}</default>`);
  if (type === 'array' && s.items) lines.push(`  <items>${JSON.stringify(s.items)}</items>`);
  if (type === 'object' && s.properties) lines.push(`  <properties>${JSON.stringify(s.properties)}</properties>`);
  lines.push('</parameter>');
  return lines.join('\n');
}

export function formatToolAsXml(tool) {
  if (!tool || typeof tool !== 'object') return '';
  const name = tool.name || 'unknown';
  const description = typeof tool.description === 'string' ? tool.description : '';
  const schema = tool.input_schema || tool.parameters || {};
  const properties = schema && typeof schema === 'object' && schema.properties ? schema.properties : {};
  const requiredSet = new Set(Array.isArray(schema && schema.required) ? schema.required : []);
  const paramXmls = Object.entries(properties).map(([paramName, paramSchema]) =>
    formatToolParameter(paramName, paramSchema, requiredSet.has(paramName))
  );
  const parametersBlock = paramXmls.length > 0
    ? '<parameters>\n' + indentLines(paramXmls.join('\n')) + '\n</parameters>'
    : '<parameters></parameters>';
  const body = [`<name>${name}</name>`, `<description>${description}</description>`, parametersBlock].join('\n');
  return '<tool>\n' + indentLines(body) + '\n</tool>';
}

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
  // Fallback: delta reconstruction + slim restore may lose cache_control markers,
  // but cacheReadTokens > 0 proves messages were cached — extract all as approximation
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
    if (lastCacheIndex < 0 && result.cacheReadTokens > 0 && body.messages.length > 0) {
      lastCacheIndex = body.messages.length - 1;
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
            } else if (block.type === 'tool_use') {
              const inputStr = block.input ? JSON.stringify(block.input) : '';
              const preview = inputStr.length > 200 ? inputStr.substring(0, 200) + '...' : inputStr;
              result.messages.push(`[${msg.role}] ${block.name}(${preview})`);
            } else if (block.type === 'tool_result') {
              const toolText = extractToolResultText(block);
              if (toolText) result.messages.push(`[tool_result: ${block.tool_use_id}] ${toolText}`);
            }
          }
        }
      }
    }
  }

  // tools: API caches in order tools → system → messages.
  // Tools are implicitly cached as part of the prefix (no cache_control needed on tools themselves).
  // Show tools when system has cached content (indicating a cache prefix exists).
  // Keep in sync with src/utils/helpers.js extractCachedContent
  if (Array.isArray(body.tools) && body.tools.length > 0 && result.system.length > 0) {
    for (const tool of body.tools) {
      result.tools.push(formatToolAsXml(tool));
    }
  }

  return result;
}
