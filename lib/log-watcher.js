import { readFileSync, existsSync, watchFile } from 'node:fs';

// 跟踪所有被 watch 的日志文件
const watchedFiles = new Map();

/**
 * Read and parse a JSONL log file.
 * @param {string} logFile - absolute path to the log file
 * @returns {Array} parsed and deduplicated entries
 */
export function readLogFile(logFile) {
  if (!existsSync(logFile)) {
    return [];
  }

  try {
    const content = readFileSync(logFile, 'utf-8');
    const entries = content.split('\n---\n').filter(line => line.trim());
    const parsed = entries.map(entry => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    }).filter(Boolean);
    // 去重：同一 timestamp+url 的条目，后出现的（带 response）覆盖先出现的（在途）
    const map = new Map();
    for (const entry of parsed) {
      const key = `${entry.timestamp}|${entry.url}`;
      map.set(key, entry);
    }
    return Array.from(map.values());
  } catch (err) {
    console.error('Error reading log file:', err);
    return [];
  }
}

/**
 * Send an SSE entry to all connected clients.
 * @param {Array} clients - SSE client array
 * @param {object} entry - parsed log entry
 */
export function sendToClients(clients, entry) {
  clients.forEach(client => {
    try {
      client.write(`data: ${JSON.stringify(entry)}\n\n`);
    } catch (err) {
      // Client disconnected
    }
  });
}

/**
 * Watch a log file for changes and broadcast new entries.
 * @param {object} opts
 * @param {string} opts.logFile - log file to watch
 * @param {Array} opts.clients - SSE clients array
 * @param {Function} opts.getClaudePid - returns Claude process PID
 * @param {Function} opts.runParallelHook - plugin hook runner
 * @param {Function} opts.notifyStatsWorker - stats worker notifier
 * @param {Function} opts.getLogFile - returns current LOG_FILE value
 */
export function watchLogFile(opts) {
  const { logFile, clients, getClaudePid, runParallelHook, notifyStatsWorker, getLogFile } = opts;
  if (watchedFiles.has(logFile)) return;
  let lastSize = 0;
  watchedFiles.set(logFile, true);
  watchFile(logFile, { interval: 500 }, () => {
    try {
      const content = readFileSync(logFile, 'utf-8');
      const newContent = content.slice(lastSize);
      lastSize = content.length;

      if (newContent.trim()) {
        const entries = newContent.split('\n---\n').filter(line => line.trim());
        entries.forEach(entry => {
          try {
            const parsed = JSON.parse(entry);
            // 注入 Claude 进程 PID：CLI 模式从 PTY 获取，非 CLI 模式使用当前进程 PID
            if (!parsed.pid) {
              parsed.pid = getClaudePid();
            }
            sendToClients(clients, parsed);
            runParallelHook('onNewEntry', parsed).catch(() => {});
          } catch (err) {
            // Skip invalid entries
          }
        });
        // 通知 stats worker 更新统计
        notifyStatsWorker(logFile);
      }

      // 检测日志文件是否已轮转到新文件
      const currentLogFile = getLogFile();
      if (currentLogFile !== logFile && !watchedFiles.has(currentLogFile)) {
        // 轮转发生，发送 full_reload 让客户端重新加载新文件
        const newEntries = readLogFile(currentLogFile);
        clients.forEach(client => {
          try {
            client.write(`event: full_reload\ndata: ${JSON.stringify(newEntries)}\n\n`);
          } catch { }
        });
        watchLogFile({ ...opts, logFile: currentLogFile });
      }
    } catch (err) {
      // File not yet created, will retry on next poll
    }
  });
}

/**
 * Start watching the current log file + install statusLine + context window.
 * @param {object} opts
 * @param {string} opts.logFile - current LOG_FILE
 * @param {Array} opts.clients - SSE clients array
 * @param {Function} opts.getClaudePid
 * @param {Function} opts.runParallelHook
 * @param {Function} opts.notifyStatsWorker
 * @param {Function} opts.installStatusLine
 * @param {Function} opts.watchContextWindow
 * @param {Function} opts.getLogFile
 */
export function startWatching(opts) {
  const { installStatusLine, watchContextWindow, clients, ...watchOpts } = opts;
  watchLogFile({ ...watchOpts, clients });
  installStatusLine();
  watchContextWindow(clients);
}

/** Get the watchedFiles Map (for cleanup in stopViewer). */
export function getWatchedFiles() {
  return watchedFiles;
}
