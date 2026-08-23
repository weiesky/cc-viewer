import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const SUBAGENT_SYSTEM_RE = /(?:command execution|file search|planning) specialist|general-purpose agent|security monitor|performing a web search/i;

// cc_version 2.1.181+：CLI 在 billing header 显式标注子代理（cc_is_subagent=true）；真·主代理省略此字段（从不为 =false）。
// 这类子代理继承完整 "You are Claude Code" prompt + Edit/Bash/Agent 工具，会误中轻量 MainAgent 启发式，故须显式排除。
// 结尾 \b 锚定：仅匹配 `=true`（其后为 `;` / 空白 / 串尾），避免 `=truex` 之类误匹配。
const SUBAGENT_BILLING_RE = /cc_is_subagent=true\b/;
// 同进程 Agent/Task 队友（teammate）：system prompt 注入团队协作标记，但继承完整 "You are Claude Code"
// prompt + Edit/Bash/Task 工具，且不带 --agent-name 进程参数（_isTeammate 认不出），会误中下方 MainAgent
// 启发式 → 流式期间被当 mainAgent 开 live-stream，其 thinking 污染主「最新回复」overlay。须显式排除。
// KEEP IN SYNC: server/lib/kv-cache-analyzer.js + @ccv/core/contentFilter（三处判据必须一致）。
// 两处服务端实现(本文件 + kv-cache-analyzer)由 packages/app/test/interceptor-core-mainagent.test.js 互校防漂移；
// 前端 contentFilter 那份由 test/content-filter-unit.test.js 单测覆盖。
const TEAMMATE_SYSTEM_RE = /running as an agent in a team|Agent Teammate Communication/i;
// 1.7.0: the last external consumer (teammate-detect.js) retired with the
// prev-segment backfill; kept unexported-in-spirit for the KEEP-IN-SYNC trio
// above (tests still cross-check the three copies).
export { TEAMMATE_SYSTEM_RE, SUBAGENT_BILLING_RE };

// Rotation carry-forward: prompt-prefix → teammate-name pairs extracted from a
// mainAgent response body's Agent tool_use blocks. Prefix normalization MUST
// match @ccv/core/contentFilter (trimStart BEFORE slice, length 60) —
// pinned by packages/app/test/interceptor.test.js parity cases.
export const TEAMMATE_PROMPT_PREFIX_LEN = 60;

export function extractAgentSpawnPairs(responseBody) {
  const pairs = [];
  // The interceptor's stream path can fall back to a raw string body.
  if (!responseBody || typeof responseBody !== 'object') return pairs;
  const content = responseBody.content;
  if (!Array.isArray(content)) return pairs;
  for (const block of content) {
    if (!block || block.type !== 'tool_use' || block.name !== 'Agent') continue;
    const inp = block.input;
    if (!inp || !inp.name || typeof inp.prompt !== 'string') continue;
    const prefix = inp.prompt.trimStart().slice(0, TEAMMATE_PROMPT_PREFIX_LEN);
    if (prefix) pairs.push([prefix, inp.name]);
  }
  return pairs;
}

export function getSystemText(body) {
  const system = body?.system;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system.map(s => (s && s.text) || '').join('');
  }
  return '';
}

