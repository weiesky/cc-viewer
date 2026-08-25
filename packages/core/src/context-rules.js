// CLIENT-SAFE: no node deps. Home: @ccv/core (context-rules.js) — consumed by apps/web + packages/app. Do not add fs/process/node: imports.
//
// 上下文窗口规则唯一事实源(前后端同源):
//   - 服务端:server/lib/context-watcher.js、server/routes/events.js 直接 import
//   - 前端:apps/web/src/utils/helpers.js thin re-export(经 @ccv/core 跨包打包,先例见 tools-xml-formatter.js)
// 此前规则散落三处(前端 MODEL_CONTEXT_SIZES / _classifyContextSize、服务端 getContextSizeForModel)
// 且已漂移(服务端不认识 deepseek-v4),收编于此后任何档位变更只改这一个文件。
//
// 关键有意决策:裸 claude-sonnet-4-6(无 [1m] 后缀)按 200K 而非 API 规格表的 1M ——
// 与 Claude Code 选模型的默认行为一致([1m] 是用户显式 opt-in);若实际跑在 1M 模式,
// 由 [1m] 后缀规则或 adaptContextWindow 用量纠偏兜底,血条不会卡死在 100%。

// [Nk]/[Nm] 显式窗口后缀,如 claude-fable-5[1m]、claude-sonnet-4-6[200k]、[500k]。
// 显式 opt-in 优先级最高,胜过一切家族规则。
const SIZE_SUFFIX_RE = /\[(\d+)([km])\]/i;

/**
 * 解析模型名里的 [Nk]/[Nm] 窗口后缀。
 * @param {string} modelName
 * @returns {number|null} 解析出的窗口 token 数,无后缀返回 null
 */
export function parseContextSizeSuffix(modelName) {
  if (!modelName || typeof modelName !== 'string') return null;
  const m = modelName.match(SIZE_SUFFIX_RE);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  return m[2].toLowerCase() === 'm' ? num * 1000000 : num * 1000;
}

/**
 * Resolve the model name to use for context-window classification (血条窗口判定专用).
 *
 * Precedence differs from getEffectiveModel (response-first) on one deliberate
 * point: an EXPLICIT [Nk]/[Nm] suffix on the REQUEST model (`body.model`, which
 * carries the user's hot-switch config / model selector intent) is authoritative
 * and must NOT be overridden by the upstream response. Upstream APIs normalize
 * the response `model` — e.g. hot-switching to `k3[1m]` makes Moonshot return
 * `response.body.model: "k3"`, stripping the [1m] marker; a response-first read
 * would then misclassify the window (bare k3 vs the configured 1M). So: request
 * suffix wins; otherwise fall back to the response model, then the request name.
 *
 * @param {object|null|undefined} request log entry with body / response
 * @returns {string|null}
 */
export function getCalibrationModel(request) {
  const reqModel = request?.body?.model;
  if (typeof reqModel === 'string' && parseContextSizeSuffix(reqModel) != null) return reqModel;
  const respModel = request?.response?.body?.model;
  if (typeof respModel === 'string' && respModel) return respModel;
  return (typeof reqModel === 'string' && reqModel) ? reqModel : null;
}

// 模型家族 → 窗口档位表(有序,首条命中)。后缀解析在表外先行(见 getModelMaxTokens)。
const MODEL_CONTEXT_SIZES = [
  // haiku 全系 200K,显式置于一切 1M 默认之前(claude-haiku-4-5 等)
  { match: /haiku/i, tokens: 200000 },
  // 旧 Opus 修正:opus-4-0 / opus-4-1 / opus-4-5 实为 200K(opus-4-6 起才 1M)。
  // (?!\d) 防误吞 opus-4-15 这类未来版本号;分隔符兼容连字符/点/空格。
  { match: /opus[ -]?4[-. ][015](?!\d)/i, tokens: 200000 },
  // claude-3-opus(3-opus / opus-3 两种写法)实为 200K
  { match: /3[-.]opus|opus[-.]3/i, tokens: 200000 },
  // 其余 Opus(4-6 起与未来版本)默认 1M
  { match: /opus/i, tokens: 1000000 },
  // mythons 默认 1M(置于 /claude/ 之前,避免被抢成 200K)
  { match: /mythons/i, tokens: 1000000 },
  // fable-5 家族(fable-5 / fable-5.x / fable-5-x)默认 1M,同样须排在 /claude/ 之前
  { match: /fable[ -]5/i, tokens: 1000000 },
  // 有意为之:裸 claude-sonnet-4-6(无 [1m] 后缀)维持 200K,与 Claude Code 选模型的
  // 默认行为一致([1m] 是显式 opt-in);真 1M 场景靠后缀或 adaptContextWindow 纠偏兜底。
  { match: /claude/i, tokens: 200000 },
  { match: /gpt-4o|o1|o3|o4/i, tokens: 128000 },
  { match: /gpt-4/i, tokens: 128000 },
  { match: /gpt-3/i, tokens: 16000 },
  // Kimi 家族精确档:k2.x/k3 等带 kimi/moonshot 前缀的 → 256K;裸 'k3'(无前缀,
  // 代理直连时的简写 model 名)→ 256K 精确档但 classifyContextWindow 不升 1M
  // (见该函数的家族特判,裸 k3 归 200K 桶,超量由 adaptContextWindow 纠偏)。
  { match: /kimi|moonshot|^k3$/i, tokens: 256000 },
  // deepseek-v4 defaults to 1M; placed before generic /deepseek/ so the
  // first-match-wins loop picks it up before falling through to 128K.
  { match: /deepseek-v4/i, tokens: 1000000 },
  { match: /deepseek/i, tokens: 128000 },
];

