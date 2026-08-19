/**
 * 窗口位置/大小持久化(纯逻辑,fs 与 Electron screen 均由调用方注入,可被 node:test 直接单测)。
 *
 * 存储:LOG_DIR/window-state.json —— 不写 preferences.json(那个文件由 server 进程拥有写权,
 * 主进程同写会产生竞争覆盖)。
 * 形状:{ x, y, width, height, maximized }(x/y/width/height 为 getNormalBounds() 的非最大化几何)。
 *
 * 恢复前必须 validateState():显示器可能被拔掉/分辨率变化,盲目恢复会把窗口开到屏幕外。
 */

// 与 main.js BaseWindow 创建参数保持一致的下限
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
// 窗口与任一显示器 workArea 的最小可见交叠(px),低于此视为"基本不可见"→ 弃用存档
const MIN_VISIBLE = 100;

/** 读取持久化状态;文件缺失/损坏/形状非法 → null(回落默认窗口几何)。 */
export function loadState(readFn, path) {
  try {
    const raw = readFn(path, 'utf-8');
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return null;
    const { x, y, width, height, maximized } = s;
    if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
    return { x, y, width, height, maximized: !!maximized };
  } catch {
    return null;
  }
}

/** 序列化写盘(写失败静默——窗口状态属 best-effort,不能影响主流程)。 */
export function saveState(writeFn, path, state) {
  try {
    const { x, y, width, height, maximized } = state;
    writeFn(path, JSON.stringify({ x, y, width, height, maximized: !!maximized }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 校验存档对当前显示器布局是否仍然可用。
 * @param {object|null} state loadState() 的产物
 * @param {Array<{x:number,y:number,width:number,height:number}>} workAreas screen.getAllDisplays().map(d=>d.workArea)
 * @returns 合法则返回(尺寸钳到下限后的)state,否则 null
 */
export function validateState(state, workAreas) {
  if (!state || !Array.isArray(workAreas) || workAreas.length === 0) return null;
  const width = Math.max(state.width, MIN_WIDTH);
  const height = Math.max(state.height, MIN_HEIGHT);
  // 至少与一个显示器 workArea 有 MIN_VISIBLE×MIN_VISIBLE 的交叠(标题栏可抓取),否则视为越界
  const visible = workAreas.some((wa) => {
    const ix = Math.min(state.x + width, wa.x + wa.width) - Math.max(state.x, wa.x);
    const iy = Math.min(state.y + height, wa.y + wa.height) - Math.max(state.y, wa.y);
    return ix >= MIN_VISIBLE && iy >= MIN_VISIBLE;
  });
  if (!visible) return null;
  return { x: state.x, y: state.y, width, height, maximized: !!state.maximized };
}