export function isMainAgentRequest(body) {
  if (!body?.system || !Array.isArray(body?.tools)) return false;

  const sysText = getSystemText(body);
  // 同进程队友 ⇒ 非 MainAgent（与最终重建 isMainAgentEntry 判据对齐，修流式期 teammate thinking 污染主 overlay）。
  if (TEAMMATE_SYSTEM_RE.test(sysText)) return false;
  // cc_is_subagent=true ⇒ 子代理，绝非 MainAgent（cc_version 2.1.181+）。从源头让新日志的 mainAgent 字段为 false。
  if (SUBAGENT_BILLING_RE.test(sysText)) return false;
  // SDK 模式(ccv -SDK)主会话 base prompt 是 "...built on Anthropic's Claude Agent SDK."，
  // 非 CLI 的 "You are Claude Code"。SDK 子代理同用该 prompt,由下方工具启发式(缺 Agent/Task)排除;
  // native teammate 已由 TEAMMATE_SYSTEM_RE 排除。用精确子串,勿放宽成 "You are a Claude agent"(误中 teammate)。
  if (!sysText.includes('You are Claude Code') && !sysText.includes("built on Anthropic's Claude Agent SDK")) return false;
  if (SUBAGENT_SYSTEM_RE.test(sysText)) return false;

  const isSystemArray = Array.isArray(body.system);
  const hasToolSearch = body.tools.some(t => t.name === 'ToolSearch');

  if (isSystemArray && hasToolSearch) {
    const messages = body.messages || [];
    const firstMsgContent = messages.length > 0 ?
      (typeof messages[0].content === 'string' ? messages[0].content :
        Array.isArray(messages[0].content) ? messages[0].content.map(c => c.text || '').join('') : '') : '';
    if (firstMsgContent.includes('<available-deferred-tools>')) {
      return true;
    }
  }

  // v2.1.81+: 轻量 MainAgent 初始请求工具数可能 < 10，降低阈值兼容
  if (body.tools.length > 5) {
    const hasEdit = body.tools.some(t => t.name === 'Edit');
    const hasShell = body.tools.some(t => t.name === 'Bash' || t.name === 'PowerShell');
    const hasTaskOrAgent = body.tools.some(t => t.name === 'Task' || t.name === 'Agent');
    if (hasEdit && hasShell && hasTaskOrAgent) {
      return true;
    }
  }

  return false;
}

export function isPreflightEntry(entry) {
  if (entry.mainAgent || entry.isHeartbeat || entry.isCountTokens) return false;
  const body = entry.body || {};
  if (Array.isArray(body.tools) && body.tools.length > 0) return false;
  const msgs = body.messages || [];
  if (msgs.length !== 1 || msgs[0].role !== 'user') return false;
  const sysText = typeof body.system === 'string' ? body.system :
    Array.isArray(body.system) ? body.system.map(s => s?.text || '').join('') : '';
  return sysText.includes('Claude Code');
}

export function isAnthropicApiPath(urlStr) {
  try {
    const pathname = new URL(urlStr).pathname;
    // 不锚定起始 —— 兼容代理前缀路径（如 /proxy/group_xxx:8100/v1/messages）。
    // 末尾仍然锚定以避免 /v1/messages/unknown 这类无效后缀误命中。
    return /\/v1\/messages(\/count_tokens|\/batches(\/.*)?)?$/.test(pathname)
      || /^\/api\/eval\/sdk-/.test(pathname);
  } catch {
    return /\/v1\/messages/.test(urlStr);
  }
}

