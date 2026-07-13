// Stats Worker — 后台线程，扫描 JSONL 日志生成项目级统计 JSON
import { parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { resolveJsonlPath } from './jsonl-archive.js';
import { aggregateRecords, mergeProxyFileCache } from './proxy-stats.js';

// 统计 schema 版本号，新增统计字段时递增，强制旧缓存失效重新解析
const STATS_VERSION = 10;

// 跨会话 / teammate 协议通知 type 白名单（须与 src/utils/contentFilter.js 的 INTER_SESSION_NOTIFICATION_TYPES
// 一致；新增 type 时两处都要加）。单一数组派生 Set（brace 扫描用）+ 正则（isSystemText 用），避免本文件内漂移。
// test/stats-worker-notification-filter.test.js 有 frontend↔server 同步守卫断言。
export const INTER_SESSION_TYPES = [
  'idle_notification', 'shutdown_request', 'shutdown_response', 'shutdown_approved',
  'teammate_terminated', 'plan_approval_request', 'plan_approval_response',
];
const INTER_SESSION_TYPES_SET = new Set(INTER_SESSION_TYPES);
const INTER_SESSION_TYPES_RE = new RegExp(`"type"\\s*:\\s*"(?:${INTER_SESSION_TYPES.join('|')})"`);

/**
 * 判断文本是否为系统注入文本。
 * 注意：这是服务端「子集」实现，只覆盖 project-stats 预览过滤所需规则，并非 contentFilter 的完整副本——
 * 完整分类（synthetic prompt、二次回收等）见 src/utils/contentFilter.js:isSystemText。前端(dist)与后端(server)
 * 分属两个 bundle、无法直接共享同一模块，故此处仅同步「会泄漏进预览」的关键规则：系统标签 + 跨会话队友通知。
 */
function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  // 包含 plan 内容的文本块不应被过滤（即使开头有系统标签）
  if (/Implement the following plan:/i.test(trimmed)) return false;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true; // 含 <teammate-message> 包裹形态
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  // 未包裹的跨会话队友通知：前缀行 / 新版 caveat / 裸协议 JSON —— 防泄漏进 stats 预览当成用户 prompt
  if (/^Another Claude session sent a message:/i.test(trimmed)) return true;
  if (/^This came from another Claude session\b/i.test(trimmed)) return true;
  if (trimmed.startsWith('{') && INTER_SESSION_TYPES_RE.test(trimmed)) return true;
  return false;
}

// 单次扫描剔除顶层协议通知 JSON（brace 配对，正确处理嵌套；跳过字符串字面量内的花括号 / 转义）。
// 与 src/utils/contentFilter.js 的 scanTopLevelJsonObjects + extractProtocolNotifications 同语义——
// 旧的 `\{[^{}]*...[^{}]*\}` 正则无法跨嵌套花括号，含嵌套字段的协议体（如 plan_approval_*）会漏剥。
function stripProtocolJson(s) {
  if (typeof s !== 'string' || s.indexOf('{') === -1) return s;
  let out = '', cursor = 0, depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        let j; try { j = JSON.parse(s.slice(start, i + 1)); } catch { j = null; }
        if (j && typeof j.type === 'string' && INTER_SESSION_TYPES_SET.has(j.type)) {
          out += s.slice(cursor, start);
          cursor = i + 1;
        }
        start = -1;
      }
    }
  }
  out += s.slice(cursor);
  return out;
}

/**
 * 剥离系统注入标签，保留标签外的用户文本（仅用于 string 类型 content 的混合内容场景）
 */
