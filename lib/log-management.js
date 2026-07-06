import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, unlinkSync, realpathSync, renameSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { reconstructEntries } from './delta-reconstructor.js';
import { streamReconstructedEntries } from './log-stream.js';

/**
 * Validate that a resolved file path is contained within logDir.
 * Throws on invalid path (not found or path traversal).
 * @param {string} logDir - base log directory
 * @param {string} file - relative file path (e.g. "project/file.jsonl")
 * @returns {string} the real (resolved) path
 */
export function validateLogPath(logDir, file) {
  const filePath = join(logDir, file);
  if (!existsSync(filePath)) {
    const err = new Error('File not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  const realPath = realpathSync(filePath);
  const realLogDir = realpathSync(logDir);
  if (!realPath.startsWith(realLogDir)) {
    const err = new Error('Access denied');
    err.code = 'ACCESS_DENIED';
    throw err;
  }
  return realPath;
}

/**
 * List local log files grouped by project.
 * @param {string} logDir - base log directory
 * @param {string} currentProjectName - current project name (may be empty)
 * @returns {{ [project: string]: Array, _currentProject: string }}
 */
export function listLocalLogs(logDir, currentProjectName) {
  const grouped = {};
  if (existsSync(logDir)) {
    const entries = readdirSync(logDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const project = entry.name;
      const projectDir = join(logDir, project);
      const files = readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .sort()
        .reverse();
      // 从项目统计缓存中读取 per-file 数据，避免逐文件扫描
      let statsFiles = null;
      try {
        const statsFile = join(projectDir, `${project}.json`);
        if (existsSync(statsFile)) {
          statsFiles = JSON.parse(readFileSync(statsFile, 'utf-8')).files;
        }
      } catch { }
      for (const f of files) {
        const match = f.match(/^(.+?)_(\d{8}_\d{6})\.jsonl$/);
        if (!match) continue;
        const ts = match[2];
        const filePath = join(projectDir, f);
        const size = statSync(filePath).size;
        if (size === 0) continue; // 跳过空文件
        const turns = statsFiles?.[f]?.summary?.sessionCount || 0;
        if (!grouped[project]) grouped[project] = [];
        grouped[project].push({ file: `${project}/${f}`, timestamp: ts, size, turns, preview: statsFiles?.[f]?.preview || [] });
      }
    }
  }
  return { ...grouped, _currentProject: currentProjectName || '' };
}

/**
 * Read and parse a local log file.
 * @param {string} logDir - base log directory
 * @param {string} file - relative file path (e.g. "project/file.jsonl")
 * @returns {Array<Object>} parsed entries
 */
export function readLocalLog(logDir, file) {
  validateLogPath(logDir, file);
  const filePath = join(logDir, file);
  const content = readFileSync(filePath, 'utf-8');
  const parsed = content.split('\n---\n').filter(line => line.trim()).map(entry => {
    try { return JSON.parse(entry); } catch { return null; }
  }).filter(Boolean);
  // Delta storage: 先去重（timestamp|url），再重建 delta 条目
  const map = new Map();
  for (const entry of parsed) {
    const key = `${entry.timestamp}|${entry.url}`;
    map.set(key, entry);
  }
  return reconstructEntries(Array.from(map.values()));
}

/**
 * Delete log files. Returns per-file results.
 * @param {string} logDir - base log directory
 * @param {string[]} files - array of relative file paths
 * @returns {Array<{ file: string, ok?: boolean, error?: string }>}
 */
export function deleteLogFiles(logDir, files) {
  const results = [];
  for (const file of files) {
    if (!file || file.includes('..') || !file.endsWith('.jsonl')) {
      results.push({ file, error: 'Invalid file name' });
      continue;
    }
    const filePath = join(logDir, file);
    try {
      if (!existsSync(filePath)) {
        results.push({ file, error: 'Not found' });
        continue;
      }
      const realPath = realpathSync(filePath);
      const realLogDir = realpathSync(logDir);
      if (!realPath.startsWith(realLogDir)) {
        results.push({ file, error: 'Access denied' });
        continue;
      }
      unlinkSync(realPath);
      results.push({ file, ok: true });
    } catch (err) {
      results.push({ file, error: err.message });
    }
  }
  return results;
}

/**
 * Merge multiple log files into the first one, deleting the rest.
 * @param {string} logDir - base log directory
 * @param {string[]} files - array of relative file paths (at least 2, same project, chronological order)
 * @returns {string} the merged target file path (relative)
 */
export function mergeLogFiles(logDir, files) {
  if (!Array.isArray(files) || files.length < 2) {
    const err = new Error('At least 2 files required');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  // 校验所有文件属于同一 project
  const projects = new Set(files.map(f => f.split('/')[0]));
  if (projects.size !== 1) {
    const err = new Error('All files must belong to the same project');
    err.code = 'INVALID_INPUT';
    throw err;
  }
  // 校验文件存在且无路径穿越
  for (const f of files) {
    if (f.includes('..')) {
      const err = new Error('Invalid file path');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    if (!existsSync(join(logDir, f))) {
      const err = new Error(`File not found: ${f}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
  }
  // 校验合并后总大小不超过 300MB
  const MAX_MERGE_SIZE = 300 * 1024 * 1024;
  let totalSize = 0;
  for (const f of files) {
    totalSize += statSync(join(logDir, f)).size;
  }
  if (totalSize > MAX_MERGE_SIZE) {
    const err = new Error(`Merged size (${(totalSize / 1024 / 1024).toFixed(1)}MB) exceeds 300MB limit`);
    err.code = 'INVALID_INPUT';
    throw err;
  }
  // Delta storage: 流式合并 — 逐文件分段重建并直接写入目标文件，避免全量加载 OOM
  const targetFile = files[0];
  const targetPath = join(logDir, targetFile);
  // 先写到临时文件，成功后再覆盖目标
  const tmpPath = targetPath + '.merge-tmp';
  writeFileSync(tmpPath, ''); // 创建空临时文件
  for (const f of files) {
    const filePath = join(logDir, f);
    streamReconstructedEntries(filePath, (segment) => {
      let chunk = '';
      for (const entry of segment) {
        delete entry._deltaFormat;
        delete entry._totalMessageCount;
        delete entry._conversationId;
        delete entry._isCheckpoint;
        chunk += JSON.stringify(entry) + '\n---\n';
      }
      appendFileSync(tmpPath, chunk);
    });
  }
  // 临时文件写入成功后原子覆盖目标（POSIX renameSync 自动替换）
  renameSync(tmpPath, targetPath);
  // 删除其余文件
  for (let i = 1; i < files.length; i++) {
    unlinkSync(join(logDir, files[i]));
  }
  return targetFile;
}
