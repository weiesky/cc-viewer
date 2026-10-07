// 从用户消息文本里提取「应渲染为图片」的引用，供 ChatMessage 把路径换成 <img>。
//
// 识别三种写法（均需以图片扩展名结尾才算数）：
//   1. [Image: source: /path/to/x.png] 或 [Image #N: …]   —— Claude CLI 的占位写法
//   2. "/tmp/cc-viewer-uploads/x.png"                       —— 引号包裹的上传路径(拖拽/合成器流程)
//   3.  /tmp/cc-viewer-uploads/x.png                        —— 裸路径(终端粘贴流程直接拼进提示词,无引号)
//
// 第 3 种是历史缺口：终端粘贴时路径被原样拼到文本里、没有引号,旧正则只认引号包裹的写法,
// 于是这类图片只显示成纯文本路径。上传目录前缀(/tmp/cc-viewer-uploads/ 及 macOS realpath
// 解析出的 /private 变体)足够特异,去掉引号要求不会误伤正常文案。

// 路径必须以图片扩展名结尾才渲染(与服务端 /api/file-raw 支持的类型一致)。
export const IMAGE_EXTS = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|icns)$/i;

// 上传目录前缀：/tmp/cc-viewer-uploads/ 与 macOS 下 realpath 解析出的 /private/tmp/... 两种。
const UPLOAD = String.raw`(?:\/private)?\/tmp\/cc-viewer-uploads\/`;
const EXT = String.raw`(?:png|jpe?g|gif|webp|avif|svg|bmp|ico|icns)`;

// 三选一(顺序有意义：引号分支在裸路径分支之前,确保引号被一并吃掉,不会残留成文本)：
//   group1 = [Image …] 内的路径；group2 = 双引号路径；group3 = 单引号路径；group4 = 裸上传路径。
// 引号分支(双/单)都排在裸路径分支之前,确保整对引号被一并吃掉,不残留成文本。
const PATTERN =
  String.raw`\[Image(?:\s*#\d+)?(?::?\s*source)?:\s*([^\]]+)\]` +
  String.raw`|"(${UPLOAD}[^"]+?)"` +
  String.raw`|'(${UPLOAD}[^']+?)'` +
  String.raw`|(${UPLOAD}[^\s"'\]\)]+?\.${EXT})`;

/**
 * 扫描文本,返回按出现顺序排列的图片引用。
 * @param {string} text
 * @returns {Array<{ path: string, raw: string, index: number }>}
 *   path  = 用于请求的文件路径(已 trim)
 *   raw   = 命中的原始子串(用于 fallback 文案,以及计算文本切片边界)
 *   index = raw 在 text 中的起始下标
 */
export function findUserImageRefs(text) {
  if (!text || typeof text !== 'string') return [];
  // 每次新建正则,避免共享 lastIndex 带来的跨调用状态污染。
  const re = new RegExp(PATTERN, 'gi');
  const refs = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; } // 防御零宽匹配死循环
    const path = (m[1] || m[2] || m[3] || m[4] || '').trim();
    if (!path || !IMAGE_EXTS.test(path)) continue;
    refs.push({ path, raw: m[0], index: m.index });
  }
  return refs;
}

/**
 * 把用户文本按图片引用切成交替段,供渲染层把 text 段走 markdown、image 段走 <img> 组件。
 * @param {string} text
 * @returns {Array<{ type: 'text', text: string } | { type: 'image', path: string, raw: string }>}
 *   - 无图片引用 → 单个 text 段(原文整段一次 markdown 解析,与 assistant 同行为)
 *   - 空的 text 段被跳过(两张图相邻/图在文首/文末时不产生空 MarkdownBlock)
 *   注:不为 text 段补换行——text 段与 image 段由各自独立的 React 组件渲染,
 *   marked 永远不会把二者拼进同一段 HTML,段尾追加 '\n' 只会被段落终结符吞掉。
 */
export function segmentUserTextWithImages(text) {
  if (!text || typeof text !== 'string') return [{ type: 'text', text: text || '' }];
  const refs = findUserImageRefs(text);
  if (refs.length === 0) return [{ type: 'text', text }];
  const segments = [];
  let lastIndex = 0;
  for (const ref of refs) {
    if (ref.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, ref.index) });
    }
    segments.push({ type: 'image', path: ref.path, raw: ref.raw });
    lastIndex = ref.index + ref.raw.length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }
  // 纯空白 text 段(如两张图之间只有空格)没有意义,剔除,避免空 MarkdownBlock。
  return segments.filter((seg) => seg.type !== 'text' || seg.text.trim() !== '');
}