function stripSystemTags(text) {
  let out = text
    .replace(/<(system-reminder|local-command-caveat|project-reminder|important-instruction-reminders|file-modified-reminder|todo-reminder|user-prompt-submit-hook|local-command-stdout|command-name|task-notification|environment_details|context|teammate-message)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // 未包裹跨会话队友通知的 chrome：前缀行 + 两版 caveat + 裸协议 JSON（含嵌套），剥掉后回收用户混入正文
    .replace(/^Another Claude session sent a message:\s*/i, '')
    .replace(/(^|\n)This came from another Claude session[\s\S]*?(?=\n\n|$)/i, '')
    .replace(/(^|\n)IMPORTANT: This is NOT from your user[\s\S]*?(?=\n\n|$)/i, '');
  out = stripProtocolJson(out);
  return out.trim();
}

/**
 * 从 messages 数组中提取用户 prompt 文本列表
 * （与 src/App.jsx:extractUserTexts + src/utils/contentFilter.js:classifyUserContent 保持同步）
 */
function extractUserTexts(messages) {
  const texts = [];
  for (const msg of messages) {
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      // string content 可能混合系统标签与用户文本，先剥离标签再判断
      const text = stripSystemTags(msg.content).trim();
      if (text && !isSystemText(text)) {
        if (/^Implement the following plan:/i.test(text)) continue;
        texts.push(text);
      }
    } else if (Array.isArray(msg.content)) {
      const hasCommand = msg.content.some(b => b.type === 'text' && /<command-message>/i.test(b.text || ''));
      const userParts = [];
      for (const b of msg.content) {
        if (b.type !== 'text') continue;
        const text = (b.text || '').trim();
        if (!text || isSystemText(text)) continue;
        if (hasCommand && /<command-message>/i.test(text)) continue;
        if (/^Implement the following plan:/i.test(text)) continue;
        userParts.push(text);
      }
      if (userParts.length > 0) {
        texts.push(userParts.join(' '));
      }
    }
  }
  return texts;
}

/**
 * 检测请求是否为 SUGGESTION MODE（预测用户下一步输入）
 */
