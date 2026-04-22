import { isSkillText, isMainAgent } from './contentFilter.js';
import { restoreSlimmedEntry } from './entry-slim.js';
import modelClaudeUrl from '../img/model-claude.svg';
import modelOpenaiUrl from '../img/model-openai.svg';
import modelGeminiUrl from '../img/model-gemini.svg';
import modelQwenUrl from '../img/model-qwen.svg';
import modelKimiUrl from '../img/model-kimi.svg';
import modelGlmUrl from '../img/model-glm.svg';
import modelMinimaxUrl from '../img/model-minimax.svg';
import modelDeepseekUrl from '../img/model-deepseek.svg';
import modelClaudeAnimatedSvg from '../img/model-claude-animated.svg?raw';

const MODEL_CONTEXT_SIZES = [
  // Explicit 1M context annotation: [1m] suffix in model descriptor
  { match: /\[1m\]/i, tokens: 1000000 },
  // Opus defaults to 1M context (no 200K variant exists)
  { match: /opus/i, tokens: 1000000 },
  { match: /claude/i, tokens: 200000 },
  { match: /gpt-4o|o1|o3|o4/i, tokens: 128000 },
  { match: /gpt-4/i, tokens: 128000 },
  { match: /gpt-3/i, tokens: 16000 },
  { match: /deepseek/i, tokens: 128000 },
];

export function getModelMaxTokens(modelName) {
  if (!modelName) return 200000;
  for (const entry of MODEL_CONTEXT_SIZES) {
    if (entry.match.test(modelName)) return entry.tokens;
  }
  return 200000;
}

/**
 * Incrementally append cache loss entries to an existing map.
 * Scans from startIndex to end; uses prevMainAgent as comparison baseline.
 * Returns the last mainAgent entry encountered (for next incremental call).
 */
export function appendCacheLossMap(map, requests, startIndex, prevMainAgent) {
  for (let i = startIndex; i < requests.length; i++) {
    const req = requests[i];
    if (!isMainAgent(req)) continue;

    if (prevMainAgent) {
      const usage = req.response?.body?.usage;
      if (usage) {
        const cacheCreate = usage.cache_creation_input_tokens || 0;
        const cacheRead = usage.cache_read_input_tokens || 0;
        if (cacheCreate > 0 && cacheCreate > cacheRead) {
          const prev = prevMainAgent._slimmed
            ? restoreSlimmedEntry(prevMainAgent, requests)
            : prevMainAgent;
          const loss = _computeCacheLoss(prev, req);
          if (loss) map.set(i, loss);
        }
      }
    }
    prevMainAgent = req;
  }
  return prevMainAgent;
}

/**
 * Pre-compute cache loss analysis for all requests in a single forward pass.
 * Returns Map<index, { reason, reasons }> — O(n) total instead of O(n²).
 */
export function buildCacheLossMap(requests) {
  const map = new Map();
  appendCacheLossMap(map, requests, 0, null);
  return map;
}

// WeakMap cache for stringified system/tools — avoids mutating request objects
const _jsonCache = new WeakMap();
function _getCachedJson(entry, key) {
  let cache = _jsonCache.get(entry);
  if (!cache) { cache = {}; _jsonCache.set(entry, cache); }
  if (cache[key] === undefined) {
    const body = stripPrivateKeys(entry.body);
    cache[key] = JSON.stringify(body?.[key]);
  }
  return cache[key];
}

/** Internal: compare two adjacent MainAgent entries for cache loss reason. */
function _computeCacheLoss(prevMainAgent, req) {
  const gap = req.timestamp - prevMainAgent.timestamp;
  if (gap > 5 * 60 * 1000) return { reason: 'ttl', reasons: ['ttl'] };

  const prev = stripPrivateKeys(prevMainAgent.body);
  const curr = stripPrivateKeys(req.body);
  if (!prev || !curr) return { reason: 'key_change', reasons: ['key_change'] };

  const reasons = [];

  if (prev.model !== curr.model) reasons.push('model_change');

  // Use WeakMap cache to avoid re-serialization without mutating entry objects
  const prevSystem = _getCachedJson(prevMainAgent, 'system');
  const currSystem = _getCachedJson(req, 'system');
  if (prevSystem !== currSystem) reasons.push('system_change');

  const prevTools = _getCachedJson(prevMainAgent, 'tools');
  const currTools = _getCachedJson(req, 'tools');
  if (prevTools !== currTools) reasons.push('tools_change');

  const prevMsgs = prev.messages || [];
  const currMsgs = curr.messages || [];
  if (currMsgs.length < prevMsgs.length) {
    reasons.push('msg_truncated');
  } else {
    const prefixLen = Math.min(prevMsgs.length, currMsgs.length);
    let prefixMatch = true;
    for (let j = 0; j < prefixLen; j++) {
      if (JSON.stringify(prevMsgs[j]) !== JSON.stringify(currMsgs[j])) {
        prefixMatch = false;
        break;
      }
    }
    if (!prefixMatch) reasons.push('msg_modified');
  }

  if (reasons.length === 0) reasons.push('key_change');
  return { reason: reasons[0], reasons };
}

export function analyzeCacheLoss(requests, index) {
  const req = requests[index];
  if (!isMainAgent(req)) return null;

  const usage = req.response?.body?.usage;
  if (!usage) return null;

  const cacheCreate = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  if (cacheCreate === 0 || cacheCreate <= cacheRead) return null;

  // 向前查找上一个 MainAgent
  let prevMainAgent = null;
  for (let i = index - 1; i >= 0; i--) {
    if (isMainAgent(requests[i])) {
      prevMainAgent = requests[i];
      break;
    }
  }

  // 冷启动首条，不标记
  if (!prevMainAgent) return null;
  // 还原被剪枝的 prev entry 以确保 messages 比较精确
  if (prevMainAgent._slimmed) {
    prevMainAgent = restoreSlimmedEntry(prevMainAgent, requests);
  }

  const gap = req.timestamp - prevMainAgent.timestamp;
  if (gap > 5 * 60 * 1000) return { reason: 'ttl' };

  // 精确判断 key_change 子类型
  const prev = stripPrivateKeys(prevMainAgent.body);
  const curr = stripPrivateKeys(req.body);
  if (!prev || !curr) return { reason: 'key_change' };

  const reasons = [];

  if (prev.model !== curr.model) reasons.push('model_change');
  if (JSON.stringify(prev.system) !== JSON.stringify(curr.system)) reasons.push('system_change');
  if (JSON.stringify(prev.tools) !== JSON.stringify(curr.tools)) reasons.push('tools_change');

  // 消息栈分析
  const prevMsgs = prev.messages || [];
  const currMsgs = curr.messages || [];
  if (currMsgs.length < prevMsgs.length) {
    reasons.push('msg_truncated');
  } else {
    // 检查前缀消息是否一致（正常追加时前缀应不变）
    const prefixLen = Math.min(prevMsgs.length, currMsgs.length);
    let prefixMatch = true;
    for (let i = 0; i < prefixLen; i++) {
      if (JSON.stringify(prevMsgs[i]) !== JSON.stringify(currMsgs[i])) {
        prefixMatch = false;
        break;
      }
    }
    if (!prefixMatch) reasons.push('msg_modified');
  }

  if (reasons.length === 0) return { reason: 'key_change' };
  return { reason: reasons[0], reasons };
}

