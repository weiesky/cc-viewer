/**
 * Thinking-block merging helper.
 *
 * Anthropic 的「交错思考(interleaved thinking)」格式会在单条 assistant message 的
 * content 数组里放多个 thinking 块（与 tool_use 交错排列）。视图层应把它们合并成
 * 单个「思考过程」折叠块，各段非空 thinking 文本用 markdown 水平分隔线连接，视觉上
 * 彼此分隔；否则同一请求会渲染出多个折叠框，非常冗长。
 *
 * mergeThinkingBlocks(content) 返回 { text, isEmpty, count }：
 *   - count   : content 中 type==='thinking' 的块数（含空/redacted/非字符串）。
 *   - text    : 各非空、且非纯 '---' 的 thinking 文本 trim 后用 '\n\n---\n\n' 连接；
 *               无可用段时为 ''。
 *   - isEmpty : 无任何可用 thinking 文本时为 true（全部为空/redacted/非字符串）。
 *
 * 注意：count > 0 不蕴含 isEmpty === false——存在 thinking 块但全为空/redacted 时
 * count>0 且 isEmpty===true。caller 需同时判断:count>0 才渲染折叠框、isEmpty 决定
 * 显示空提示还是合并文本（见 ChatMessage 两个渲染器）。
 *
 * 分隔符必须用 '\n\n---\n\n'（前后空行）：marked 在 `段落\n---`（无空行）下会把
 * '---' 解析成 setext H2，加空行后才是 <hr> 水平线。过滤/trim/join 规则与 web-search
 * synthesis 合并先例（ChatMessage.jsx 的 mergedSynthesisText）保持一致。
 *
 * 设计上故意做成纯 JS（无 React 依赖），让 Node test runner 能直接 import。
 */

const THINKING_SEPARATOR = '\n\n---\n\n';

export function mergeThinkingBlocks(content) {
  if (!Array.isArray(content)) {
    return { text: '', isEmpty: true, count: 0 };
  }

  let count = 0;
  const segments = [];

  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'thinking') continue;
    count++;
    const raw = typeof block.thinking === 'string' ? block.thinking : '';
    const trimmed = raw.trim();
    if (trimmed && trimmed !== '---') segments.push(trimmed);
  }

  return {
    text: segments.join(THINKING_SEPARATOR),
    isEmpty: segments.length === 0,
    count,
  };
}
