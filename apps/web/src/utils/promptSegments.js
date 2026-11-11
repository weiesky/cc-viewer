// 与 chat 侧 prompt 导航配套的小工具：用户 Prompt 汇总弹窗的数据提取。
// 历史实现住在 AppHeader（汉堡菜单「查看用户 Prompt」入口）；入口迁到 ChatView
// 侧栏导航气泡后，提取逻辑随弹窗一起下沉到这里，AppHeader 不再携带。

// 命令相关的 XML 标签在 parseSegments 中直接跳过（不在弹窗里展示为可折叠 system 段）。
const COMMAND_TAGS = new Set([
  'command-name', 'command-message', 'command-args',
  'local-command-caveat', 'local-command-stdout',
]);

// DetailPanel 复用（原 AppHeader.COMMAND_TAGS）
export { COMMAND_TAGS };

// 将一段文本拆分为普通文本和 XML 标签片段（可折叠）
export function parsePromptSegments(text) {
  const segments = [];
  // 匹配所有成对的 XML 标签: <tag-name ...>...</tag-name>
  const regex = /<([a-zA-Z_][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index).trim();
    if (before) segments.push({ type: 'text', content: before });
    const tagName = match[1];
    lastIndex = match.index + match[0].length;
    if (COMMAND_TAGS.has(tagName)) continue;
    // 提取标签内的内容（去掉外层开闭标签）
    const innerRegex = new RegExp(`^<${tagName}(?:\\s[^>]*)?>([\\s\\S]*)<\\/${tagName}>$`);
    const innerMatch = match[0].match(innerRegex);
    const content = innerMatch ? innerMatch[1].trim() : match[0].trim();
    segments.push({ type: 'system', content, label: tagName });
  }
  const after = text.slice(lastIndex).trim();
  if (after) segments.push({ type: 'text', content: after });
  return segments;
}