export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function truncateText(text, maxLen) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

export function extractToolResultText(toolResult) {
  if (!toolResult.content) return String(toolResult.content ?? '');
  if (typeof toolResult.content === 'string') return toolResult.content;
  if (Array.isArray(toolResult.content)) {
    return toolResult.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }
  return JSON.stringify(toolResult.content);
}

// 模型配置：匹配规则、显示名、品牌色、SVG logo。
// 字段约定：
//   match        : 匹配模型名的正则（按数组顺序首次命中即止）
//   name         : 用于 avatar label 的短名
//   color        : avatar 背景色（CSS 变量或 literal）
//   svg          : 必填。静态 logo 字符串，由 dangerouslySetInnerHTML 渲染
//   svgAnimated  : 可选。流式响应期间显示的动画 logo；缺省时 ModelAvatar 自动回退到 svg。
//                  添加新动画版只需设置此字段，其他消费者无感。
const MODEL_PROVIDERS = [
  {
    match: /claude/i,
    name: 'Claude',
    color: 'var(--bg-model-avatar)',
    svg: '<svg t="1771495509570" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1570" width="200" height="200"><path d="M198.4 678.4l198.4-115.2 6.4-12.8H243.2l-96-6.4-102.4-6.4-19.2-6.4-25.6-25.6v-12.8l19.2-12.8h32l64 6.4 96 6.4 70.4 6.4L384 512h19.2V492.8l-6.4-6.4-102.4-64-108.8-76.8-51.2-38.4-32-19.2-19.2-25.6-6.4-38.4 32-32h44.8l38.4 32 83.2 64L384 364.8l12.8 12.8 6.4-6.4-6.4-12.8L339.2 256l-64-108.8-25.6-38.4-6.4-25.6c0-12.8-6.4-19.2-6.4-32l32-44.8 19.2-6.4 44.8 6.4 19.2 12.8 25.6 57.6 44.8 96 64 128 19.2 38.4 6.4 38.4 6.4 12.8h6.4V384l6.4-70.4 12.8-89.6 12.8-115.2 6.4-32 19.2-38.4 32-19.2 25.6 12.8 19.2 32v19.2l-32 70.4-19.2 121.6-19.2 83.2h6.4l12.8-12.8 44.8-57.6 70.4-89.6 32-32 38.4-38.4 25.6-19.2h44.8l32 51.2-12.8 51.2-51.2 57.6-38.4 51.2-51.2 70.4-38.4 57.6v6.4h6.4l121.6-25.6 64-12.8 76.8-12.8 38.4 19.2 6.4 19.2-12.8 32-83.2 19.2-96 19.2-147.2 32 64 6.4h96l128 6.4 32 19.2 25.6 38.4-6.4 19.2-51.2 25.6-70.4-12.8-160-38.4-57.6-12.8h-6.4v6.4l44.8 44.8 83.2 76.8 108.8 102.4 6.4 25.6-12.8 19.2h-12.8l-96-70.4-38.4-32-83.2-70.4h-6.4v6.4l19.2 25.6 102.4 147.2 6.4 44.8-6.4 12.8-25.6 6.4-25.6-6.4-57.6-83.2-64-83.2-51.2-83.2-6.4 6.4-25.6 307.2-12.8 12.8-32 12.8-25.6-19.2-12.8-32 12.8-64 19.2-83.2 12.8-64 12.8-83.2 6.4-25.6h-6.4l-64 83.2-96 128-70.4 76.8-19.2 6.4-32-12.8v-25.6l19.2-25.6 102.4-128 64-83.2 38.4-51.2v-6.4l-268.8 172.8-51.2 12.8-19.2-19.2v-32l12.8-12.8 76.8-57.6z m0 0" fill="#D97757" p-id="1571"></path></svg>',
    svgAnimated: modelClaudeAnimatedSvg,
  },
  {
    match: /gpt|o1|o3|o4/i,
    name: 'OpenAI',
    color: 'var(--bg-model-avatar)',
    svg: '<svg t="1771495569354" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2752" width="200" height="200"><path d="M565.265178 954.519092c-22.289934 0-48.400999-8.151747-67.952455-14.838727a103.425292 103.425292 0 0 1-26.875292-11.272338c-12.737105-7.769634-15.411897-8.342804-19.806198-24.773669 21.971506-5.158528 81.581157-41.905075 103.871091-55.342721 148.896757-89.159735 119.028246-10.444426 119.028246-364.981743 15.029784 3.566389 82.791182 32.415932 82.791182 57.316972 0 133.102747 20.570425 273.847757-52.604243 354.91943-22.799418 25.47421-91.834527 58.972796-138.388646 58.972796z m-433.061569-299.321966c258.626916 136.860193 184.369594 157.048504 357.721593 52.094759 44.579867-27.193719 90.433445-49.292596 132.593263-77.568969v101.896839c-95.528287 22.226248-272.319304 227.038896-419.050754 100.686815l-25.856323-25.155782c-37.319718-43.943012-45.344094-72.410442-45.344094-151.889977z m375.744596-19.105658c-19.933569-13.310275-79.479535-51.330533-101.896839-57.316972v-133.739602a1158.312326 1158.312326 0 0 0 101.896839-57.316973c43.943012 10.189684 70.690933 47.063603 114.633945 57.316973v127.371049c-17.831947 12.10025-95.846715 58.718054-114.633945 63.749211z m-426.693016-178.31947c0-63.685525-4.26693-90.306074 38.84817-145.776166 23.945757-30.88748 47.509402-39.612396 82.090641-57.953828v261.110652c44.134069 23.372588 83.873836 49.037854 129.345301 74.448379l131.765351 78.396881c-59.545966 15.921381-63.685525 61.32916-109.602788 33.753328-104.699003-62.730242-272.38299-129.345301-272.38299-243.91556z m866.123138 127.37105c0 79.543221-47.573087 161.188063-121.002497 178.31947v-165.582365c0-82.791182 9.743885-84.574377-48.910483-116.608196L565.265178 362.371082c15.79401-23.62733 22.608361-19.105657 48.146256-34.835982 41.714019-25.47421 39.039227-16.112438 117.053995 28.785857 94.190891 54.196382 216.849212 100.559444 216.849212 228.885777z m-541.326961-197.425127v-95.528287c43.751956-23.181531 90.688187-50.94842 133.357489-76.804743 82.154327-49.547338 95.528287-63.303412 185.006449-63.303412 48.464684 0 102.533695 36.746548 125.651541 65.405034 42.223503 52.22213 39.930824 92.662439 39.930824 151.125751-31.078536-16.494551-192.393971-121.002497-222.899337-121.002498s-229.650003 123.422547-261.110652 140.108155z m-50.94842 159.213812c-16.36718-10.95391-63.112355-39.99451-82.791183-44.579867 0-168.320842-33.880699-314.606493 67.952455-390.519639 56.043262-41.714019 113.169178-53.814269 181.376375-30.696423 25.47421 8.661231 35.536523 20.888852 56.36169 26.429493-11.781822 16.048752-80.68956 50.311565-102.278953 63.303412-154.564769 93.235608-120.620384 7.451206-120.620384 376.063024z m-292.953415 121.002498c0 169.148754 115.143429 280.853165 274.293556 273.847756 59.800708-2.674792 26.811606-7.705949 69.417222 25.47421 97.820966 76.741057 228.822091 73.747838 319.637649 1.018969a251.939936 251.939936 0 0 0 52.604244-55.661149c58.20857-85.274918-10.95391-45.598836 81.96327-83.619094 130.236898-53.241099 199.399378-217.358696 128.64476-355.428914-27.448461-53.559526-40.249252-28.849543-28.276373-104.699003 18.723544-118.582447-63.176041-230.032116-157.621674-269.771884-98.90362-41.586648-129.090559 12.737105-178.892639-37.574459A161.888604 161.888604 0 0 0 580.103905 28.913674C474.003821-27.766443 331.284559 1.528898 258.428319 93.681853c-81.326415 102.979494 9.489143 54.705866-92.407697 98.648878C15.149614 257.353652-33.251385 439.175825 41.579107 561.06992c56.807488 92.598753 20.570425 4.967471 20.570424 106.800625z" fill="#EFA474" p-id="2753"></path></svg>',
  },
  {
    match: /gemini/i,
    name: 'Gemini',
    color: 'var(--bg-model-avatar)',
    svg: '<svg t="1771495622863" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4556" width="200" height="200"><path d="M960 512.896A477.248 477.248 0 0 0 512.896 960h-1.792A477.184 477.184 0 0 0 64 512.896v-1.792A477.184 477.184 0 0 0 511.104 64h1.792A477.248 477.248 0 0 0 960 511.104z" fill="#448AFF" p-id="4557"></path></svg>',
  },
  {
    match: /qwen/i,
    name: 'Qwen',
    color: 'var(--bg-model-avatar)',
    svg: '<svg t="1771495640319" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="5634" width="200" height="200"><path d="M537.782857 57.161143c16.749714 29.44 33.426286 58.953143 50.102857 88.502857a7.68 7.68 0 0 0 6.692572 3.913143h236.873143c7.424 0 13.750857 4.681143 19.017142 13.933714l62.061715 109.677714c8.082286 14.372571 10.24 20.370286 1.024 35.693715a2262.893714 2262.893714 0 0 0-32.438857 55.478857l-15.652572 28.086857c-4.534857 8.338286-9.508571 11.922286-1.718857 21.833143l113.152 197.851428c7.314286 12.8 4.754286 21.065143-1.828571 32.841143-18.651429 33.499429-37.632 66.742857-56.978286 99.84-6.765714 11.593143-14.994286 16.018286-29.001143 15.798857a1833.398857 1833.398857 0 0 0-99.291429 0.658286 4.242286 4.242286 0 0 0-3.437714 2.157714 24571.830857 24571.830857 0 0 1-115.419428 202.24c-7.204571 12.507429-16.201143 15.469714-30.939429 15.506286-42.532571 0.146286-85.430857 0.182857-128.731429 0.109714a22.930286 22.930286 0 0 1-19.821714-11.556571l-56.978286-99.108571a3.84 3.84 0 0 0-3.547428-2.121143h-218.331429a76.288 76.288 0 0 1-34.377143-3.913143l-68.388571-118.198857a23.149714 23.149714 0 0 1-0.073143-23.04l51.492572-90.441143a8.448 8.448 0 0 0 0-8.411429 23594.496 23594.496 0 0 1-80.018286-139.593143L47.542857 425.325714c-6.838857-13.202286-7.387429-21.138286 4.022857-41.179428 19.858286-34.669714 39.570286-69.302857 59.209143-103.936 5.632-9.984 12.946286-14.262857 24.905143-14.262857 36.827429-0.182857 73.654857-0.182857 110.445714-0.073143 1.901714 0 3.657143-1.024 4.571429-2.669715l119.734857-208.859428a20.845714 20.845714 0 0 1 17.993143-10.496c22.381714-0.036571 44.946286 0 67.547428-0.256l43.410286-0.987429c14.555429-0.109714 30.866286 1.389714 38.4 14.518857z m-146.432 17.188571a2.56 2.56 0 0 0-2.194286 1.28l-122.331428 213.942857a6.692571 6.692571 0 0 1-5.741714 3.364572H138.788571c-2.377143 0-2.962286 1.060571-1.755428 3.145143l247.917714 433.334857c1.060571 1.792 0.548571 2.633143-1.462857 2.669714l-119.222857 0.658286a9.289143 9.289143 0 0 0-8.557714 4.937143l-56.32 98.56c-1.865143 3.328-0.914286 5.046857 2.925714 5.046857l243.858286 0.365714c1.974857 0 3.401143 0.841143 4.425142 2.56l59.867429 104.704c1.974857 3.474286 3.913143 3.510857 5.924571 0l213.577143-373.76 33.426286-58.953143a2.340571 2.340571 0 0 1 4.096 0l60.745143 107.958857a5.193143 5.193143 0 0 0 4.571428 2.633143l117.906286-0.841143a1.718857 1.718857 0 0 0 1.462857-2.56l-123.721143-217.014857a4.608 4.608 0 0 1 0-4.827428l12.507429-21.613715 47.798857-84.370285c1.024-1.755429 0.512-2.633143-1.499428-2.633143H392.521143c-2.486857 0-3.108571-1.097143-1.828572-3.291429l61.184-106.861714a4.571429 4.571429 0 0 0 0-4.864l-58.258285-102.253714a2.56 2.56 0 0 0-2.267429-1.316572z m268.361143 342.198857c1.974857 0 2.486857 0.841143 1.462857 2.56l-35.474286 62.500572-111.542857 195.620571a2.377143 2.377143 0 0 1-2.121143 1.243429 2.486857 2.486857 0 0 1-2.121142-1.243429l-147.346286-257.353143c-0.841143-1.462857-0.402286-2.230857 1.206857-2.304l9.216-0.512 286.793143-0.512h-0.073143z" fill="#7D5DED" p-id="5635"></path></svg>',
  },
  {
    match: /kimi|moonshot/i,
    name: 'Kimi',
    color: 'var(--bg-model-avatar)',
    svg: '<svg t="1771495664798" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6649" width="200" height="200"><path d="M731.062857 590.262857v318.317714h-148.589714V443.977143a146.285714 146.285714 0 0 1-146.285714 146.285714l-214.491429-0.036571v318.354285H73.142857V165.814857h148.553143v275.858286h180.882286l119.771428-275.858286h167.753143l-67.84 156.269714a255.524571 255.524571 0 0 1-106.678857 119.588572h66.925714a148.553143 148.553143 0 0 1 148.516572 148.589714z m120.758857-473.965714a99.035429 99.035429 0 0 1 0 198.070857h-99.035428V215.332571a99.035429 99.035429 0 0 1 99.035428-99.035428z" fill="currentColor" p-id="6650"></path></svg>',
  },
  {
    match: /glm|chatglm/i,
    name: 'GLM',
    color: 'var(--bg-model-avatar)',
    svg: '<svg data-name="glm" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 217.2 200"> <defs> <style> .st0 { fill: currentColor; } </style> </defs> <path class="st0" d="M86.8,190.4H0L131.3,4.8h85.8L86.8,190.4h0ZM212.8,190h-107.9l14.9-21.6c2.3-3.3,6-5.2,9.9-5.2h83.1v26.8h0ZM99.4,26.3c-2.3,3.3-6,5.2-9.9,5.2H6.4V4.8h107.9l-14.9,21.6Z"/> </svg>',
  },
  {
    match: /minimax|abab/i,
    name: 'MiniMax',
    color: 'var(--bg-model-avatar)',
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 8l4-4 4 4 4-4 4 4v8l-4 4-4-4-4 4-4-4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  },
  {
    match: /deepseek/i,
    name: 'DeepSeek',
    color: 'var(--bg-model-avatar)',
    svg: '<svg t="1771495947541" class="icon" viewBox="0 0 1391 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="11539" width="200" height="200"><path d="M1326.70201318 112.02090779c-12.94676356-6.47485468-18.53640721 5.86654827-26.0997327 12.13814316-2.57756953 2.02376031-4.77807747 4.65435413-6.9785854 7.08168819-18.91788751 20.63528526-41.02017805 34.19182812-69.92725218 32.57311444-42.23384508-2.42733405-78.29772513 11.12773591-110.16384908 44.10589703-6.77679853-40.66668282-29.28560862-64.94444203-63.55255448-80.52327231-17.95608583-8.09209545-36.06388005-16.1856638-48.63358202-33.78825438-8.74900746-12.5431898-11.12773591-26.50330641-15.52727888-40.26016327-2.7823022-8.29535522-5.56460442-16.79249731-14.92044538-18.20942411-10.19244639-1.61871367-14.16337637 7.08168818-18.15934561 14.36516325-15.93232553 29.74073376-22.12880269 62.51710799-21.49692994 95.69705596 1.36684831 74.65672404 32.27117059 134.13819156 93.62469006 176.42358804 6.9800583 4.8546681 8.77551959 9.71080912 6.57501165 16.79102439-4.17271686 14.56695011-9.18056624 28.7303265-13.55506995 43.29727663-2.78377509 9.30723537-6.95501906 11.32952278-16.74241882 7.28347507-33.66158524-14.36516325-62.745407-35.60875491-88.46513227-61.30196806-43.62425973-43.09548975-83.0772755-90.64060097-132.26613965-127.86659667a581.67054343 581.67054343 0 0 0-35.07703915-24.48101901c-50.20074429-49.77065841 6.57501167-90.63912807 19.72650789-95.49526908 13.73181759-5.05792788 4.77955037-22.4572587-39.65480265-22.25547181s-85.07599655 15.3770434-136.87041526 35.60875491c-7.58541892 3.03416756-15.55379103 5.25971475-23.69596499 7.08168819-47.03990759-9.10544849-95.84876434-11.12773591-146.8596019-5.26118765-96.02551195 10.92594905-172.73103555 57.25739323-229.12678412 136.36373875-67.72674425 95.09022244-83.68558192 203.13015422-64.13582165 315.82149435 20.48504978 118.76262107 79.88992666 217.09027084 171.13736114 293.97106918 94.6350973 79.71317902 203.61031862 118.76262107 327.93607117 111.27735913 75.51542292-4.45256725 159.57953934-14.77020989 254.41642354-96.71040901 23.92426399 12.13961607 49.03715574 16.99575708 90.66564019 20.63675815 32.09295007 3.03416756 62.97223311-1.61871367 86.87145788-6.67664152 37.45429471-8.09209545 34.84874013-43.49906349 21.31870939-49.97244528-109.7838417-52.19946535-85.68283009-30.95587367-107.58333373-48.15194474 55.78891504-67.37324899 139.85303146-137.3770918 172.73103555-364.17669887 2.60408167-18.00616433 0.40357375-29.33568711 0-43.90263724-0.20325977-8.90218873 1.76894914-12.34287584 11.75960867-13.35328309 27.49014733-3.23742733 54.19671351-10.92594905 78.70277179-24.68280588 71.11440706-39.65480265 99.81822142-104.80250446 106.59649284-182.89844271 1.01188015-11.9363563-0.20178686-24.27775924-12.56970195-30.54935413M706.87018452 814.87993343c-106.36966673-85.37941333-157.98733782-113.5014334-179.30604722-112.28776638-19.92829476 1.21366703-16.33737217 24.48101902-11.96286844 39.65480264 4.5777635 14.97199677 10.57098089 25.2896394 18.94145384 38.44113563 5.76786417 8.70040186 9.76383341 21.64863831-5.78995762 31.35944742-34.26841876 21.64863831-93.82647692-7.28347506-96.60730623-8.69892897-69.3454579-41.67856295-127.33635378-96.710409-168.1797842-171.97249368-39.45154288-72.43117687-62.33888747-150.1220685-66.13306983-233.07267483-1.01188015-20.02992464 4.77955037-27.11161282 24.27923214-30.75408682a235.19659216 235.19659216 0 0 1 77.91771774-2.02228741c108.59668681 16.18713669 201.05631542 65.75453531 278.54394728 144.25552022 44.23256614 44.71125762 77.69089163 98.12439001 112.1861365 150.32385536 36.64567431 55.43394691 76.0986901 108.24024576 126.29943438 151.53604947 17.72778682 15.17378365 31.86465106 26.7065662 45.41972102 35.20370829-40.84343042 4.65435413-108.99878765 5.66476139-155.60860936-31.96628094m51.00936468-334.83953883c0-8.90218873 6.9815312-15.98387693 15.75557791-15.98387693q2.98408908 0.05155138 5.36134463 1.01188017a15.85720779 15.85720779 0 0 1 10.16740714 14.97199676 15.78061715 15.78061715 0 0 1-15.73053865 15.98387691 15.60386953 15.60386953 0 0 1-15.55379103-15.98387691m158.39238446 82.95060635c-10.1423679 4.24930749-20.30830215 7.89178146-30.09570191 8.29535522-15.12370514 0.81009328-31.66286419-5.46150162-40.61513142-13.15002332-13.96011661-11.93782919-23.92573689-18.61447073-28.09845373-39.45301577-1.79546129-8.90218873-0.81009328-22.65904557 0.78505403-30.54935414 3.59092258-16.99575708-0.40504665-27.92023321-12.13961606-37.8343021-9.55910075-8.09356835-21.72522894-10.31911553-35.07703915-10.31911552-4.98281013 0-9.55910075-2.22407429-12.94823645-4.04604774a13.27669246 13.27669246 0 0 1-5.76639128-18.61299783c1.39041466-2.8323807 8.16868608-9.71228202 9.7623605-10.92594905 18.13136058-10.52090241 39.04649623-7.08021529 58.36795748 0.81009328 17.93104659 7.48526194 31.46107731 21.24359167 51.01083757 40.6666828 19.92829476 23.46913885 23.51921733 29.94399353 34.84874013 47.54511123 8.97877936 13.75685685 17.14746545 27.92023321 22.71206987 44.10442409 3.41270206 10.11732865-0.98684091 18.41121097-12.74644958 23.46913885" fill="#4D6BFE" p-id="11540"></path></svg>',
  },
];