function isSuggestionMode(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  const last = messages[messages.length - 1];
  if (last?.role !== 'user') return false;
  const content = last.content;
  if (Array.isArray(content)) {
    return content.some(b => b.type === 'text' && /^\[SUGGESTION MODE:/i.test((b.text || '').trim()));
  }
  if (typeof content === 'string') return /^\[SUGGESTION MODE:/im.test(content.trim());
  return false;
}

/**
 * 解析单个 JSONL 文件，提取模型使用次数和 token 统计
 * @param {string} filePath JSONL 文件绝对路径
 * @returns {{ models: Object, summary: Object }}
 */
function parseJsonlFile(filePath) {
  const models = {};
  let requestCount = 0;
  let sessionCount = 0;
  let turnCount = 0;
  let maxMsgLen = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  const preview = [];
  let prevTextCount = 0;
  let lastCollectedSig = '';  // 上次收集的 prompt 签名，用于去重同轮重复请求

  try {
    const realPath = resolveJsonlPath(filePath);
    const content = readFileSync(realPath, 'utf-8');
    if (!content.trim()) return { models, summary: { requestCount: 0, sessionCount: 0, turnCount: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, preview: [] };

    const entries = content.split('\n---\n').filter(p => p.trim());
    for (const raw of entries) {
      try {
        const entry = JSON.parse(raw);
        requestCount++;

        // 会话轮次统计（仅 MainAgent，排除 SUGGESTION MODE）
        if (entry.mainAgent && Array.isArray(entry.body?.messages)) {
          const msgs = entry.body.messages;
          // Delta storage: 使用 _totalMessageCount（delta 条目）或 msgs.length（旧格式）
          const len = entry._totalMessageCount || msgs.length;
          if (!isSuggestionMode(msgs)) {
            // messages 数量大幅缩减：新会话（/clear 等），重置追踪
            if (len < maxMsgLen * 0.5 && (maxMsgLen - len) > 4) {
              maxMsgLen = 0;
              prevTextCount = 0;
            }
            const isNewTurn = len > maxMsgLen;
            if (isNewTurn) {
              maxMsgLen = len;
              turnCount++;
            }
            // 收集用户 prompt：新轮次 或 新会话（len===1 且非首次）
            // 用内容签名去重，避免同一轮的重复请求重复收集
            if (isNewTurn || (len === 1 && sessionCount > 0)) {
              if (len === 1 && !isNewTurn) {
                // 新会话但未触发 shrink 检测（上一会话较短），重置基线
                prevTextCount = 0;
                maxMsgLen = len;
              }
              const texts = extractUserTexts(msgs);
              // Delta storage: delta 条目的 msgs 只有新增部分，prevTextCount 不适用，从 0 开始收集
              const textStart = entry._deltaFormat ? 0 : prevTextCount;
              // 生成本次 prompt 签名，用于跳过同轮重复请求
              const sig = texts.join('\x00');
              if (sig === lastCollectedSig && !isNewTurn) {
                // 同一轮的重复请求（内容完全相同），跳过
              } else {
                for (let ti = textStart; ti < texts.length; ti++) {
                  const flat = texts[ti].replace(/[\r\n]+/g, ' ').trim();
                  if (flat) preview.push(flat.slice(0, 100));
                }
                prevTextCount = texts.length;
                lastCollectedSig = sig;
              }
            }
            if (len === 1) sessionCount++;
          }
        }

        // 提取模型名：优先 body.model，其次 response.body.model
        const model = entry.body?.model || entry.response?.body?.model;
        if (!model) continue;

        if (!models[model]) {
          models[model] = { count: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
        }
        models[model].count++;

        // 提取 usage — 可能在 response.body.usage
        const usage = entry.response?.body?.usage;
        if (usage) {
          const inp = usage.input_tokens || 0;
          const out = usage.output_tokens || 0;
          const cacheRead = usage.cache_read_input_tokens || usage.cache_creation_input_tokens ? (usage.cache_read_input_tokens || 0) : 0;
          const cacheCreate = usage.cache_creation_input_tokens || 0;

          models[model].input_tokens += inp;
          models[model].output_tokens += out;
          models[model].cache_read_input_tokens += cacheRead;
          models[model].cache_creation_input_tokens += cacheCreate;

          totalInput += inp;
          totalOutput += out;
          totalCacheRead += cacheRead;
          totalCacheCreation += cacheCreate;
        }
      } catch {
        // 跳过无法解析的条目
      }
    }
  } catch {
    // 文件读取失败
  }

  // 去重 preview：保留首次出现顺序，移除重复文本
  const seenPreview = new Set();
  const uniquePreview = [];
  for (const p of preview) {
    if (!seenPreview.has(p)) {
      seenPreview.add(p);
      uniquePreview.push(p);
    }
  }

  return {
    models,
    summary: {
      requestCount,
      sessionCount,
      turnCount,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_read_input_tokens: totalCacheRead,
      cache_creation_input_tokens: totalCacheCreation,
    },
    preview: uniquePreview,
  };
}

/**
 * 为单个项目生成或增量更新统计 JSON
 * @param {string} projectDir 项目日志目录
 * @param {string} projectName 项目名
 * @param {string|null} onlyFile 仅更新此文件（增量），null 表示智能增量
 */
function generateProjectStats(projectDir, projectName, onlyFile) {
  const statsFile = join(projectDir, `${projectName}.json`);

  // 读取已有统计（用于增量更新）
  let existing = null;
  try {
    if (existsSync(statsFile)) {
      existing = JSON.parse(readFileSync(statsFile, 'utf-8'));
    }
  } catch {
    existing = null;
  }

  // 列出所有 JSONL 文件（排除 _temp.jsonl 和 proxy_ 明细文件——后者由单独的 proxy 聚合分支处理）
  let jsonlFiles;
  try {
    jsonlFiles = readdirSync(projectDir)
      .filter(f => (f.endsWith('.jsonl') || f.endsWith('.jsonl.zip')) && !f.endsWith('_temp.jsonl') && !f.startsWith('proxy_'))
      .sort();
  } catch {
    return;
  }

  // 无会话 JSONL 且无 proxy 明细 → 无任何可统计内容，跳过。
  // 注意：不能仅凭 jsonlFiles.length===0 提前返回——proxy_ 明细文件可能单独存在，
  // 仍需走到 proxyStats 聚合分支。
  let proxyFiles = [];
  try {
    proxyFiles = readdirSync(projectDir).filter(f => f.startsWith('proxy_') && f.endsWith('.jsonl'));
  } catch { /* 目录读取失败已在上文 return */ }
  if (jsonlFiles.length === 0 && proxyFiles.length === 0) return;

  const filesStats = {};
  const topModels = {};

  for (const f of jsonlFiles) {
    const filePath = join(projectDir, f);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }

    const size = stat.size;
    const lastModified = stat.mtime.toISOString();

    // 增量优化：如果有已有统计且文件未变化且 schema 版本一致，直接复用
    if (existing?._v === STATS_VERSION
        && existing?.files?.[f] && existing.files[f].size === size && existing.files[f].lastModified === lastModified) {
      // 如果指定了 onlyFile 且不是此文件，跳过重新解析
      if (!onlyFile || onlyFile !== f) {
        filesStats[f] = existing.files[f];
        // 汇总模型
        if (filesStats[f].models) {
          for (const [model, data] of Object.entries(filesStats[f].models)) {
            if (!topModels[model]) topModels[model] = 0;
            topModels[model] += data.count;
          }
        }
        continue;
      }
    }

    // 需要重新解析
    const parsed = parseJsonlFile(filePath);
    filesStats[f] = {
      models: parsed.models,
      summary: parsed.summary,
      preview: parsed.preview,
      size,
      lastModified,
    };

    // 汇总模型使用次数
    for (const [model, data] of Object.entries(parsed.models)) {
      if (!topModels[model]) topModels[model] = 0;
      topModels[model] += data.count;
    }
  }

  // 计算全局汇总
  let totalRequests = 0;
  let totalSessions = 0;
  let totalTurns = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;

  for (const f of Object.values(filesStats)) {
    totalRequests += f.summary.requestCount;
    totalSessions += f.summary.sessionCount || 0;
    totalTurns += f.summary.turnCount || 0;
    totalInput += f.summary.input_tokens;
    totalOutput += f.summary.output_tokens;
    totalCacheRead += f.summary.cache_read_input_tokens;
    totalCacheCreation += f.summary.cache_creation_input_tokens;
  }

  // 代理重试明细聚合：扫描 proxy_YYYY-MM-DD.jsonl 文件，聚合成 proxyStats。
  // 与 token 统计同文件同 worker，避免新建独立 worker。明细文件按天分片，聚合逻辑在
  // proxy-stats.js:aggregateRecords（纯函数，可单测）。增量优化：仅对 size+mtime 变化的分片
  // 重新解析，未变化分片复用 proxyStatsFiles 缓存（mergeProxyFileCache），避免每次全量重扫历史。
  const { stats: proxyStats, cache: proxyStatsFiles } = aggregateProxyStats(projectDir, existing);

  const stats = {
    _v: STATS_VERSION,
    project: projectName,
    updatedAt: new Date().toISOString(),
    models: topModels,
    files: filesStats,
    summary: {
      requestCount: totalRequests,
      sessionCount: totalSessions,
      turnCount: totalTurns,
      fileCount: jsonlFiles.length,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_read_input_tokens: totalCacheRead,
      cache_creation_input_tokens: totalCacheCreation,
    },
    proxyStats,
    proxyStatsFiles, // 文件级增量缓存（records+size+lastModified），仅 worker 读，前端不消费
  };

  try {
    writeFileSync(statsFile, JSON.stringify(stats, null, 2));
  } catch (err) {
    parentPort?.postMessage({ type: 'error', message: `Failed to write stats: ${err.message}` });
  }
}

/**
 * 扫描项目目录下所有 proxy_YYYY-MM-DD.jsonl 明细文件，聚合成 proxyStats 结构。
 * 增量优化：proxy 明细按天分片且仅追加——文件 size+mtime 未变即内容未变，复用上次解析的 records，
 * 仅对变化/新增文件重新 readFileSync+解析（仿会话 JSONL 的 files[f] 缓存）。返回 { stats, cache }，
 * cache 须回写 stats JSON 供下次运行读取，避免每次 notifyProxyStats 全量重扫历史分片。
 *
 * @param {string} projectDir
 * @param {object} existing 上次的完整 stats JSON（读 proxyStatsFiles 缓存）；可为 null
 * @returns {{stats:object, cache:object}} 聚合结果 + 新文件缓存
 */
function aggregateProxyStats(projectDir, existing) {
  let proxyFiles = [];
  try {
    proxyFiles = readdirSync(projectDir)
      .filter(f => f.startsWith('proxy_') && f.endsWith('.jsonl'))
      .sort();
  } catch {
    return { stats: aggregateRecords([]), cache: {} };
  }
  if (proxyFiles.length === 0) return { stats: aggregateRecords([]), cache: {} };

  // 上次缓存（仅当 schema 版本一致时复用，避免旧结构污染）
  const cachedFiles = (existing?._v === STATS_VERSION && existing?.proxyStatsFiles) ? existing.proxyStatsFiles : {};

  const files = [];
  for (const f of proxyFiles) {
    const filePath = join(projectDir, f);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue; // stat 失败跳过此文件
    }
    const size = stat.size;
    const lastModified = stat.mtime.toISOString();
    const cached = cachedFiles[f];
    const unchanged = cached && cached.size === size && cached.lastModified === lastModified;
    if (unchanged) {
      // 命中缓存：不传 records，由 mergeProxyFileCache 复用 cached.records
      files.push({ name: f, size, lastModified });
    } else {
      // 变化/新增：重新解析记录（仅变化文件）
      const records = [];
      try {
        const content = readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            records.push(JSON.parse(trimmed));
          } catch {
            // 跳过无法解析的行
          }
        }
      } catch {
        // 文件读取失败：跳过（不进 cache，下次仍会重试）
        continue;
      }
      files.push({ name: f, size, lastModified, records });
    }
  }

  const { records: allRecords, cache } = mergeProxyFileCache({ existingCache: cachedFiles, files });
  return { stats: aggregateRecords(allRecords), cache };
}

