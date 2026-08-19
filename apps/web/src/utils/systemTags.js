export const SYSTEM_TAGS = [
  'system-reminder', 'local-command-caveat', 'project-reminder',
  'important-instruction-reminders', 'file-modified-reminder', 'todo-reminder',
  'user-prompt-submit-hook', 'local-command-stdout', 'command-name',
  'task-notification', 'environment_details', 'context'
];

export function parseSystemTags(text) {
  if (!text) return { segments: [] };
  const tagPattern = new RegExp(
    '<(' + SYSTEM_TAGS.join('|') + ')\\b[^>]*>([\\s\\S]*?)</\\1>',
    'gi'
  );
  const segments = [];
  let lastIndex = 0;
  let match;
  while ((match = tagPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim();
      if (before) segments.push({ type: 'text', content: before });
    }
    segments.push({ type: 'system-tag', tag: match[1], content: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    const rest = text.slice(lastIndex).trim();
    if (rest) segments.push({ type: 'text', content: rest });
  }
  return { segments };
}

const _tagCache = new Map();
const _TAG_CACHE_MAX = 512;

export function renderAssistantText(text) {
  if (!text) return { segments: [] };
  const hit = _tagCache.get(text);
  if (hit) return hit;

  const result = parseSystemTags(text);

  if (_tagCache.size >= _TAG_CACHE_MAX) {
    _tagCache.delete(_tagCache.keys().next().value);
  }
  _tagCache.set(text, result);
  return result;
}
