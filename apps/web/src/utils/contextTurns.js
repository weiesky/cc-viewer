// Context tab message parsing + turn grouping (extracted from ContextTab.jsx so the
// pairing logic is unit-testable — JSX modules cannot be imported by the test harness).

export function parseContentBlocks(content) {
  if (content == null) return [];

  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? [{ type: 'markdown', text: trimmed }] : [];
  }

  if (Array.isArray(content)) {
    const blocks = [];
    for (const block of content) {
      if (!block) continue;
      if (block.type === 'text') {
        const trimmed = (block.text || '').trim();
        if (trimmed) blocks.push({ type: 'markdown', text: trimmed });
      } else if (block.type === 'tool_use') {
        blocks.push({
          type: 'tool_use',
          name: block.name || 'unknown',
          id: block.id || '',
          input: block.input ?? {},
        });
      } else if (block.type === 'tool_result') {
        const inner = parseResultContent(block.content);
        blocks.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id || '',
          is_error: block.is_error,
          content: inner,
        });
      } else if (block.type === 'thinking') {
        const text = block.thinking || '';
        if (text.trim()) blocks.push({ type: 'thinking', text });
      } else if (block.type === 'image') {
        blocks.push({ type: 'json', label: 'image', data: block });
      } else {
        blocks.push({ type: 'json', label: block.type || 'block', data: block });
      }
    }
    return blocks;
  }

  return [{ type: 'json', label: 'content', data: content }];
}

export function parseResultContent(content) {
  if (content == null) return [];
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed ? [{ type: 'markdown', text: trimmed }] : [];
  }
  if (Array.isArray(content)) {
    return content.flatMap((c) => {
      if (!c) return [];
      if (c.type === 'text') {
        const trimmed = (c.text || '').trim();
        return trimmed ? [{ type: 'markdown', text: trimmed }] : [];
      }
      return [{ type: 'json', label: c.type || 'block', data: c }];
    });
  }
  return [{ type: 'json', label: 'content', data: content }];
}

export function extractPreviewText(content) {
  if (typeof content === 'string') return content.slice(0, 60).replace(/\n/g, ' ');
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block?.type === 'text' && block.text?.trim()) {
        return block.text.trim().slice(0, 60).replace(/\n/g, ' ');
      }
    }
  }
  return '';
}

// 注意：非 user 开头的消息（首条 assistant、连续 assistant 等）不进任何 turn，
// 「原文」视图与解析视图同口径，同样不展示这些消息。
// Mid-conversation `role:"system"` messages (mid-conversation-system beta) may sit
// between the user message and its assistant reply; they are folded into the turn
// (systemBlocks/rawSystem) so the assistant pairing is not broken. Only messages
// with role === 'system' are skipped when locating the paired assistant — any
// other unknown role still ends the turn, matching the old strict-adjacency rule.
export function groupMessagesIntoTurns(messages) {
  const turns = [];
  let i = 0;
  while (i < messages.length) {
    const userMsg = messages[i];
    if (userMsg?.role !== 'user') { i++; continue; }
    let j = i + 1;
    const systemMsgs = [];
    while (messages[j]?.role === 'system') { systemMsgs.push(messages[j]); j++; }
    const assistantMsg = messages[j]?.role === 'assistant' ? messages[j] : null;
    turns.push({
      id: `turn__${i}`,
      isTurn: true,
      turnIndex: turns.length,
      timestamp: userMsg._timestamp || null,
      assistantTimestamp: assistantMsg?._timestamp || null,
      userBlocks: parseContentBlocks(userMsg?.content),
      systemBlocks: systemMsgs.length
        ? systemMsgs.map((m) => ({ blocks: parseContentBlocks(m.content), timestamp: m._timestamp || null }))
        : null,
      assistantBlocks: assistantMsg ? parseContentBlocks(assistantMsg.content) : null,
      // 原始消息引用：供「原文」视图无损输出（解析 blocks 是单向的，不可逆）
      rawUser: userMsg,
      rawSystem: systemMsgs.length ? systemMsgs : null,
      rawAssistant: assistantMsg,
      preview: extractPreviewText(userMsg?.content),
    });
    i = assistantMsg ? j + 1 : i + 1;
  }
  return turns;
}
