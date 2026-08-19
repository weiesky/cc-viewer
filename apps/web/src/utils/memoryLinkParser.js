// 持久记忆 markdown 内 <a> 链接拦截：白名单设计——只放行 #anchor 和单段 .md basename。
// CachePopoverContent.jsx + MemoryDetailModal.jsx 共用，避免双份 paste 漂移。
//
// 返回 discriminated union（而非简单 string | null）的理由：
//   调用方需要区分三种动作——打开 detail / 透传给浏览器（锚点滚动）/ 阻止默认行为。
//   { open: name } / { allow: true } / { reject: true } 让调用方一目了然，
//   编译期就能 catch 漏分支（不像 string | null 容易把 reject 误当 allow）。
//
// 拒绝规则（白名单优先）：
//   - 任意 scheme（http://, javascript:, chrome-extension:, custom-app:, x-anything: 等）一律拒绝。
//     持久记忆面板内不导航外站；上游受信任 markdown 也禁止 deep-link 至浏览器协议处理器。
//   - 绝对路径 / 路径分隔符 / `..` 段 / 隐藏文件（以 . 开头）
//   - 非 .md 后缀
const ANCHOR_PREFIX = '#';

export function parseMemoryLink(hrefRaw) {
  if (!hrefRaw) return { reject: true };

  const trimmed = hrefRaw.trim();
  if (!trimmed) return { reject: true };

  // 锚点链接（#section）放过，让浏览器原地滚动
  if (trimmed.startsWith(ANCHOR_PREFIX)) return { allow: true };

  // 任何 scheme 标记（首段 [a-z][a-z0-9+.-]*: 模式）一律拒绝。
  // 大小写不敏感（toLowerCase 规范化防 `JaVaScRiPt:` 之类绕过）。
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return { reject: true };

  // 去掉 query/hash + URL 解码 → 候选 basename
  let candidate;
  try {
    candidate = decodeURIComponent(trimmed.split('#')[0].split('?')[0]);
  } catch {
    return { reject: true };
  }

  if (!candidate) return { reject: true };
  if (candidate.startsWith('/') || candidate.startsWith('\\')) return { reject: true };
  if (candidate.includes('/') || candidate.includes('\\')) return { reject: true };
  if (candidate === '..' || candidate.startsWith('.')) return { reject: true };
  if (!/\.md$/i.test(candidate)) return { reject: true };

  return { open: candidate };
}