// 按 modelName 缓存 modelInfo 对象，保证同名返回同引用。
// React.memo(ModelAvatar) 和 ChatMessage.shouldComponentUpdate 依赖引用稳定性跳过 re-render。
const _modelInfoCache = new Map();

export function getModelInfo(modelName) {
  if (!modelName) return null;
  const cached = _modelInfoCache.get(modelName);
  if (cached) return cached;
  let info = null;
  for (const provider of MODEL_PROVIDERS) {
    if (provider.match.test(modelName)) {
      info = {
        name: modelName.replace(/^claude-/, '').replace(/-\d{8,}$/, ''),
        provider: provider.name,
        color: provider.color,
        svg: provider.svg,
        svgAnimated: provider.svgAnimated || null,
      };
      break;
    }
  }
  if (!info) {
    // 未知模型，不设 svg，由 renderModelAvatar 使用兜底头像
    info = { name: modelName, provider: modelName, color: 'var(--bg-model-avatar)', svg: null };
  }
  _modelInfoCache.set(modelName, info);
  return info;
}

// 按模型族的 tool use 可靠性分级，决定自动审批默认倒计时秒数
const AUTO_APPROVE_DEFAULTS = {
  Claude: 3, OpenAI: 3,                  // Tier 1: tool use 成熟
  Gemini: 5, DeepSeek: 5, Qwen: 5,       // Tier 2: 原生支持，稍逊
  GLM: 10, Kimi: 10, MiniMax: 10,        // Tier 3: 较新，保守
};
const FALLBACK_AUTO_SECONDS = 10;

