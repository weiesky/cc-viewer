// Retina 屏幕截图为 2x 分辨率，上传前按 devicePixelRatio 缩小到 1x，减少文件体积。
// 非 Retina 屏幕、Canvas 不可用、或 img.onerror 时，静默返回原始文件（graceful fallback）。
export function downscaleForRetina(file) {
  const dpr = window.devicePixelRatio || 1;
  if (dpr <= 1) return Promise.resolve(file);

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = Math.round(img.width / dpr);
      const h = Math.round(img.height / dpr);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        if (!blob) { resolve(file); return; }
        resolve(new File([blob], file.name || 'clipboard.png', { type: file.type }));
      }, file.type);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