export function assembleStreamMessage(events) {
  let message = null;
  const contentBlocks = [];
  let currentBlockIndex = -1;

  for (const event of events) {
    if (!event || typeof event !== 'object' || !event.type) continue;

    switch (event.type) {
      case 'message_start':
        message = { ...event.message };
        message.content = [];
        break;

      case 'content_block_start':
        currentBlockIndex = event.index;
        contentBlocks[currentBlockIndex] = { ...event.content_block };
        if (contentBlocks[currentBlockIndex].type === 'text') {
          contentBlocks[currentBlockIndex].text = '';
        } else if (contentBlocks[currentBlockIndex].type === 'thinking') {
          contentBlocks[currentBlockIndex].thinking = '';
        }
        break;

      case 'content_block_delta':
        if (event.index >= 0 && contentBlocks[event.index] && event.delta) {
          if (event.delta.type === 'text_delta' && event.delta.text) {
            contentBlocks[event.index].text += event.delta.text;
          } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
            if (typeof contentBlocks[event.index]._inputJson !== 'string') {
              contentBlocks[event.index]._inputJson = '';
            }
            contentBlocks[event.index]._inputJson += event.delta.partial_json;
          } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
            contentBlocks[event.index].thinking += event.delta.thinking;
          } else if (event.delta.type === 'signature_delta' && event.delta.signature) {
            contentBlocks[event.index].signature = event.delta.signature;
          }
        }
        break;

      case 'content_block_stop':
        if (event.index >= 0 && contentBlocks[event.index]) {
          if (contentBlocks[event.index].type === 'tool_use' && typeof contentBlocks[event.index]._inputJson === 'string') {
            try {
              contentBlocks[event.index].input = JSON.parse(contentBlocks[event.index]._inputJson);
            } catch {
              contentBlocks[event.index].input = contentBlocks[event.index]._inputJson;
            }
            delete contentBlocks[event.index]._inputJson;
          }
        }
        break;

      case 'message_delta':
        if (message && event.delta) {
          if (event.delta.stop_reason) {
            message.stop_reason = event.delta.stop_reason;
          }
          if (event.delta.stop_sequence !== undefined) {
            message.stop_sequence = event.delta.stop_sequence;
          }
        }
        if (message && event.usage) {
          message.usage = { ...message.usage, ...event.usage };
        }
        break;

      case 'message_stop':
        break;
    }
  }

  if (message) {
    message.content = contentBlocks.filter(block => block !== undefined);
  }

  return message;
}

/**
 * Incremental stream assembler — mutable state for SSE live streaming.
 *
 * Usage:
 *   const asm = createStreamAssembler();
 *   asm.feed(event);          // consume each SSE event incrementally
 *   const snap = asm.snapshot();  // get current partial message
 *
 * Mirrors assembleStreamMessage but maintains mutable state for O(1) updates
 * rather than O(n) rebuild per call.
 */
export function createStreamAssembler() {
  let message = null;
  const contentBlocks = [];
  let currentBlockIndex = -1;

  return {
    feed(event) {
      if (!event || typeof event !== 'object' || !event.type) return;
      switch (event.type) {
        case 'message_start':
          message = { ...event.message };
          message.content = [];
          break;
        case 'content_block_start':
          currentBlockIndex = event.index;
          contentBlocks[currentBlockIndex] = { ...event.content_block };
          if (contentBlocks[currentBlockIndex].type === 'text') {
            contentBlocks[currentBlockIndex].text = '';
          } else if (contentBlocks[currentBlockIndex].type === 'thinking') {
            contentBlocks[currentBlockIndex].thinking = '';
          }
          break;
        case 'content_block_delta':
          if (event.index >= 0 && contentBlocks[event.index] && event.delta) {
            if (event.delta.type === 'text_delta' && event.delta.text) {
              contentBlocks[event.index].text += event.delta.text;
            } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
              if (typeof contentBlocks[event.index]._inputJson !== 'string') {
                contentBlocks[event.index]._inputJson = '';
              }
              contentBlocks[event.index]._inputJson += event.delta.partial_json;
            } else if (event.delta.type === 'thinking_delta' && event.delta.thinking) {
              contentBlocks[event.index].thinking += event.delta.thinking;
            } else if (event.delta.type === 'signature_delta' && event.delta.signature) {
              contentBlocks[event.index].signature = event.delta.signature;
            }
          }
          break;
        case 'content_block_stop':
          if (event.index >= 0 && contentBlocks[event.index]) {
            const blk = contentBlocks[event.index];
            if (blk.type === 'tool_use' && typeof blk._inputJson === 'string') {
              try { blk.input = JSON.parse(blk._inputJson); }
              catch { blk.input = blk._inputJson; }
              delete blk._inputJson;
            }
          }
          break;
        case 'message_delta':
          if (message && event.delta) {
            if (event.delta.stop_reason) message.stop_reason = event.delta.stop_reason;
            if (event.delta.stop_sequence !== undefined) message.stop_sequence = event.delta.stop_sequence;
          }
          if (message && event.usage) message.usage = { ...message.usage, ...event.usage };
          break;
      }
    },
    /**
     * Return a snapshot of the current message state.
     * For incomplete tool_use blocks (no content_block_stop yet), input is undefined
     * and _inputJsonPartial carries the raw accumulated string.
     * Deep clones to avoid mutation during live streaming.
     */
    snapshot() {
      if (!message) return null;
      const snapBlocks = [];
      for (let i = 0; i < contentBlocks.length; i++) {
        const b = contentBlocks[i];
        if (!b) continue;
        const clone = { ...b };
        if (b.type === 'tool_use' && typeof b._inputJson === 'string') {
          // Partial JSON - don't parse, expose as raw for UI hint
          clone._inputJsonPartial = b._inputJson;
          clone.input = undefined;
          delete clone._inputJson;
        }
        snapBlocks.push(clone);
      }
      return { ...message, content: snapBlocks };
    },
    hasMessage() { return message !== null; },
  };
}

