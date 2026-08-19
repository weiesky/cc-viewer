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
