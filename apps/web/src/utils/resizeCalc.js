// 拖拽 resize 的纯几何计算 —— 把 startX/Y/curX/curY/startW/startH 换成 clamp 后的 {w, h}。
// 单测可独立验证 4 个 clamp 边界 + 任意方向(dirX/dirY ∈ {-1, +1}),不依赖 DOM/React。
//
// 方向参数语义:
//   dirX = -1 →  鼠标往左拉时 w 变大(handle 在左侧,例:左上 / 左下)
//   dirX = +1 →  鼠标往右拉时 w 变大(handle 在右侧,例:右上 / 右下)
//   dirY 同理(-1 = handle 在上侧)
//
// 调用方需保证 clamp 区间合法(min ≤ max);若不合法则 max 取胜(避 NaN)。
export function calcResizedSize({ startX, startY, curX, curY, startW, startH, dirX, dirY, clamp }) {
  const dx = (curX - startX) * dirX;
  const dy = (curY - startY) * dirY;
  let w = startW + dx;
  let h = startH + dy;
  const { minW, maxW, minH, maxH } = clamp || {};
  if (typeof minW === 'number' && w < minW) w = minW;
  if (typeof maxW === 'number' && w > maxW) w = maxW;
  if (typeof minH === 'number' && h < minH) h = minH;
  if (typeof maxH === 'number' && h > maxH) h = maxH;
  return { w: Math.round(w), h: Math.round(h) };
}