/**
 * 模型名 → 上下文窗口 token 数。后缀优先,其次家族档位表;
 * 无法识别的型号默认 1M(用户规约:宁可低估百分比,不让血条提前顶满)。
 * 空/缺失名字不属于"无法识别的型号",维持 200K 静态兜底。
 * @param {string|null|undefined} modelName
 * @returns {number}
 */
export function getModelMaxTokens(modelName) {
  if (!modelName) return 200000;
  const suffix = parseContextSizeSuffix(modelName);
  if (suffix) return suffix;
  for (const entry of MODEL_CONTEXT_SIZES) {
    if (entry.match.test(modelName)) return entry.tokens;
  }
  // Unrecognized model family → assume 1M (user convention).
  return 1000000;
}

/**
 * 校准二分类:名字 → 1M/200K(血条 calibration 'auto' 路径专用)。
 * 不变量:只返回 1000000 或 200000(resolveCalibrationTokens 依赖此不变量)。
 * 裸 '1m' 子串(无方括号,如 deepseek-v3-1m)→ 1M 的宽松规则仅限本分类器,
 * 刻意不进 getModelMaxTokens(后者面向精确档位)。128K/16K 档归入 200K 桶。
 * Kimi 家族特判:kimi/moonshot 前缀型号(k2.x/k3,真实窗口 256K)归 1M 桶 ——
 * 避免会话中段从 200K 重标定到 256K/1M 的跳变;代价是相对真实 256K 上限
 * 长期低估(约 4 倍刻度),可接受。裸 'k3' 同样归 1M:代理热切换到
 * 'k3[1m]' 时上游会把响应 model 归一化成裸 'k3'(剥掉 [1m] 后缀),
 * response-first 解析读到裸 'k3' 若归 200K 桶会与请求侧 1M 判定分裂,
 * 血条分母错成 200K;且裸 'k3' 本就是 k3[1m] 的 1M 形态被剥后缀的产物。
 * 无法识别的型号经 getModelMaxTokens 落底 1M → 归 1M 桶(见该函数注释)。
 * @param {string} modelName
 * @returns {1000000|200000}
 */
export function classifyContextWindow(modelName) {
  if (!modelName || typeof modelName !== 'string') return 200000;
  if (modelName.toLowerCase().includes('1m')) return 1000000;
  if (/kimi|moonshot|^k3$/i.test(modelName)) return 1000000;
  return getModelMaxTokens(modelName) >= 1000000 ? 1000000 : 200000;
}

/**
 * 血条自适应纠偏:把"分类器判出的上下文窗口"按真实用量修正。
 * 一个真正的 200K 模型,其输入上下文(input + cache_creation + cache_read)物理上不可能
 * 超过 200K —— 超了 API 直接拒收。所以一旦真实输入用量越过 200K 还被判成 200K,必然是
 * model 名识别错了(误判),此时自动升到 1M,免得血条卡死在 100%、百分比与真实进度脱节。
 * One-way upgrades only: 200K→1M and 256K→1M (the kimi exact tier used by the
 * server-side SSE path); every other classification (1M, 128K/16K tiers, true
 * 200K values) is returned unchanged — 128K is deliberately never promoted.
 * 注意:usedContextTokens 必须是"输入侧"用量(sumUsageInputTokens,不含 output_tokens),
 * 否则大输出会误触发。
 * @param {number} classifiedTokens classifyContextWindow / getModelMaxTokens 的结果
 * @param {number} usedContextTokens 当前输入上下文实际用量(input + cache_creation + cache_read)
 * @returns {number} 修正后的上下文窗口 token 数(1000000 或原值)
 */
export function adaptContextWindow(classifiedTokens, usedContextTokens) {
  if (classifiedTokens === 200000 && usedContextTokens > 200000) return 1000000;
  if (classifiedTokens === 256000 && usedContextTokens > 256000) return 1000000;
  return classifiedTokens;
}

/**
 * cache_creation 兼容求和:flat 字段(cache_creation_input_tokens)存在(非 null/undefined,
 * 0 也算存在)直接用;缺失时回落到新版嵌套对象 usage.cache_creation 的各 TTL 分桶求和
 * (ephemeral_5m_input_tokens + ephemeral_1h_input_tokens,未来新增分桶自动计入)。
 * @param {object|null|undefined} usage API usage 对象
 * @returns {number}
 */
export function sumCacheCreationTokens(usage) {
  if (!usage) return 0;
  if (usage.cache_creation_input_tokens != null) return usage.cache_creation_input_tokens || 0;
  const nested = usage.cache_creation;
  if (nested && typeof nested === 'object') {
    let sum = 0;
    for (const v of Object.values(nested)) {
      if (typeof v === 'number' && Number.isFinite(v)) sum += v;
    }
    return sum;
  }
  return 0;
}

/**
 * 输入侧上下文用量(不含 output_tokens)。用于自适应纠偏判定。
 * @param {object|null|undefined} usage
 * @returns {number}
 */
export function sumUsageInputTokens(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0) + sumCacheCreationTokens(usage) + (usage.cache_read_input_tokens || 0);
}

/**
 * 血条分子统一口径:输入侧 + 末轮 output_tokens,对齐 Claude Code /context 的
 * "当前上下文占用"语义(末轮回复已进入下一轮上下文)。
 * @param {object|null|undefined} usage
 * @returns {number}
 */
export function sumUsageContextTokens(usage) {
  if (!usage) return 0;
  return sumUsageInputTokens(usage) + (usage.output_tokens || 0);
}