// Log filename prefix (single source): v1 files were always `<project>_<ts>.jsonl`
// (`<pid>__`-prefixed variants came from the removed multi-instance feature and
// are excluded by the matcher below). Kept for the v1 lookups that still exist
// (migration-era readers, e.g. findRecentLog for IM).
export function logFilePrefix(projectName) {
  return `${projectName}_`;
}

// v1 log filename ownership test: starts with `<project>_` and does NOT carry
// the legacy `<pid>__<project>_` instance mark (any instance-tagged file
// contains `__<project>_` by construction; untagged files never do, even when
// the project name itself contains `__`).
export function logFileMatcher(projectName) {
  const p = logFilePrefix(projectName);
  const pidMark = `__${projectName}_`;
  return (f) => f.startsWith(p) && !f.includes(pidMark);
}

export function findRecentLog(dir, projectName) {
  try {
    const owns = logFileMatcher(projectName);
    const files = readdirSync(dir)
      // 排除 *_temp.jsonl：临时文件是未完成的写入态（resume 流程中途产物），
      // 不应被当作"最近完整日志"（否则 _temp 因 sort 排在正式文件之后会被误选）。
      .filter(f => owns(f) && f.endsWith('.jsonl') && !f.endsWith('_temp.jsonl'))
      .sort()
      .reverse();
    if (files.length === 0) return null;
    return join(dir, files[0]);
  } catch { }
  return null;
}

/**
 * 计算单条 message 的轻量身份指纹，用于 delta storage 的 in-place last-msg replace 检测。
 * 仅服务端 interceptor 使用 —— 触发 Plan C checkpoint 让客户端拿到 wire 真实内容。
 * 历史上客户端 sessionManager.js 也复用过此算法做 isInPlaceLastMsgReplace 短路，
 * 后被拆除（因 short-circuit 导致 same-ts 多记录被合并）；现单层防御仅靠服务端。
 *
 * 80 字符前缀 + tool_use_id 后 8 字符 + tool_result body 下钻取真实文本（避开 String(array)
 * 塌陷成 "[object Object]" 的 collision 坑）。
 */
export function fingerprintMsg(m) {
  if (!m) return '';
  const c = m.content;
  let snip = '';
  if (Array.isArray(c) && c.length > 0) {
    const f = c[0];
    if (f && typeof f === 'object') {
      if (f.type === 'text') {
        snip = String(f.text || '').slice(0, 80);
      } else if (f.type === 'tool_use') {
        snip = '<tool_use:' + (f.name || '?') + ':' + (f.id || '').slice(-8) + '>';
      } else if (f.type === 'tool_result') {
        let body = '';
        if (typeof f.content === 'string') body = f.content;
        else if (Array.isArray(f.content) && f.content[0]) {
          const cf = f.content[0];
          body = (typeof cf === 'string') ? cf : (cf.text || cf.type || '');
        }
        snip = '<tool_result:' + (f.tool_use_id || '').slice(-8) + ':' + String(body).slice(0, 40) + '>';
      } else {
        snip = '<' + (f.type || '?') + '>';
      }
    }
  } else if (typeof c === 'string') {
    snip = c.slice(0, 80);
  }
  return (m.role || '?') + ':' + snip.replace(/\s+/g, ' ').slice(0, 80);
}