export function getAutoApproveDefault(modelName) {
  const info = getModelInfo(modelName);
  return (info && AUTO_APPROVE_DEFAULTS[info.provider]) || FALLBACK_AUTO_SECONDS;
}

export function getSvgAvatar(type) {
  if (type === 'user') {
    return '<svg viewBox="0 0 24 24"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>';
  }
  if (type === 'agent') {
    return '<svg viewBox="0 0 24 24"><path d="M12 2a2 2 0 012 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 017 7h1a1 1 0 011 1v3a1 1 0 01-1 1h-1.17A7 7 0 0113 22h-2a7 7 0 01-6.83-3H3a1 1 0 01-1-1v-3a1 1 0 011-1h1a7 7 0 017-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 012-2zM9.5 13a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm5 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"/></svg>';
  }
  // sub-agent: 根据类型匹配不同图标
  if (type === 'sub-search' || type === 'sub-explore') {
    return '<svg viewBox="0 0 1024 1024"><path d="M128.957606 76.608479v495.401496c0 20.428928-17.875312 38.304239-38.304239 38.304239S52.349127 592.438903 52.349127 572.009975V38.304239c0-20.428928 17.875312-38.304239 38.30424-38.304239h426.453865c20.428928 0 38.304239 17.875312 38.304239 38.304239s-17.875312 38.304239-38.304239 38.30424H128.957606z m127.680798 127.680798v495.401496c0 20.428928-17.875312 38.304239-38.304239 38.304239S180.029925 720.119701 180.029925 699.690773V165.985037c0-20.428928 17.875312-38.304239 38.30424-38.304239h426.453865c20.428928 0 38.304239 17.875312 38.304239 38.304239s-17.875312 38.304239-38.304239 38.30424H256.638404z m579.670823 291.112219v-150.663341H399.640898v515.830424h76.608479c0 38.304239 30.643392 68.947631 43.411471 89.376558h-145.55611c-33.197007 0-61.286783-28.089776-61.286783-63.840399V321.755611c0-35.750623 28.089776-63.840399 61.286783-63.840399h490.294264c33.197007 0 61.286783 28.089776 61.286784 63.840399V564.349127c-20.428928-22.982544-58.733167-56.179551-89.376559-68.947631zM486.46384 411.13217h255.361596c15.321696 0 25.53616 10.214464 25.53616 25.536159s-10.214464 25.53616-25.53616 25.53616H486.46384c-15.321696 0-25.53616-10.214464-25.536159-25.53616s10.214464-25.53616 25.536159-25.536159z m0 102.144638h102.144639c15.321696 0 25.53616 10.214464 25.536159 25.53616s-10.214464 25.53616-25.536159 25.536159h-102.144639c-15.321696 0-25.53616-10.214464-25.536159-25.536159s10.214464-25.53616 25.536159-25.53616z m503.062345 492.84788c-2.553616 2.553616-7.660848 10.214464-12.76808 10.214464-10.214464 10.214464-35.750623 10.214464-45.965088 0l-81.71571-71.501247c-28.089776 17.875312-63.840399 28.089776-99.591023 28.089776-102.144638 0-186.413965-84.269327-186.413965-186.413965s84.269327-186.413965 186.413965-186.413965 186.413965 84.269327 186.413965 186.413965c0 38.304239-10.214464 71.501247-30.643391 99.591022l81.715711 71.501247c12.76808 12.76808 12.76808 35.750623 2.553616 48.518703z m-240.039901-324.309227c-58.733167 0-104.698254 48.518703-104.698254 104.698255 0 58.733167 48.518703 104.698254 104.698254 104.698254s104.698254-48.518703 104.698255-104.698254c2.553616-58.733167-45.965087-104.698254-104.698255-104.698255z" fill="currentColor"/></svg>';
  }
  if (type === 'sub-plan') {
    return '<svg viewBox="0 0 1024 1024"><path d="M674.507676 598.338391 287.079856 598.338391c-14.136975 0-25.638937 11.499915-25.638937 25.63689 0 14.137998 11.501962 25.640983 25.638937 25.640983l387.42782 0c14.137998 0 25.640983-11.501962 25.640983-25.640983C700.148659 609.838306 688.646698 598.338391 674.507676 598.338391zM794.746154 384.583029c-14.137998 0-25.640983 11.501962-25.640983 25.63996l0 494.299873c0 0.130983 0 0.280386-0.001023 0.433882-0.899486 0.279363-2.665713 0.644683-5.764284 0.644683L200.047664 905.601426c-4.312212 0-7.564279-2.971681-7.564279-6.913457L192.483384 191.851493c0-4.493338 0.974188-8.28878 1.811252-9.821693l373.337917 0c14.136975 0 25.63996-11.501962 25.63996-25.63996 0-14.136975-11.501962-25.638937-25.63996-25.638937l-374.069581 0c-30.336936 0-52.357462 25.696242-52.357462 61.099566l0 706.836477c0 32.086789 26.396183 58.19133 58.84113 58.19133l563.293223 0c34.119075 0 57.042157-21.041222 57.042157-52.356438L820.382021 410.224012C820.383044 396.086014 808.883129 384.583029 794.746154 384.583029zM674.507676 745.295394 287.079856 745.295394c-14.136975 0-25.638937 11.499915-25.638937 25.63689 0 14.137998 11.501962 25.640983 25.638937 25.640983l387.42782 0c14.137998 0 25.640983-11.501962 25.640983-25.640983C700.148659 756.795309 688.646698 745.295394 674.507676 745.295394zM879.595634 157.107177c-3.77293-14.409175-12.871145-28.250414-24.964578-37.975916l-43.827181-35.240619c-12.880355-10.352789-29.27679-16.290011-44.986587-16.290011-16.876366 0-31.594579 6.747681-41.439808 18.995633l-19.624966 24.381293c-6.380314 7.968485-7.987928 17.577331-5.222955 26.916023l-114.241904 142.063553-2.486634 3.090385-22.812565 85.303828c-9.749038 30.859845 4.449335 48.075949 13.806447 55.608505 6.783497 5.450129 14.468526 8.728802 22.851451 9.754155 0.984421 0.246617 2.125407 0.488117 3.440355 0.632403 1.003863 0.110517 2.053776 0.167822 3.118014 0.167822l0.014326 0c4.588505 0 10.047844-0.9967 17.180288-3.13541l2.877537-1.065262 83.402525-41.897226 119.874181-149.07934c0.440022 0.017396 0.880043 0.032746 1.320065 0.032746 9.218966 0 17.411555-3.862981 23.077601-10.892071l19.562545-24.342408C880.924909 191.1976 884.15037 174.495196 879.595634 157.107177zM674.469813 348.564697l-56.738235 28.537963c-2.958378 0.579191-5.734608 1.684362-8.277524 3.296069-0.313132 0.198521-0.615007 0.385786-0.905626 0.562818 0.12382-0.318248 0.25378-0.639566 0.39295-0.971118 0.99977-2.437515 1.588171-5.022387 1.753947-7.702426l17.732873-66.078974 105.73209-131.488707 48.647977 39.113833L674.469813 348.564697zM831.385633 172.919305l-7.679913 9.550517-68.139913-54.779627 7.687076-9.56382c0.291642-0.132006 1.144056-0.38374 2.604314-0.38374 4.28356 0 9.735735 2.071172 13.570063 5.15644l43.832298 35.245735c3.493567 2.805906 6.421246 7.018857 7.642051 10.993378C831.497173 171.081447 831.492056 172.446537 831.385633 172.919305zM487.474932 291.067168l-200.394053 0c-14.136975 0-25.638937 11.501962-25.638937 25.63996 0 14.136975 11.501962 25.637913 25.638937 25.637913l200.394053 0c14.137998 0 25.63996-11.500938 25.63996-25.637913C513.114892 302.56913 501.611907 291.067168 487.474932 291.067168zM674.507676 438.023148 287.079856 438.023148c-14.136975 0-25.638937 11.500938-25.638937 25.638937s11.501962 25.638937 25.638937 25.638937l387.42782 0c14.137998 0 25.640983-11.501962 25.640983-25.638937S688.646698 438.023148 674.507676 438.023148z" fill="currentColor"/></svg>';
  }
  // teammate: team/collaboration icon (two people)
  if (type === 'teammate') {
    return '<svg viewBox="0 0 24 24"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" fill="currentColor"/></svg>';
  }
  // default: other sub-agent
  return '<svg viewBox="0 0 1024 1024"><path d="M810.666667 384l53.333333-117.333333L981.333333 213.333333l-117.333333-53.333333L810.666667 42.666667l-53.333334 117.333333L640 213.333333l117.333333 53.333334L810.666667 384zM810.666667 640l-53.333334 117.333333L640 810.666667l117.333333 53.333333L810.666667 981.333333l53.333333-117.333333L981.333333 810.666667l-117.333333-53.333334L810.666667 640zM490.666667 405.333333L384 170.666667 277.333333 405.333333 42.666667 512l234.666666 106.666667L384 853.333333l106.666667-234.666666L725.333333 512l-234.666666-106.666667z m-64.426667 148.906667L384 647.253333l-42.24-93.013333L248.746667 512l93.013333-42.24L384 376.746667l42.24 93.013333 93.013333 42.24-93.013333 42.24z" fill="currentColor"/></svg>';
}

