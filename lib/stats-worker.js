// Stats Worker — 后台线程，扫描 JSONL 日志生成项目级统计 JSON
import { parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

// 统计 schema 版本号，新增统计字段时递增，强制旧缓存失效重新解析
const STATS_VERSION = 8;

/**
 * 判断文本是否为系统注入文本（与 src/utils/contentFilter.js:isSystemText 保持同步）
 */
function isSystemText(text) {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^<[a-zA-Z_][\w-]*[\s>]/i.test(trimmed)) return true;
  if (/^\[SUGGESTION MODE:/i.test(trimmed)) return true;
  if (/^Your response was cut off because it exceeded the output token limit/i.test(trimmed)) return true;
  if (/^Base directory for this skill:/i.test(trimmed)) return true;
  return false;
}

/**
 * 剥离系统注入标签，保留标签外的用户文本（仅用于 string 类型 content 的混合内容场景）
 */
function stripSystemTags(text) {
  return text.replace(/<(system-reminder|local-command-caveat|project-reminder|important-instruction-reminders|file-modified-reminder|todo-reminder|user-prompt-submit-hook|local-command-stdout|command-name|task-notification|environment_details|context)\b[^>]*>[\s\S]*?<\/\1>/gi, '').trim();
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
    const content = readFileSync(filePath, 'utf-8');
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

  // 列出所有 JSONL 文件（排除 _temp.jsonl）
  let jsonlFiles;
  try {
    jsonlFiles = readdirSync(projectDir)
      .filter(f => f.endsWith('.jsonl') && !f.endsWith('_temp.jsonl'))
      .sort();
  } catch {
    return;
  }

  if (jsonlFiles.length === 0) return;

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
  };

  try {
    writeFileSync(statsFile, JSON.stringify(stats, null, 2));
  } catch (err) {
    parentPort?.postMessage({ type: 'error', message: `Failed to write stats: ${err.message}` });
  }
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