/**
 * 在原始 JSON 字符串上定向替换顶层 "model" 字段的值，避免对巨型 wire body
 * （`-c` 重启后的全量 checkpoint 请求可达数十 MB）做二次 JSON.parse + 全量 re-stringify。
 *
 * 安全性依据：
 * - JSON 字符串值内的引号必然转义为 \"，裸 `"model":"<old>"` 字节序列只能出现在真实结构处；
 * - 候选必须满足成员边界（前一个非空白字符是 `{` 或 `,`）；
 * - 顶层 model 恒存在恒命中 → 嵌套对象若有同值 model 键则候选 ≥2 → 返回 null 由调用方
 *   回退 parse/stringify 旧路径（最坏退化为现状，绝不误改）。
 *
 * @param {string} jsonStr - 原始 wire body（紧凑或带单空格的 JSON 字符串）
 * @param {string} oldModel - 当前顶层 model 值（来自已解析的 body.model）
 * @param {string} newModel - 目标 model 值
 * @returns {string|null} 替换后的字符串；无法唯一定位时返回 null（调用方回退）
 */
export function replaceTopLevelModel(jsonStr, oldModel, newModel) {
  if (typeof jsonStr !== 'string' || typeof oldModel !== 'string' || !oldModel ||
      typeof newModel !== 'string' || !newModel) return null;
  const oldVal = JSON.stringify(oldModel);
  // 覆盖紧凑（JSON.stringify 默认）与冒号后单空格两种序列化形态；其它形态 → 0 候选 → 回退
  const needles = [`"model":${oldVal}`, `"model": ${oldVal}`];
  const candidates = [];
  for (const needle of needles) {
    let idx = jsonStr.indexOf(needle);
    while (idx !== -1) {
      // 成员边界校验：前一个非空白字符必须是 { 或 ,
      let p = idx - 1;
      while (p >= 0 && (jsonStr[p] === ' ' || jsonStr[p] === '\t' || jsonStr[p] === '\n' || jsonStr[p] === '\r')) p--;
      if (p >= 0 && (jsonStr[p] === '{' || jsonStr[p] === ',')) {
        candidates.push({ idx, needle });
      }
      idx = jsonStr.indexOf(needle, idx + 1);
    }
  }
  if (candidates.length !== 1) return null;
  const { idx, needle } = candidates[0];
  const replaced = needle.slice(0, needle.length - oldVal.length) + JSON.stringify(newModel);
  return jsonStr.slice(0, idx) + replaced + jsonStr.slice(idx + needle.length);
}

