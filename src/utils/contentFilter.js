// 内容分类与过滤规则
// ChatView（对话模式）和 AppHeader（用户 Prompt 弹窗）共用此模块，确保过滤逻辑一致。
// MainAgent / Teammate 判断也收敛于此，供全局统一调用。

// ============== 请求体辅助 ==============

const SUBAGENT_SYSTEM_RE = /command execution specialist|file search specialist|planning specialist|general-purpose agent/i;

// Teammate 检测：system prompt 中包含 Agent Teammate Communication 标记
const TEAMMATE_SYSTEM_RE = /running as an agent in a team|Agent Teammate Communication/i;

/**
 * 提取请求体中的 system prompt 文本
 */
export function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

// WeakMap cache for isTeammate — avoids redundant getSystemText + regex per request
const _isTeammateCache = new WeakMap();

/**
 * 判断请求是否为 Teammate 子进程的请求。
 * 支持两种检测：interceptor ���式（req.teammate 字段）和 proxy 模式（system prompt 标记）。
 * 全局唯一入口，与 isMainAgent 同级。
 */
export function isTeammate(req) {
  if (!req) return false;
  const cached = _isTeammateCache.get(req);
  if (cached !== undefined) return cached;
  // interceptor 模式：通过 process.argv 写入的 teammate 字段
  if (req.teammate) { _isTeammateCache.set(req, true); return true; }
  // proxy 模式：通过 system prompt 检测
  const sysText = getSystemText(req.body || {});
  const result = TEAMMATE_SYSTEM_RE.test(sysText);
  _isTeammateCache.set(req, result);
  return result;
}

// WeakMap cache for isMainAgent — avoids redundant regex/array work across call sites
const _isMainAgentCache = new WeakMap();

/**
 * 判断请求是否为 MainAgent 请求。
 * 包含 interceptor 标记校验 + 新旧架构检测，全局唯一入口。
 */
export function isMainAgent(req) {
  if (!req) return false;
  const cached = _isMainAgentCache.get(req);
  if (cached !== undefined) return cached;
  const result = _isMainAgentImpl(req);
  _isMainAgentCache.set(req, result);
  return result;
}

function _isMainAgentImpl(req) {
  if (!req) return false;

  // Teammate 子进程的请求不是 MainAgent，避免污染主会话视图
  if (isTeammate(req)) return false;

  if (req.mainAgent) {
    // 排除被误标记的 SubAgent（旧日志兼容）
    const sysText = getSystemText(req.body || {});
    if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;
    return true;
  }

  // 统一检测逻辑：支持新旧架构
  const body = req.body || {};
  if (!body.system || !Array.isArray(body.tools)) return false;

  const sysText = getSystemText(body);

  // 必须包含 MainAgent 身份标识
  if (!sysText.includes('You are Claude Code')) return false;

  // 排除 SubAgent
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;

  // 新架构检测（v2.1.69+）：延迟工具加载机制
  const isSystemArray = Array.isArray(body.system);
  const hasToolSearch = body.tools.some(t => t.name === 'ToolSearch');

  if (isSystemArray && hasToolSearch) {
    // 检查第一条消息是否包含 <available-deferred-tools>
    const messages = body.messages || [];
    const firstMsgContent = messages.length > 0 ?
      (typeof messages[0].content === 'string' ? messages[0].content :
       Array.isArray(messages[0].content) ? messages[0].content.map(c => c.text || '').join('') : '') : '';
    if (firstMsgContent.includes('<available-deferred-tools>')) {
      return true;
    }
  }

  // v2.1.81+: 轻量 MainAgent 初始请求工具数可能 < 10，降低阈值兼容
  if (body.tools.length > 5) {
    const hasEdit = body.tools.some(t => t.name === 'Edit');
    const hasBash = body.tools.some(t => t.name === 'Bash');
    const hasTaskOrAgent = body.tools.some(t => t.name === 'Task' || t.name === 'Agent');
    if (hasEdit && hasBash && hasTaskOrAgent) {
      return true;
    }
  }

  return false;
}

// ============== 文本内容过滤 ==============

/**
 * 判断文本是否为 Skill 加载内容
 */
export function isSkillText(text) {
  if (!text) return false;
  return /^Base directory for this skill:/i.test(text.trim());
}

/**
 * 判断文本是否为系统注入文本（不应作为用户消息展示）
 */
export function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  // 包含 plan 内容的文本块不应被过滤（即使开头有系统标签）
  if (/Implement the following plan:/i.test(trimmed)) return false;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true;
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  // Claude Code 输出截断时注入的系统消息
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  // Skill 加载的文档内容
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  return false;
}

/**
 * 从 user message 的 content 数组中分类提取各类文本块。
 * @param {Array} content — message.content 数组
 * @returns {{ commands: string[], textBlocks: Array, skillBlocks: Array }}
 *   commands    — 提取到的 slash command 名称（如 "/clear"）
 *   textBlocks  — 过滤后的普通用户文本块（不含系统文本、command 块、skill 块）
 *   skillBlocks — skill 加载的文本块
 */
export function classifyUserContent(content) {
  if (!Array.isArray(content)) return { commands: [], textBlocks: [], skillBlocks: [] };

  const hasCommand = content.some(b => b.type === 'text' && /<command-message>/i.test(b.text || ''));

  // 提取 slash command 名称
  const commands = [];
  if (hasCommand) {
    for (const b of content) {
      if (b.type !== 'text') continue;
      const m = (b.text || '').match(/<command-name>\s*([^<]*)<\/command-name>/i);
      if (m) {
        const cmd = m[1].trim();
        commands.push(cmd.startsWith('/') ? cmd : `/${cmd}`);
      }
    }
  }

  // 过滤出非系统文本块
  let textBlocks = content.filter(b => b.type === 'text' && !isSystemText(b.text));

  // 过滤掉 command 相关块
  if (hasCommand) {
    textBlocks = textBlocks.filter(b => !/<command-message>/i.test(b.text || ''));
  }

  // 分离 skill 块
  const skillBlocks = textBlocks.filter(b => isSkillText(b.text));
  if (skillBlocks.length > 0) {
    textBlocks = textBlocks.filter(b => !isSkillText(b.text));
  }

  return { commands, textBlocks, skillBlocks };
}

/**
 * 从 teammate 请求的 messages 中提取名字。
 * 扫描 SendMessage 的 tool_result，查找 routing.sender 字段。
 */
export function extractTeammateName(body) {
  const msgs = body?.messages;
  if (!Array.isArray(msgs)) return null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const content = msgs[i].content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      const items = Array.isArray(block.content) ? block.content : [block];
      for (const item of items) {
        const text = item.text || (typeof item.content === 'string' ? item.content : '');
        if (!text || !text.includes('"sender"')) continue;
        try {
          const parsed = JSON.parse(text);
          if (parsed?.routing?.sender) return parsed.routing.sender;
        } catch { /* not JSON, skip */ }
      }
    }
  }
  return null;
}
