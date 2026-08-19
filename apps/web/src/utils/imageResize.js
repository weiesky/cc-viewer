// 图片上传前尺寸压缩：任意一边超过 maxDim 时，按比例缩放至 maxDim 以内。
// 非图片 / 解码失败时原样返回；HEIC/AVIF/GIF/BMP 等只要浏览器能解码就会处理。

// 输出格式：原 PNG/WebP 保留以避免不必要的有损再编码，其余一律转 JPEG。
const KEEP_FORMAT = new Set(['image/png', 'image/webp']);

export function pickOutputType(inputType) {
  return KEEP_FORMAT.has(inputType) ? inputType : 'image/jpeg';
}

function loadImageBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).catch(() => loadViaImgElement(file));
  }
  return loadViaImgElement(file);
}

function loadViaImgElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      type,
      quality,
    );
  });
}

export async function resizeImageIfNeeded(file, maxDim = 2000) {
  if (!file || typeof file !== 'object') return file;
  const type = (file.type || '').toLowerCase();
  if (!type.startsWith('image/')) return file;
  // GIF 走 canvas 会只保留第一帧 + 转 JPEG，动图彻底丢。
  // 直接放行原文件（Claude API 对 GIF 有自己的降采样，即便 >2000px 也由后端处理）。
  if (type === 'image/gif') return file;

  let source;
  try {
    source = await loadImageBitmap(file);
  } catch {
    return file;
  }

  const srcW = source.width || source.naturalWidth;
  const srcH = source.height || source.naturalHeight;
  if (!srcW || !srcH) {
    try { source.close?.(); } catch {}
    return file;
  }

  const maxSide = Math.max(srcW, srcH);
  if (maxSide <= maxDim) {
    try { source.close?.(); } catch {}
    return file;
  }

  const scale = maxDim / maxSide;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    try { source.close?.(); } catch {}
    return file;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(source, 0, 0, dstW, dstH);
  } catch {
    try { source.close?.(); } catch {}
    return file;
  }
  try { source.close?.(); } catch {}

  const outType = pickOutputType(type);
  const quality = outType === 'image/png' ? undefined : 0.92;

  let blob;
  try {
    blob = await canvasToBlob(canvas, outType, quality);
  } catch {
    return file;
  }

  // 走到这里说明 maxSide > maxDim，必须返回缩放版本以满足 API 尺寸限制
  // （即使重编码后字节反而更大 —— 如低色 PNG 转 JPEG —— 也不能回退原图）
  const nameOut = renameForType(file.name || 'image', outType);
  return new File([blob], nameOut, { type: outType, lastModified: Date.now() });
}

export function renameForType(originalName, outType) {
  const ext = outType === 'image/jpeg' ? 'jpg'
    : outType === 'image/png' ? 'png'
    : outType === 'image/webp' ? 'webp'
    : 'img';
  const dot = originalName.lastIndexOf('.');
  const stem = dot > 0 ? originalName.slice(0, dot) : originalName;
  return `${stem}.${ext}`;
}