// proxy profile hot-switch 模型解析：按 request body 里 model 的家族名映射到 profile 的对应字段。
// 家族用**大小写不敏感子串**匹配（/opus/i 等），只认这几个已知家族单词——
// 因此 claude-opus-4-8、未来的 claude-opus-5 等任何版本都命中同一家族，版本升级无需重配。
// 字段直接沿用 Claude Code 的环境变量名以保持一致：
//   ANTHROPIC_MODEL              —— 主模型（catch-all 兜底；body.model 含 "fable"/"mythos"
//                                   及所有未识别家族均回落到它）
//   ANTHROPIC_DEFAULT_OPUS_MODEL   —— body.model 含 "opus"
//   ANTHROPIC_DEFAULT_SONNET_MODEL —— 含 "sonnet"
//   ANTHROPIC_DEFAULT_HAIKU_MODEL  —— 含 "haiku"
// 家族字段优先：opus/sonnet/haiku 各自命中专属字段；字段留空则回落到 ANTHROPIC_MODEL。
// 未识别家族（既不是 opus/sonnet/haiku 也不是 fable/mythos）→ ANTHROPIC_MODEL 兜底。
// 兼容旧数据：profile 未设任何新字段但有 activeModel（老结构）时，回退为旧的整体替换语义。
// 返回目标模型字符串；无需改写（无目标 / 目标同旧值 / 入参非法）时返回 null。
// [1m] 后缀（Claude Code 1M context 标记）默认忽略：所有 profile 模型字段值在比较前先剥除。
export function resolveProfileModel(oldModel, profile) {
  if (typeof oldModel !== 'string' || !oldModel || !profile || typeof profile !== 'object') return null;

  // Strip [1m] suffix (case-insensitive) from model names; Claude Code appends it
  // for 1M-context variants and it should not affect model matching/replacement.
  const strip1m = (s) => (typeof s === 'string' ? s.replace(/\[1m\]/gi, '').trim() : '');

  const opus = strip1m(profile.ANTHROPIC_DEFAULT_OPUS_MODEL);
  const sonnet = strip1m(profile.ANTHROPIC_DEFAULT_SONNET_MODEL);
  const haiku = strip1m(profile.ANTHROPIC_DEFAULT_HAIKU_MODEL);
  const primary = strip1m(profile.ANTHROPIC_MODEL);
  const hasNew = !!(primary || opus || sonnet || haiku);

  let target = '';
  if (hasNew) {
    // Family-specific fields take precedence; fall back to ANTHROPIC_MODEL when
    // the family field is empty/unset. ANTHROPIC_MODEL itself acts as the
    // catch-all default for any unrecognized family (including third-party models
    // like gpt-4o, deepseek-v4, K3/kimi, etc.).
    if (/opus/i.test(oldModel)) target = opus || primary;
    else if (/sonnet/i.test(oldModel)) target = sonnet || primary;
    else if (/haiku/i.test(oldModel)) target = haiku || primary;
    else if (/fable/i.test(oldModel) || /mythos/i.test(oldModel)) target = primary;
    else target = primary; // unrecognized family → ANTHROPIC_MODEL catch-all
  } else if (typeof profile.activeModel === 'string') {
    target = strip1m(profile.activeModel); // 旧数据整体替换语义
  }

  if (!target || target === strip1m(oldModel)) return null;
  return target;
}

// 旧配置迁移：老 profile 用 { models:[], activeModel } 做整体替换（不分家族，所有请求都换成
// activeModel）。新方案改用 ANTHROPIC_MODEL + 三个家族字段。为**忠实保留**旧的整体替换语义，
// 把 activeModel 填入全部四个模型字段（仅填空缺项，不覆盖用户已设值），这样 opus/sonnet/haiku/
// fable 各家族都仍命中同一模型；用户之后可在 UI 里按需拆分。丢弃遗留的 models / activeModel。
// 幂等：无遗留字段时原样返回、changed=false。纯函数，不落盘；调用方决定是否持久化。
export function migrateProxyProfile(p) {
  if (!p || typeof p !== 'object') return { profile: p, changed: false };
  const hasLegacy = ('activeModel' in p) || ('models' in p);
  if (!hasLegacy) return { profile: p, changed: false };
  const { models: _drop1, activeModel, ...rest } = p;
  const out = { ...rest };
  const am = typeof activeModel === 'string' ? activeModel.trim() : '';
  if (am) {
    // 保留整体替换：四个字段都回填 activeModel（已有值不动）
    for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']) {
      if (!out[k]) out[k] = am;
    }
  }
  return { profile: out, changed: true };
}

// 迁移整份 profiles 列表；返回 { profiles, changed }（任一 profile 变更即 changed=true）。
export function migrateProxyProfileList(profiles) {
  if (!Array.isArray(profiles)) return { profiles, changed: false };
  let changed = false;
  const migrated = profiles.map(p => {
    const r = migrateProxyProfile(p);
    if (r.changed) changed = true;
    return r.profile;
  });
  return { profiles: migrated, changed };
}