/**
 * 扫描 logDir 下所有项目目录，逐个生成统计
 */
function scanAllProjects(logDir) {
  try {
    const entries = readdirSync(logDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = join(logDir, entry.name);
      generateProjectStats(projectDir, entry.name, null);
    }
    parentPort?.postMessage({ type: 'scan-all-done' });
  } catch (err) {
    parentPort?.postMessage({ type: 'error', message: `scan-all failed: ${err.message}` });
    parentPort?.postMessage({ type: 'scan-all-done' });
  }
}

// 供单元测试引用的内部纯函数（worker 入口逻辑走 parentPort，不受 export 影响）
export { isSystemText, extractUserTexts };

// Worker 消息处理
parentPort?.on('message', (msg) => {
  switch (msg.type) {
    case 'init': {
      const { logDir, projectName } = msg;
      const projectDir = join(logDir, projectName);
      if (existsSync(projectDir)) {
        generateProjectStats(projectDir, projectName, null);
        parentPort?.postMessage({ type: 'init-done', projectName });
      }
      break;
    }
    case 'update': {
      const { logDir, projectName, logFile } = msg;
      const projectDir = join(logDir, projectName);
      const fileName = basename(logFile);
      if (existsSync(projectDir)) {
        generateProjectStats(projectDir, projectName, fileName);
        parentPort?.postMessage({ type: 'update-done', projectName, logFile: fileName });
      }
      break;
    }
    case 'scan-all': {
      const { logDir } = msg;
      scanAllProjects(logDir);
      break;
    }
  }
});
