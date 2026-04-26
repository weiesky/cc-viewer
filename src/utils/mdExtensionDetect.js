// 检测 markdown 内容是否含 MDXEditor 默认不支持的扩展语法
// 命中任意一项时，打开 .md 文件应自动 fallback 到旧 marked 渲染（保留语义完整性），
// 避免 MDXEditor 解析时丢失或损坏这些扩展块。

const RE_MERMAID_FENCE = /^[ \t]*```\s*mermaid\b/m;
const RE_MATH_FENCE = /^[ \t]*```\s*(?:math|latex|tex|katex)\b/im;
const RE_BLOCK_MATH = /\$\$[\s\S]+?\$\$/;
const RE_DIRECTIVE = /^[ \t]*:::[A-Za-z][\w-]*\b/m;

// 行内数学 $...$ 容易和货币符号 / 转义符 / 代码块里的 $ 撞，规则:
//   - 必须在同一行内成对
//   - $ 前后不能是数字（排除 $5、3$）
//   - 至少包含一个数学常见字符（字母、运算符、括号）
//   - 整体不少于 3 字符
//   - 排除位于代码块（```）内的情况由调用方先剥除三连引号块（这里做粗略过滤）
// 注：lookbehind `(?<!...)` 在老 Safari (<16.4) 抛 SyntaxError；construct 用 try/catch 包裹，
// 失败时 RE_INLINE_MATH = null，相当于跳过行内数学检测（保守 fallback）。
let RE_INLINE_MATH = null;
try {
  RE_INLINE_MATH = new RegExp("(?<![\\d$\\\\])\\$([^\\s$][^$\\n]{0,200}?[^\\s$\\\\])\\$(?![\\d])");
} catch {
  RE_INLINE_MATH = null;
}

function stripFences(md) {
  // 粗略剥掉 ``` 围栏代码块，避免行内数学误判命中代码示例里的 $...$
  return md.replace(/```[\s\S]*?```/g, '');
}

export function detectMdExtensions(markdown) {
  const result = {
    hasMermaid: false,
    hasKatex: false,
    hasDirective: false,
    anyExtension: false,
  };
  if (typeof markdown !== 'string' || markdown.length === 0) {
    return result;
  }
  // 整体 try/catch 兜底：极端情况（畸形 markdown / 某些环境的 regex 异常）下不应让组件崩白屏。
  try {
    if (RE_MERMAID_FENCE.test(markdown)) result.hasMermaid = true;
    if (RE_MATH_FENCE.test(markdown) || RE_BLOCK_MATH.test(markdown)) {
      result.hasKatex = true;
    }
    if (RE_DIRECTIVE.test(markdown)) result.hasDirective = true;

    if (!result.hasKatex && RE_INLINE_MATH) {
      const stripped = stripFences(markdown);
      if (RE_INLINE_MATH.test(stripped)) {
        const inlineMatch = stripped.match(RE_INLINE_MATH);
        if (inlineMatch && /[a-zA-Z\\^_=<>+\-*/(){}[\]]/.test(inlineMatch[1])) {
          result.hasKatex = true;
        }
      }
    }
  } catch {
    // 检测失败时返回保守 false（即把内容当成纯标准 markdown 让 MDXEditor 处理），
    // 避免阻塞用户。如果真有扩展语法，MDXEditor 自身的 onError 会兜底。
  }

  result.anyExtension = result.hasMermaid || result.hasKatex || result.hasDirective;
  return result;
}
