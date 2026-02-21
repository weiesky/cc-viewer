/**
 * 请求类型分类工具
 * classifyRequest(req, nextReq?) 返回 { type, subType }
 * type: 'MainAgent' | 'SubAgent' | 'Count' | 'Preflight' | 'Plan'
 */

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

function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

function getSubAgentSubType(req) {
  const body = req.body || {};
  const sysText = getSystemText(body);

  if (/Extract any file paths/i.test(sysText)) return 'Bash';
  if (/process Bash commands/i.test(sysText)) return 'Bash';
  if (/command execution specialist/i.test(sysText)) return 'Bash';
  if (/file search specialist/i.test(sysText)) return 'Task';
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
  if (req.mainAgent) {
    // 二次校验：排除被误标记的 SubAgent（旧日志兼容）
    const sysText = getSystemText(req.body || {});
    if (/command execution specialist|file search specialist|planning specialist|general-purpose agent/i.test(sysText)) {
      const subType = getSubAgentSubType(req);
      return { type: 'SubAgent', subType };
    }
    return { type: 'MainAgent', subType: null };
  }

  if (isCountRequest(req)) {
    return { type: 'Count', subType: null };
  }

  if (isPreflightRequest(req, nextReq)) {
    // Preflight 内容以 "Implement the following plan:" 开头 → Plan:Prompt
    const text = getMessageText((req.body?.messages || [])[0]);
    if (/^Implement the following plan:/i.test(text.trim())) {
      return { type: 'Plan', subType: 'Prompt' };
    }
    return { type: 'Preflight', subType: null };
  }

  const subType = getSubAgentSubType(req);
  return { type: 'SubAgent', subType };
}

// Tag 显示文本
export function formatRequestTag(type, subType) {
  if (type === 'Plan' && subType) return `Plan:${subType}`;
  if (type === 'SubAgent' && subType) return `Tools:${subType}`;
  return type;
}