export function formatTokenCount(n) {
  if (n == null || n === 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

/** 递归过滤对象中 _ 前缀的私有属性（由前端注入，非原始数据） */
export function stripPrivateKeys(obj) {
  if (Array.isArray(obj)) return obj.map(stripPrivateKeys);
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('_')) continue;
      result[key] = stripPrivateKeys(obj[key]);
    }
    return result;
  }
  return obj;
}

export function computeTokenStats(requests) {
  const byModel = {};
  for (const req of requests) {
    const usage = req.response?.body?.usage;
    if (!usage) continue;
    const model = req.body?.model || 'unknown';
    if (!byModel[model]) {
      byModel[model] = { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
    }
    const s = byModel[model];
    s.input += (usage.input_tokens || 0);
    s.output += (usage.output_tokens || 0);
    s.cacheCreation += (usage.cache_creation_input_tokens || 0);
    s.cacheRead += (usage.cache_read_input_tokens || 0);
  }
  return byModel;
}

export function computeCacheRebuildStats(requests) {
  const stats = {
    ttl: { count: 0, cacheCreate: 0 },
    system_change: { count: 0, cacheCreate: 0 },
    tools_change: { count: 0, cacheCreate: 0 },
    model_change: { count: 0, cacheCreate: 0 },
    msg_truncated: { count: 0, cacheCreate: 0 },
    msg_modified: { count: 0, cacheCreate: 0 },
    key_change: { count: 0, cacheCreate: 0 },
  };
  const lossMap = buildCacheLossMap(requests);
  for (const [i, result] of lossMap) {
    const cacheCreate = requests[i].response?.body?.usage?.cache_creation_input_tokens || 0;
    const reasons = result.reasons || [result.reason];
    for (const r of reasons) {
      if (stats[r]) {
        stats[r].count++;
        stats[r].cacheCreate += cacheCreate;
      }
    }
  }
  return stats;
}

export function computeToolUsageStats(requests) {
  const toolCounts = {};
  for (const req of requests) {
    const content = req.response?.body?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type === 'tool_use' && block.name) {
        toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;
      }
    }
  }
  return Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1]);
}

