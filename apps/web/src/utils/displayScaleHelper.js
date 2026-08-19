/**
 * Display-scale (整体显示大小 / Chrome 式缩放) 的纯计算工具。
 * 无 DOM / React 依赖,便于单测。比例以「整数百分比」表示(100 = 原始大小)。
 */

// 预设档位,贴近 Chrome 的缩放档位。
export const DISPLAY_SCALE_PRESETS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200];

const MIN_SCALE = DISPLAY_SCALE_PRESETS[0];
const MAX_SCALE = DISPLAY_SCALE_PRESETS[DISPLAY_SCALE_PRESETS.length - 1];

/**
 * 把任意输入(可能来自手改 preferences.json / 旧数据)夹到 [50,200] 并吸附到最近的预设档位。
 * 平局时取较大档位。非法输入回退到 100。
 * @param {number|string} pct
 * @returns {number} 一个合法的预设值
 */
export function snapToPreset(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 100;
  const clamped = Math.max(MIN_SCALE, Math.min(MAX_SCALE, n));
  let best = DISPLAY_SCALE_PRESETS[0];
  let bestDist = Infinity;
  for (const p of DISPLAY_SCALE_PRESETS) {
    const d = Math.abs(p - clamped);
    // `<=` 让平局时取后出现(更大)的档位
    if (d <= bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/**
 * 在预设档位上前进/后退一格(用于 Cmd/Ctrl +/- 快捷键)。
 * 先把当前值吸附到档位,再按方向移动一格,两端夹紧。
 * @param {number|string} current 当前比例
 * @param {number} dir +1 放大 / -1 缩小
 * @returns {number} 新的预设值
 */
export function stepPreset(current, dir) {
  const snapped = snapToPreset(current);
  const idx = DISPLAY_SCALE_PRESETS.indexOf(snapped);
  const nextIdx = Math.max(0, Math.min(DISPLAY_SCALE_PRESETS.length - 1, idx + Math.sign(dir)));
  return DISPLAY_SCALE_PRESETS[nextIdx];
}
