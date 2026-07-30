import { readFileSync, existsSync } from 'node:fs';
import { isMainAgentEntry, extractCachedContent } from './kv-cache-analyzer.js';
import { buildContextWindowEvent, getContextSizeForModel } from './context-watcher.js';
import { reconstructEntries } from './delta-reconstructor.js';
import { enrichEntry } from './enrich-plan-input.js';
import { enrichEntry as enrichWorkflowEntry } from './enrich-workflow.js';
import { sseWrite } from './wire-compress.js';

// 1.7.0: the v1 log-file tail (fs.watch + byte cursors + rotation follow)
// retired with the v1 write path — the live channel is server/lib/v2/
// live-feed.js. This module keeps what both eras share: the SSE client
// plumbing (sendToClients & friends), the per-entry broadcast pipeline
// (processWatchedEntry, used by the live feed), and readLogFile — the legacy
// v1 reader (no production caller; kept for tests and ad-hoc legacy reads).
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
    const entries = content.split(/\r?\n---\r?\n/).filter(line => line.trim());
    const parsed = entries.map(entry => {
      try {
        return JSON.parse(entry);
      } catch {
        return null;
      }
    }).filter(Boolean);
    const map = new Map();
    for (const entry of parsed) {
      const key = `${entry.timestamp}|${entry.url}`;
      map.set(key, entry);
    }
    return reconstructEntries(Array.from(map.values()));
  } catch (err) {
    console.error('Error reading log file:', err);
    return [];
  }
}

// SSE 单客户端 backpressure 容忍上限：连续未排空 > 此时长则视为 dead 客户端剔除。
// 与 server.js 同名常量值保持一致（避免循环依赖，此处单独 mirror）。
// 30s：避免大会话/重连重放时把短暂忙碌的渲染器误判为 dead 并触发重连风暴，详见 server.js 注释。
const SSE_BACKPRESSURE_TIMEOUT_MS = 30000;

function _removeClient(clients, client) {
  const idx = clients.indexOf(client);
  if (idx !== -1) clients.splice(idx, 1);
}

function _safeSseWrite(clients, client, payload) {
  if (client.destroyed === true || client.writable === false) {
    _removeClient(clients, client);
    return false;
  }
  let ok;
  try {
    // sseWrite routes through the client's negotiated Content-Encoding
    // (wire-compress.js) — a bare client.write here would corrupt compressed
    // streams. The drain listener below stays on the res: the encoder is
    // piped into it, so socket drain still propagates.
    ok = sseWrite(client, payload);
  } catch {
    _removeClient(clients, client);
    return false;
  }
  if (!ok) {
    if (!client._sseBackpressureSince) {
      client._sseBackpressureSince = Date.now();
      // On compressed clients the false write() came from the ENCODER (its
      // input buffer), whose own 'drain' fires when compression catches up —
      // the res may never emit 'drain' at all (compressed output is 20-80x
      // smaller than what the socket can absorb). Arming the reset on the
      // wrong stream would let the timeout below kill healthy clients.
      const pressured = client._wireEnc || client;
      pressured.once('drain', () => { client._sseBackpressureSince = 0; });
    } else if (Date.now() - client._sseBackpressureSince > SSE_BACKPRESSURE_TIMEOUT_MS) {
      _removeClient(clients, client);
      // Destroy the encoder first: end() alone leaves the 16MB brotli window
      // alive until TCP teardown of the already-stuck socket.
      try { if (client._wireEnc) client._wireEnc.destroy(); } catch {}
      try { client.end(); } catch {}
      return false;
    }
  }
  return true;
}

// Zero-client short-circuit (all four senders): the payload template is built
// BEFORE the client loop, so with no SSE consumer connected every broadcast
// still paid a full JSON.stringify — for reconstructed entries carrying
// cumulative messages that is a giant allocation for nothing.
export function sendToClients(clients, entry) {
  if (clients.length === 0) return;
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    _safeSseWrite(clients, clients[i], payload);
  }
}

export function sendEventToClients(clients, eventName, data) {
  if (clients.length === 0) return;
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    _safeSseWrite(clients, clients[i], payload);
  }
}

/** Like sendEventToClients but `json` is an ALREADY-serialized JSON string —
 *  wire v3 forwards raw stored lines verbatim without a parse/stringify trip. */
export function sendEventRawToClients(clients, eventName, json) {
  if (clients.length === 0) return;
  const payload = `event: ${eventName}\ndata: ${json}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    _safeSseWrite(clients, clients[i], payload);
  }
}

export function sendChunkToClients(clients, dataJson) {
  if (clients.length === 0) return;
  const payload = `event: load_chunk\ndata: ${dataJson}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    _safeSseWrite(clients, clients[i], payload);
  }
}

/**
 * Per-entry broadcast pipeline — the single processing path every live entry
 * takes on its way to the SSE clients, regardless of source (v1 file tail or
 * the v2 live feed): pid stamping, server-side delta reconstruction, plan/
 * workflow enrichment, client broadcast, plugin hook, kv-cache and
 * context-window side events.
 * @param {object} parsed - one parsed log entry (mutated in place)
 * @param {{reconstructor: object, clients: Array, getClaudePid: Function,
 *          runParallelHook: Function}} ctx
 */
export function processWatchedEntry(parsed, ctx) {
  const { reconstructor, clients, getClaudePid, runParallelHook } = ctx;
  if (!parsed.pid) parsed.pid = getClaudePid();
  reconstructor.reconstruct(parsed);
  try { enrichEntry(parsed); } catch {}
  try { enrichWorkflowEntry(parsed); } catch {}
  // Wire v3 (V3.S5): the flagged v2 live feed suppresses the full-entry
  // broadcast — clients rebuild entries from native lines + rows. The kv/
  // context side events below still fire (they are slim and file-agnostic).
  if (!ctx.suppressEntryBroadcast) sendToClients(clients, parsed);
  runParallelHook('onNewEntry', parsed).catch(() => {});
  if (isMainAgentEntry(parsed) && !parsed.inProgress) {
    const cached = extractCachedContent(parsed);
    if (cached) sendEventToClients(clients, 'kv_cache_content', cached);
    const usage = parsed.response?.body?.usage;
    if (usage) {
      const contextSize = getContextSizeForModel(parsed);
      const cwData = buildContextWindowEvent(usage, contextSize);
      if (cwData) sendEventToClients(clients, 'context_window', cwData);
    }
  }
}