export function computeSkillUsageStats(requests) {
  const skillCounts = {};
  for (const req of requests) {
    const messages = req.body?.messages;
    if (!Array.isArray(messages)) continue;
    for (const msg of messages) {
      if (msg.role !== 'user') continue;
      const content = msg.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block.type !== 'text' || !isSkillText(block.text)) continue;
        const nameMatch = block.text.match(/^#\s+(.+)$/m);
        const skillName = nameMatch ? nameMatch[1] : 'Skill';
        skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
      }
    }
  }
  return Object.entries(skillCounts)
    .sort((a, b) => b[1] - a[1]);
}

export function isClaudeMdReminder(text) {
  if (typeof text !== 'string') return false;
  return text.includes('<system-reminder>') && text.includes('# claudeMd');
}

export function isSkillsReminder(text) {
  if (typeof text !== 'string') return false;
  return text.includes('<system-reminder>') && text.includes('skills are available');
}

export function hasClaudeMdReminder(body) {
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    const content = msg?.content;
    if (typeof content === 'string') {
      if (isClaudeMdReminder(content)) return true;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && isClaudeMdReminder(block.text)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function hasSkillsReminder(body) {
  // 与 extractLoadedSkills 的扫描范围对齐：system[] + messages[]
  if (Array.isArray(body?.system)) {
    for (const blk of body.system) {
      if (blk?.type === 'text' && isSkillsReminder(blk.text)) return true;
    }
  }
  const messages = body?.messages;
  if (!Array.isArray(messages)) return false;
  for (const msg of messages) {
    const content = msg?.content;
    if (typeof content === 'string') {
      if (isSkillsReminder(content)) return true;
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block.type === 'text' && isSkillsReminder(block.text)) {
          return true;
        }
      }
    }
  }
  return false;
}

