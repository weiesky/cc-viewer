/**
 * 请求类型分类工具
 * classifyRequest(req, nextReq?) 返回 { type, subType }
 * type: 'MainAgent' | 'SubAgent' | 'Teammate' | 'Count' | 'Preflight' | 'Plan' | 'Synthetic'
 *
 * Synthetic: Claude Code CLI 在主会话里合成的内部工具查询
 * （idle 返回 recap / 会话标题生成 / 压缩摘要等），HTTP 层 role=user 但并非用户手输。
 * subType: 'Recap' | 'Title' | 'Compact' | 'Topic' | 'Summary'
 */
// SYNTHETIC_PROMPTS 已抬到 contentFilter.js，让 isSystemText 也能共用（ChatView 字符串分支过滤）。
// requestType.js 继续维护 getSyntheticSubType —— 走的是"last user message + isMainAgent 门槛"的更强
// 形式判断（用于 RequestList 打 Synthetic tag）；isSystemText 走的是"纯文本起首匹配"（用于对话流隐藏）。
import { isMainAgent, isTeammate, getSystemText, extractTeammateName, SYNTHETIC_PROMPTS } from './contentFilter';

function getMessageText(msg) {
  const c = msg?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    for (const block of c) {
      if (block?.type === 'text' && block.text) return block.text;
    }
  }
  return '';
}

function getSubAgentSubType(req) {
  const body = req.body || {};
  const sysText = getSystemText(body);

  if (/Extract any file paths/i.test(sysText)) return 'Bash';
  if (/process Bash commands/i.test(sysText)) return 'Bash';
  if (/command execution specialist/i.test(sysText)) return 'Bash';
  if (/file search specialist/i.test(sysText)) return 'Search';
  if (/planning specialist/i.test(sysText)) return 'Plan';
  if (/general-purpose agent/i.test(sysText)) return 'General';

  const msgs = body.messages || [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role !== 'user') continue;
    const text = getMessageText(msgs[i]);
    if (/^Command:/m.test(text)) return 'Bash';
    break;
  }

  return null;
}

/**
 * 判断请求是否为 Claude Code 内部合成的工具查询。
 * 必须同时满足：(1) 来自主会话（isMainAgent 通过），(2) 最后一条 user message 的起首
 * 命中 SYNTHETIC_PROMPTS 白名单。返回匹配的 subType 或 null。
 *
 * 为什么不用"消息数短"作为启发式：拦截日志里 teammate 消息 / tool_result
 * 也常出现 messages.length <= 3，会把它们误判为 Synthetic。白名单精确度更高，
 * 代价是 Claude Code 新增合成类型需要手工加 pattern。
 */
function getSyntheticSubType(req) {
  if (!isMainAgent(req)) return null;
  const msgs = req.body?.messages || [];
  if (!msgs.length) return null;
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return null;
  const text = getMessageText(last).trim();
  if (!text) return null;
  for (const { subType, pattern } of SYNTHETIC_PROMPTS) {
    if (pattern.test(text)) return subType;
  }
  return null;
}

function isCountRequest(req) {
  const msgs = req.body?.messages;
  if (!Array.isArray(msgs) || msgs.length !== 1) return false;
  const msg = msgs[0];
  return msg.role === 'user' && msg.content === 'count';
}

/**
 * Preflight 判断：
 * 1. tools 为空或不存在
 * 2. messages 仅一条 user message
 * 3. system 包含 Claude Code 特征
 * 4. 下一条请求的 messages 中包含本条 message 的文本（前80字符匹配）
 */
function isPreflightRequest(req, nextReq) {
  const body = req.body || {};
  const tools = body.tools;
  const msgs = body.messages || [];

  // 条件1: tools 为空
  if (Array.isArray(tools) && tools.length > 0) return false;

  // 条件2: 仅一条 message
  if (msgs.length !== 1 || msgs[0].role !== 'user') return false;

  const text = getMessageText(msgs[0]);
  if (!text) return false;

  // 排除 count 请求
  if (text.trim() === 'count') return false;

  // 排除工具类请求（Bash 命令、安全策略检查、系统通知等）
  const trimmed = text.trim();
  if (/^Command:/m.test(text) || /^<policy_spec>/i.test(trimmed) || /^<task-notification>/i.test(trimmed)) return false;

  // 条件3: system 包含 Claude Code 特征，但排除 Bash 处理器
  const sysText = getSystemText(body);
  if (!sysText.includes('Claude Code')) return false;
  if (/process Bash commands/i.test(sysText)) return false;
  if (/Extract any file paths/i.test(sysText)) return false;

  // 条件4: 下一条请求的 messages 中包含本条文本
  if (nextReq) {
    const nextMsgs = nextReq.body?.messages || [];
    const sig = text.slice(0, 80);
    const found = nextMsgs.some(m => {
      const c = m?.content;
      if (typeof c === 'string') return c.includes(sig);
      if (Array.isArray(c)) {
        return c.some(block => block?.type === 'text' && block.text && block.text.includes(sig));
      }
      return false;
    });
    if (found) return true;
  }

  return false;
}

/**
 * 分类请求
 * @param {object} req - 当前请求
 * @param {object} [nextReq] - 下一条请求（用于 Preflight 判断）
 */
export function classifyRequest(req, nextReq) {
  // Teammate 子进程的请求优先识别（收敛于 contentFilter.isTeammate）
  if (isTeammate(req)) {
    if (req.teammate) return { type: 'Teammate', subType: req.teammate };
    if (req._cachedTeammateName === undefined) {
      req._cachedTeammateName = extractTeammateName(req.body) || null;
    }
    return { type: 'Teammate', subType: req._cachedTeammateName };
  }

  // Synthetic 检查要在 MainAgent 之前——这类请求 mainAgent=true，
  // 不拦截就会被当作普通主会话轮次，用户看不出是 Claude Code 合成的。
  const syntheticSub = getSyntheticSubType(req);
  if (syntheticSub) {
    return { type: 'Synthetic', subType: syntheticSub };
  }

  if (isMainAgent(req)) {
    return { type: 'MainAgent', subType: null };
  }

  if (req.isCountTokens || isCountRequest(req)) {
    return { type: 'Count', subType: null };
  }

  if (isPreflightRequest(req, nextReq)) {
    // Preflight 内容以 "Implement the following plan:" 开头 → Plan:Prompt
    const text = getMessageText((req.body?.messages || [])[0]);
    if (/Implement the following plan:/i.test(text.trim())) {
      return { type: 'Plan', subType: 'Prompt' };
    }
    return { type: 'Preflight', subType: null };
  }

  const subType = getSubAgentSubType(req);
  return { type: 'SubAgent', subType };
}

// Tag 显示文本
export function formatRequestTag(type, subType) {
  if (type === 'Teammate' && subType) return `Teammate:${subType}`;
  if (type === 'Plan' && subType) return `Plan:${subType}`;
  if (type === 'SubAgent' && subType) return `SubAgent:${subType}`;
  if (type === 'Synthetic' && subType) return `Synthetic:${subType}`;
  return type;
}

// Teammate label: "Teammate: name(model-short)" or "Teammate: name"
export function formatTeammateLabel(name, model) {
  const displayName = name || 'X';
  if (!model) return `Teammate: ${displayName}`;
  const short = model.replace(/^claude-/i, '').replace(/-\d{8}$/, '');
  return `Teammate: ${displayName}(${short})`;
}