// proxy profile hot-switch 支持强制 output_config.effort（对应 CLAUDE_CODE_EFFORT_LEVEL）。
// 与 replaceTopLevelModel 同源思路：常见路径（body 里没有 output_config）走定向前插，
// 避免对多 MB wire body 做 JSON.parse + 全量 re-stringify（-c 重启后 checkpoint 可达数十 MB）。
//   - 前插：在顶层对象开括号 `{` 之后插入 `"output_config":{"effort":"<v>"}`（后跟逗号，除非对象为空）。
//     顶层永远以 `{` 开头，插入后仍是合法 JSON；且 JSON 重复键"后者胜"，但此路径仅在
//     调用方确认 body 无 output_config 时启用，不会产生重复键。
//   - 合并：body 已有 output_config（罕见，如 CLI 传了 --effort）时回退整体 parse/stringify，
//     把 effort 并入既有对象。此路径 O(n) 但极少触发，可接受。
// effort 值域受限（low/medium/high/xhigh/max），非法值 → null（调用方跳过注入）。
const _VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
export function injectOutputConfigEffort(jsonStr, effort, hasOutputConfig) {
  if (typeof jsonStr !== 'string' || !jsonStr) return null;
  if (typeof effort !== 'string' || !_VALID_EFFORTS.has(effort)) return null;
  if (hasOutputConfig) {
    // 已有 output_config：整体 parse/stringify 合并，保留既有子字段
    try {
      const obj = JSON.parse(jsonStr);
      if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
      if (!obj.output_config || typeof obj.output_config !== 'object' || Array.isArray(obj.output_config)) {
        obj.output_config = {};
      }
      obj.output_config.effort = effort;
      return JSON.stringify(obj);
    } catch { return null; }
  }
  // 无 output_config：定向前插
  const i = jsonStr.indexOf('{');
  if (i === -1) return null;
  // 顶层必须是对象：`{` 之前只允许空白，排除顶层数组（如 `[{...}]`）等把首个 `{` 误当顶层的情形。
  // 与合并路径的 Array.isArray 守卫对称。真实 /v1/messages body 恒为顶层对象。
  if (/\S/.test(jsonStr.slice(0, i))) return null;
  // 探测开括号后的首个非空白字符：若是 `}`（空对象）则不追加逗号，避免尾逗号非法 JSON
  const after = jsonStr.slice(i + 1);
  const m = after.match(/^\s*(\S)/);
  const needsComma = !!(m && m[1] !== '}');
  const insert = `"output_config":{"effort":${JSON.stringify(effort)}}` + (needsComma ? ',' : '');
  return jsonStr.slice(0, i + 1) + insert + jsonStr.slice(i + 1);
}

// ─── Per-role proxy assignment (main / subagent / teammate) ───
// Storage shape: <projectDir>/active-profile.json = { activeId, roles: { subagent, teammate } }.
// `activeId` stays the MAIN role id so older ccv versions reading the file keep working;
// a missing `roles` key (old files) normalizes to follow/follow. Role values:
//   'follow' (default; sub/teammate only) | 'max' (built-in Default = no rewrite) | profile id.
// A dangling id (profile deleted later) is kept in storage but resolves to follow at read time.

export const PROXY_ROLE_KEYS = ['subagent', 'teammate'];