// parseLoadedSkills 拆到独立文件 skillsParser.js（纯函数、无传递依赖），
// 方便 node --test 直接导入（contentFilter.js 的 ./teammateDetector import
// 未写 .js 后缀，会让任何 helpers.js 的传递测试挂掉）。
export { parseLoadedSkills } from './skillsParser.js';
import { parseLoadedSkills as _parseLoadedSkills } from './skillsParser.js';

// 从 requests 中挑出当前生效的 skills 列表。
// 策略：最新 MainAgent；单请求直取。不依赖 response.usage（skills 只来自 body）。
// 只扫 body.system[] 与 body.messages[*].content[*] 中 type==='text' 的块。
export function extractLoadedSkills(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return [];
  let chosen = null;
  if (requests.length === 1) {
    chosen = requests[0];
  } else {
    for (let i = requests.length - 1; i >= 0; i--) {
      if (isMainAgent(requests[i])) { chosen = requests[i]; break; }
    }
  }
  if (!chosen || !chosen.body) return [];
  const body = chosen.body;

  let last = null;
  if (Array.isArray(body.system)) {
    for (const blk of body.system) {
      if (blk?.type === 'text' && isSkillsReminder(blk.text)) last = blk.text;
    }
  }
  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      const c = msg?.content;
      if (typeof c === 'string') {
        if (isSkillsReminder(c)) last = c;
      } else if (Array.isArray(c)) {
        for (const blk of c) {
          if (blk?.type === 'text' && isSkillsReminder(blk.text)) last = blk.text;
        }
      }
    }
  }
  if (!last) return [];

  const m = /<system-reminder>([\s\S]*?)<\/system-reminder>/i.exec(last);
  return _parseLoadedSkills(m ? m[1] : last);
}

export function getModelShort(model) {
  if (!model) return null;
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8,}$/, '');
}

// ============== 请求过滤相关 ==============

/**
 * 判断请求是否为相关请求（过滤掉心跳、token计数、eval/sdk 请求、在途请求、历史遗留的状态0请求）
 */
export function isRelevantRequest(request) {
  if (!request) return false;
  const url = request.url || '';
  return !(
    request.isHeartbeat ||
    request.isCountTokens ||
    /\/api\/eval\/sdk-/.test(url) ||
    /\/messages\/count_tokens/.test(url) ||
    request.inProgress === true ||  // 过滤在途请求
    (request.response && request.response.status === 0) ||  // 兼容历史日志：过滤状态为0的请求
    (request.body?.max_tokens === 1 && !request.body?.system && (!request.body?.tools || request.body.tools.length === 0))  // 配额检查请求（单消息 "quota"，max_tokens=1）
  );
}

