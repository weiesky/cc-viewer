// 浏览器端图片压缩 → base64 dataURL
// 用于 MDXEditor 的 imageUploadHandler：粘贴/拖入图片时本地压缩后内联到 markdown，
// 零后端依赖、保证 .md 文件可移植。

const DEFAULT_MAX_EDGE = 2000;
const DEFAULT_QUALITY = 0.85;
// 输入硬上限：原图 > 10MB 时直接拒绝（即使压缩后能控制在 5MB 内，原图占内存也太大）。
// 5MB 是后端 writeFileContent 的上限；原图按经验 base64 后 +33%，压缩后通常 100-300KB，
// 给 30x 余量已足。
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
// 这里的 KEEP 集合 = 「不走 canvas resize、保留原始数据 base64」的 MIME。
//   - PNG / WEBP：透明区在 canvas 转 JPEG 时会变黑底，且压缩收益取决于内容；保留原图最稳。
//   - GIF：canvas drawImage 只能取首帧，会丢失全部动画——必须直通。
const PASSTHROUGH_TYPES = new Set(['image/png', 'image/gif', 'image/webp', 'image/svg+xml']);

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image decode failed'));
    img.src = src;
  });
}

export async function compressImageToDataURL(file, opts = {}) {
  if (!(file instanceof Blob)) {
    throw new Error('compressImageToDataURL: input must be a File or Blob');
  }
  if (!file.type || !file.type.startsWith('image/')) {
    throw new Error(`Unsupported file type: ${file.type || 'unknown'}`);
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`Image too large: ${(file.size / 1024 / 1024).toFixed(1)}MB > ${MAX_INPUT_BYTES / 1024 / 1024}MB limit`);
  }

  const maxEdge = opts.maxEdge ?? DEFAULT_MAX_EDGE;
  const quality = opts.quality ?? DEFAULT_QUALITY;

  // PNG / GIF / WEBP / SVG 直通 base64（GIF 保留动画，PNG/WEBP 保留透明，SVG 保留矢量）
  if (PASSTHROUGH_TYPES.has(file.type)) {
    return await readAsDataURL(file);
  }

  const originalDataURL = await readAsDataURL(file);
  const img = await loadImage(originalDataURL);

  const longestEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;
  const targetW = Math.max(1, Math.round(img.naturalWidth * scale));
  const targetH = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return originalDataURL;
  }
  ctx.drawImage(img, 0, 0, targetW, targetH);

  // JPEG 透明区会变黑——在 PASSTHROUGH 已涵盖 PNG/WEBP/GIF 的前提下，能进到这里的
  // 都是 image/jpeg / image/bmp / image/heic 等非透明类型，统一压成 JPEG。
  let compressed;
  try {
    compressed = canvas.toDataURL('image/jpeg', quality);
  } catch {
    return originalDataURL;
  }

  if (!compressed || compressed === 'data:,' || compressed.length >= originalDataURL.length) {
    return originalDataURL;
  }
  return compressed;
}
