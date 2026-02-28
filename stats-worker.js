// Stats Worker — 后台线程，扫描 JSONL 日志生成项目级统计 JSON
import { parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

// 统计 schema 版本号，新增统计字段时递增，强制旧缓存失效重新解析
const STATS_VERSION = 2;

/**
 * 解析单个 JSONL 文件，提取模型使用次数和 token 统计
 * @param {string} filePath JSONL 文件绝对路径
 * @returns {{ models: Object, summary: Object }}
 */
function parseJsonlFile(filePath) {
  const models = {};
  let requestCount = 0;
  let sessionCount = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;

  try {
    const content = readFileSync(filePath, 'utf-8');
    if (!content.trim()) return { models, summary: { requestCount: 0, sessionCount: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } };

    const entries = content.split('\n---\n').filter(p => p.trim());
    for (const raw of entries) {
      try {
        const entry = JSON.parse(raw);
        requestCount++;

        // 会话轮次：MainAgent 且 messages.length === 1 表示一次新会话开始
        if (entry.mainAgent && Array.isArray(entry.body?.messages) && entry.body.messages.length === 1) {
          sessionCount++;
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

  return {
    models,
    summary: {
      requestCount,
      sessionCount,
      input_tokens: totalInput,
      output_tokens: totalOutput,
      cache_read_input_tokens: totalCacheRead,
      cache_creation_input_tokens: totalCacheCreation,
    },
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
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;

  for (const f of Object.values(filesStats)) {
    totalRequests += f.summary.requestCount;
    totalSessions += f.summary.sessionCount || 0;
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