/**
 * 过滤出相关请求
 */
export function filterRelevantRequests(requests) {
  return requests.filter(isRelevantRequest);
}

/**
 * 从请求列表中查找前一个 MainAgent 请求的时间戳
 */
export function findPrevMainAgentTimestamp(requests, startIndex) {
  for (let i = startIndex - 1; i >= 0; i--) {
    if (isMainAgent(requests[i]) && requests[i].timestamp) {
      return requests[i].timestamp;
    }
  }
  return null;
}

/**
 * 从请求列表中提取最新 MainAgent 请求的 KV-cache 缓存内容
 * cache_control 是缓存断点标记，表示从开始到该标记位置的所有内容都被缓存
 * @param {Array} requests - 请求列表
 * @returns {Object|null} - { system: string[], messages: string[], tools: string[], cacheCreateTokens: number, cacheReadTokens: number }
 */
export function extractCachedContent(requests) {
  if (!Array.isArray(requests) || requests.length === 0) return null;

  // 单请求（DetailPanel 场景）：直接使用，不做类型过滤
  // 多请求（AppHeader fallback）：逆序找最新 MainAgent，避免 teammate/subAgent 劫持
  let chosen = null;
  if (requests.length === 1) {
    chosen = requests[0];
  } else {
    let latestMA = null;
    let latestMAWithUsage = null;
    for (let i = requests.length - 1; i >= 0; i--) {
      if (isMainAgent(requests[i])) {
        if (!latestMA) latestMA = requests[i];
        if (requests[i].response?.body?.usage) {
          latestMAWithUsage = requests[i];
          break;
        }
      }
    }
    chosen = latestMAWithUsage || latestMA;
  }

  if (!chosen || !chosen.body) return null;

  const body = chosen.body;
  const usage = chosen.response?.body?.usage;

  const result = {
    system: [],
    messages: [],
    tools: [],
    cacheCreateTokens: usage?.cache_creation_input_tokens || 0,
    cacheReadTokens: usage?.cache_read_input_tokens || 0,
  };

  // 提取 system：找到最后一个带 cache_control 的位置，提取从开始到该位置的所有内容
  if (Array.isArray(body.system)) {
    let lastCacheIndex = -1;
    for (let i = body.system.length - 1; i >= 0; i--) {
      if (body.system[i].cache_control) {
        lastCacheIndex = i;
        break;
      }
    }
    if (lastCacheIndex >= 0) {
      for (let i = 0; i <= lastCacheIndex; i++) {
        const block = body.system[i];
        if (block.type === 'text' && block.text) {
          result.system.push(block.text);
        }
      }
    }
  }

  // 提取 messages：找到最后一个带 cache_control 的消息，提取从开始到该位置的所有消息内容
  // 如果没有 cache_control 标记但有 cache_read（delta 重建/slim 还原后标记丢失），提取全部 messages
  if (Array.isArray(body.messages)) {
    let lastCacheIndex = -1;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const content = body.messages[i].content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.cache_control) {
            lastCacheIndex = i;
            break;
          }
        }
        if (lastCacheIndex >= 0) break;
      }
    }
    // Fallback: delta 重建 + slim 还原后 cache_control 标记可能丢失，
    // 但 cache_read > 0 说明 messages 确实被缓存了，提取全部
    if (lastCacheIndex < 0 && result.cacheReadTokens > 0 && body.messages.length > 0) {
      lastCacheIndex = body.messages.length - 1;
    }
    if (lastCacheIndex >= 0) {
      for (let i = 0; i <= lastCacheIndex; i++) {
        const msg = body.messages[i];
        const content = msg.content;
        if (typeof content === 'string') {
          result.messages.push(`[${msg.role}] ${content}`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              result.messages.push(`[${msg.role}] ${block.text}`);
            } else if (block.type === 'tool_use') {
              const inputStr = block.input ? JSON.stringify(block.input) : '';
              const preview = inputStr.length > 200 ? inputStr.substring(0, 200) + '...' : inputStr;
              result.messages.push(`[${msg.role}] ${block.name}(${preview})`);
            } else if (block.type === 'tool_result') {
              const toolText = extractToolResultText(block);
              if (toolText) {
                result.messages.push(`[tool_result: ${block.tool_use_id}] ${toolText}`);
              }
            }
          }
        }
      }
    }
  }

  // 提取 tools：API 缓存顺序为 tools → system → messages，
  // tools 作为 cache 前缀的一部分隐式被缓存（不需要自身有 cache_control 标记）。
  // 只要 system 有缓存内容（说明 cache 前缀存在），tools 就应被展示。
  // Keep in sync with lib/kv-cache-analyzer.js extractCachedContent
  if (Array.isArray(body.tools) && body.tools.length > 0 && result.system.length > 0) {
    for (const tool of body.tools) {
      result.tools.push(`${tool.name}: ${tool.description || ''}`);
    }
  }

  return result;
}

/**
 * 把 extractCachedContent 产出的 tools 字符串数组（"name: description"）
 * 拆分为内置工具和 MCP 工具两组。
 *
 * MCP 识别：name 匹配 /^mcp__(.+?)__(.+)$/，非贪心以支持 server 名含下划线
 * （例如 mcp__some_server_name__do_thing → server: "some_server_name", tool: "do_thing"）。
 *
 * 边界：
 * - tools 非数组或空 → { builtin: [], mcpByServer: new Map() }
 * - 项为空字符串 → 跳过
 * - 项无冒号 → 整串当 name，description 为空
 *
 * @param {string[]} tools
 * @returns {{ builtin: Array<{name:string, description:string}>, mcpByServer: Map<string, Array<{name:string, fullName:string, description:string}>> }}
 */
export function parseCachedTools(tools) {
  const builtin = [];
  const mcpByServer = new Map();
  if (!Array.isArray(tools)) return { builtin, mcpByServer };

  for (const raw of tools) {
    if (typeof raw !== 'string' || !raw) continue;
    const colonIdx = raw.indexOf(':');
    const name = colonIdx >= 0 ? raw.slice(0, colonIdx).trim() : raw.trim();
    const description = colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : '';
    if (!name) continue;

    const mcpMatch = /^mcp__(.+?)__(.+)$/.exec(name);
    if (mcpMatch) {
      const server = mcpMatch[1];
      const toolName = mcpMatch[2];
      if (!mcpByServer.has(server)) mcpByServer.set(server, []);
      mcpByServer.get(server).push({ name: toolName, fullName: name, description });
    } else {
      builtin.push({ name, description });
    }
  }

  return { builtin, mcpByServer };
}
