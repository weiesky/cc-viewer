// 用户消息内容分类与过滤规则
// ChatView（对话模式）和 AppHeader（用户 Prompt 弹窗）共用此模块，确保过滤逻辑一致。

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
