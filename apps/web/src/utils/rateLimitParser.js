// 解析 Anthropic 订阅(coding plan / OAuth)在响应头里下发的统一限流信息
// （anthropic-ratelimit-unified-* 家族），归一化成前端血条旁「套餐用量」组件可直接用的结构。
//
// 纯函数、零依赖：仅做字符串 → 数值的安全转换，便于单元测试，也避免被
// ESM 后缀缺失的传递依赖污染（参考 readResultPool 测试注释）。
//
// 数据来源：cc-viewer 拦截器已把响应头原样写进日志(interceptor.js)，前端的
// request.response.headers 即可直接读到，无需任何服务端改动。
//
// 关键事实（基于真实日志校验）：
//   - 所有取值都是字符串，例如 utilization="0.19"（0~1 的占比，不是 token 数）；
//   - reset 是 unix epoch「秒」，需 ×1000 转毫秒；
//   - key 集合并非固定（个别项目还多出 -fallback 等），解析必须容忍缺失/多余 key。

const PREFIX = 'anthropic-ratelimit-unified-';

// 安全转数值：非有限值（NaN/Infinity/null/空串）一律返回 null，避免污染显示。
function toNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// 把 headers 的 key 统一成小写做大小写无关查找（fetch 一般已小写，这里再兜底一次）。
function lowerKeyMap(headers) {
  const map = {};
  for (const k of Object.keys(headers)) map[k.toLowerCase()] = headers[k];
  return map;
}

/**
 * 解析单个窗口（如 '5h' / '7d'）。三项全缺则返回 null（该窗口不存在）。
 * @returns {{id:string, utilization:number|null, status:string|null, resetAt:number|null}|null}
 */
function parseWindow(map, id) {
  const utilization = toNum(map[`${PREFIX}${id}-utilization`]);
  const resetSec = toNum(map[`${PREFIX}${id}-reset`]);
  const status = map[`${PREFIX}${id}-status`] || null;
  if (utilization == null && resetSec == null && !status) return null;
  return {
    id,
    utilization,                                   // 0~1 占比
    status,                                         // allowed / rejected / queued ...
    resetAt: resetSec != null ? resetSec * 1000 : null, // epoch 秒 → 毫秒
  };
}

/**
 * 解析统一限流响应头。
 * @param {Record<string,string>|null|undefined} headers - request.response.headers
 * @returns {null | {
 *   source: 'plan',
 *   windows: Array<{id, utilization, status, resetAt}>,
 *   overallStatus: string|null,
 *   representativeClaim: string|null,
 *   overage: { status: string|null, disabledReason: string|null },
 *   fallbackPercentage: number|null,
 * }}
 * 无任何 unified header 时返回 null（调用方据此决定不渲染套餐用量）。
 */
export function parseRateLimitHeaders(headers) {
  if (!headers || typeof headers !== 'object') return null;
  const map = lowerKeyMap(headers);

  // 没有任何 unified-* 头 → 不是订阅计划下发的限流信息，直接放弃。
  const hasUnified = Object.keys(map).some((k) => k.startsWith(PREFIX));
  if (!hasUnified) return null;

  const windows = [parseWindow(map, '5h'), parseWindow(map, '7d')].filter(Boolean);
  if (windows.length === 0) return null;

  return {
    source: 'plan',
    windows,
    overallStatus: map[`${PREFIX}status`] || null,
    representativeClaim: map[`${PREFIX}representative-claim`] || null,
    overage: {
      status: map[`${PREFIX}overage-status`] || null,
      disabledReason: map[`${PREFIX}overage-disabled-reason`] || null,
    },
    fallbackPercentage: toNum(map[`${PREFIX}fallback-percentage`]),
  };
}

/**
 * 从 requests 列表里取「最近一条带统一限流头」的响应，解析成套餐用量。
 * 统一限流头是账号级、随每条 200 响应下发的，所以从后往前找第一条可解析的即可
 * （不依赖 isMainAgent，保持本模块零依赖、可独立单测）。
 * @param {Array} requests
 * @returns {ReturnType<typeof parseRateLimitHeaders>}
 */
export function extractLatestPlanUsage(requests) {
  if (!Array.isArray(requests)) return null;
  for (let i = requests.length - 1; i >= 0; i--) {
    const headers = requests[i] && requests[i].response && requests[i].response.headers;
    if (!headers) continue;
    const pu = parseRateLimitHeaders(headers);
    if (pu) return pu;
  }
  return null;
}

/**
 * 选出「当前绑定」的代表窗口，用于 pill 的主色与主进度。
 * 规则：representative-claim='five_hour' → 5h；明显的周/天 → 7d；
 *      无法识别时回落到使用率更高的窗口（更接近“离限额最近”的语义）。
 */
export function pickHeadlineWindow(planUsage) {
  if (!planUsage || !Array.isArray(planUsage.windows) || planUsage.windows.length === 0) return null;
  const claim = planUsage.representativeClaim;
  let id = null;
  if (claim === 'five_hour') id = '5h';
  else if (claim && /(day|week|7d|seven)/i.test(claim)) id = '7d';
  if (id) {
    const hit = planUsage.windows.find((w) => w.id === id);
    if (hit) return hit;
  }
  return planUsage.windows.reduce((a, b) => ((b.utilization || 0) > (a.utilization || 0) ? b : a));
}