// Positive role classification for the fetch hook. Teammates are detected two ways:
// separate OS processes carry --agent-name argv (isTeammate, passed by the caller); the
// newer IN-PROCESS native team members (CC 2.1.x agent teams, no argv) instead carry the
// team marker in the system prompt (TEAMMATE_SYSTEM_RE — the same KEEP-IN-SYNC trio
// isMainAgentRequest excludes by; verified against live session blobs). 'subagent' requires
// the explicit cc_is_subagent=true billing marker (CC ≥ 2.1.181) — older CC subagent
// requests, compaction and title-generation calls all fall into 'main' (today's behavior)
// rather than risk being rerouted to the subagent provider. Utility endpoints
// (count_tokens/heartbeat) follow the process-primary role: main in the leader process,
// teammate inside a teammate OS process (whose own conversation IS the primary one there).
export function classifyProxyRole(body, { isTeammate = false, isCountTokens = false, isHeartbeat = false } = {}) {
  if (isTeammate) return 'teammate';
  if (isCountTokens || isHeartbeat) return 'main';
  const sysText = getSystemText(body);
  if (TEAMMATE_SYSTEM_RE.test(sysText)) return 'teammate';
  if (SUBAGENT_BILLING_RE.test(sysText)) return 'subagent';
  return 'main';
}

// Single resolution path from stored role ids to the effective profile object.
// 'follow' / missing / dangling id → mainProfile; 'max' → null (explicit Default = no rewrite);
// a listed id → the profile object (or mainProfile when absent from the map).
export function resolveRoleProfile(role, roleIds, profilesById, mainProfile) {
  if (role === 'main') return mainProfile || null;
  const raw = roleIds && typeof roleIds === 'object' ? roleIds[role] : undefined;
  if (typeof raw !== 'string' || !raw || raw === 'follow') return mainProfile || null;
  if (raw === 'max') return null;
  const hit = profilesById && typeof profilesById.get === 'function' ? profilesById.get(raw) : undefined;
  return hit || mainProfile || null;
}

// Lenient shaping for values READ from disk / request bodies: keeps string values for known
// role keys, drops unknown keys and non-string values, defaults missing keys to 'follow'.
// Existence of a profile id is NOT enforced here (dangling ids resolve to follow downstream).
export function normalizeRoles(raw) {
  const out = { subagent: 'follow', teammate: 'follow' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of PROXY_ROLE_KEYS) {
    if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k];
  }
  return out;
}

// Merge semantics for workspace active-profile.json writes: a field left undefined preserves
// the stored value, so profile-list CRUD (active-only writes) can never clobber role
// assignments and role changes never clobber activeId. Per-key role merge: an incoming roles
// object missing a key preserves the stored one (NOT reset to follow).
// Note: only { activeId, roles } are carried — unknown future top-level keys are dropped
// (same blast radius as the old whole-file replace). When neither an incoming activeId nor
// a stored one exists, the key is OMITTED (not pinned to 'max') so the workspace keeps
// following the profile.json.active global fallback.
export function mergeActivePayload(existing, { activeId, roles } = {}) {
  const base = (existing && typeof existing === 'object' && !Array.isArray(existing)) ? existing : {};
  const mergedRoles = normalizeRoles(base.roles);
  if (roles !== undefined) {
    const inc = normalizeRoles(roles);
    for (const k of PROXY_ROLE_KEYS) {
      // normalizeRoles fills missing keys with 'follow'; distinguish "explicitly set to
      // follow" from "absent" by probing the raw incoming object.
      if (roles && typeof roles === 'object' && typeof roles[k] === 'string' && roles[k]) mergedRoles[k] = inc[k];
    }
  }
  const merged = {};
  if (activeId === undefined) {
    if (typeof base.activeId === 'string' && base.activeId) merged.activeId = base.activeId;
    // else: omit → reader falls back to the profile.json.active global default
  } else {
    merged.activeId = (typeof activeId === 'string' && activeId) ? activeId : 'max';
  }
  merged.roles = mergedRoles;
  return merged;
}

// Strict validation for POST-supplied role values: follow/max always allowed; any other string
// must reference an id present in the INCOMING profiles list (ids are validated against what
// will be persisted, not the old file).
export function isValidRoleValue(v, profilesById) {
  if (v === 'follow' || v === 'max') return true;
  if (typeof v !== 'string' || !v) return false;
  return !!(profilesById && typeof profilesById.get === 'function' && profilesById.get(v));
}
