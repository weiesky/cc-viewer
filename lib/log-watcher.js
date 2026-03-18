import { readFileSync, existsSync, watchFile, unwatchFile, openSync, readSync, closeSync, statSync } from 'node:fs';
import { isMainAgentEntry, extractCachedContent } from './kv-cache-analyzer.js';
import { buildContextWindowEvent, getContextSizeForModel } from './context-watcher.js';

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
 * Send a named SSE event to all connected clients.
 * @param {Array} clients - SSE client array
 * @param {string} eventName - SSE event name
 * @param {object} data - event payload
 */
export function sendEventToClients(clients, eventName, data) {
  clients.forEach(client => {
    try {
      client.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {}
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

  // Track byte offset instead of string length — avoids full-file re-read on every poll
  let lastByteOffset = 0;
  let pendingTail = ''; // incomplete entry carried across polls
  try {
    if (existsSync(logFile)) {
      lastByteOffset = statSync(logFile).size;
    }
  } catch {}

  watchedFiles.set(logFile, true);
  watchFile(logFile, { interval: 500 }, () => {
    try {
      const currentSize = statSync(logFile).size;

      // File truncated (rotation or clear) — reset offset
      if (currentSize < lastByteOffset) {
        lastByteOffset = 0;
        pendingTail = '';
      }

      if (currentSize <= lastByteOffset) return;

      // Read only the new bytes
      const bytesToRead = currentSize - lastByteOffset;
      const buf = Buffer.alloc(bytesToRead);
      const fd = openSync(logFile, 'r');
      try {
        readSync(fd, buf, 0, bytesToRead, lastByteOffset);
      } finally {
        closeSync(fd);
      }
      lastByteOffset = currentSize;

      const raw = pendingTail + buf.toString('utf-8');
      const parts = raw.split('\n---\n');

      // Last part may be incomplete — keep it for next poll
      pendingTail = parts.pop() || '';

      // If there's only the tail and no complete entries, check if tail is a complete entry
      // (happens when the file ends without a trailing \n---\n)
      if (parts.length === 0 && pendingTail.trim()) {
        try {
          JSON.parse(pendingTail);
          // Valid JSON — treat as complete entry
          parts.push(pendingTail);
          pendingTail = '';
        } catch {
          // Incomplete — keep in pendingTail for next poll
        }
      }

      const validParts = parts.filter(p => p.trim());
      if (validParts.length > 0) {
        validParts.forEach(entry => {
          try {
            const parsed = JSON.parse(entry);
            if (!parsed.pid) {
              parsed.pid = getClaudePid();
            }
            sendToClients(clients, parsed);
            runParallelHook('onNewEntry', parsed).catch(() => {});
            if (isMainAgentEntry(parsed)) {
              const cached = extractCachedContent(parsed);
              if (cached) {
                sendEventToClients(clients, 'kv_cache_content', cached);
              }
              const usage = parsed.response?.body?.usage;
              if (usage) {
                const contextSize = getContextSizeForModel(parsed.body?.model);
                const cwData = buildContextWindowEvent(usage, contextSize);
                if (cwData) {
                  sendEventToClients(clients, 'context_window', cwData);
                }
              }
            }
          } catch (err) {
            // Skip invalid entries
          }
        });
        notifyStatsWorker(logFile);
      }

      // 检测日志文件是否已轮转到新文件
      const currentLogFile = getLogFile();
      if (currentLogFile !== logFile && !watchedFiles.has(currentLogFile)) {
        // Unwatch old file to prevent watcher leak on rotation
        unwatchFile(logFile);
        watchedFiles.delete(logFile);

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
 * @param {Function} opts.getLogFile
 */
export function startWatching(opts) {
  const { clients, ...watchOpts } = opts;
  watchLogFile({ ...watchOpts, clients });
}

/** Get the watchedFiles Map (for cleanup in stopViewer). */
export function getWatchedFiles() {
  return watchedFiles;
}
