import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createReportServer } from './lib/report-server.mjs';

// --- Passive collection (onNewEntry) state ---
const logDir = process.env.CCV_LOG_DIR || join(homedir(), '.claude', 'cc-viewer');
const outputFile = join(logDir, 'tmp', 'context-engineering-evaluator-report.json');
const serviceInfoFile = join(logDir, 'tmp', 'context-engineering-evaluator-service.json');

let loaded = false;
let report = { updatedAt: null, totalEntries: 0, groups: {} };
let announcedReady = false;

// --- Report server (CC Insight) ---
let reportSrv = null;

function ensureDir() {
  const dir = dirname(outputFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadReport() {
  if (loaded) return;
  loaded = true;
  try {
    if (existsSync(outputFile)) {
      const data = JSON.parse(readFileSync(outputFile, 'utf-8'));
      if (data && typeof data === 'object' && data.groups) report = data;
    }
  } catch {}
}

function saveReport() {
  try {
    ensureDir();
    report.updatedAt = new Date().toISOString();
    writeFileSync(outputFile, JSON.stringify(report, null, 2));
    writeServiceInfo();
  } catch {}
}

function writeServiceInfo() {
  try {
    ensureDir();
    writeFileSync(serviceInfoFile, JSON.stringify({
      reportServerUrl: reportSrv?.getUrl() || null,
      reportFile: outputFile,
      updatedAt: report.updatedAt || null,
      totalEntries: Number(report.totalEntries || 0),
      ready: report.totalEntries > 0,
    }, null, 2));
  } catch {}
}

function extractTextMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const msg of messages) {
    if (!msg || msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      out.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block?.type === 'text' && typeof block.text === 'string') out.push(block.text);
      }
    }
  }
  return out;
}

function extractTag(texts, keys) {
  for (const text of texts) {
    for (const key of keys) {
      const re = new RegExp(`\\[${key}\\s*[:=]\\s*([^\\]\\s]+)\\]`, 'i');
      const m = text.match(re);
      if (m?.[1]) return m[1];
    }
  }
  return null;
}

function countToolUses(body) {
  const content = body?.content;
  if (!Array.isArray(content)) return 0;
  let count = 0;
  for (const block of content) {
    if (block?.type === 'tool_use') count++;
  }
  return count;
}

function ensureGroup(groupKey, tags) {
  if (!report.groups[groupKey]) {
    report.groups[groupKey] = {
      ...tags,
      requestCount: 0, errorCount: 0, durationMsTotal: 0,
      inputTokens: 0, outputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0,
      toolUseCount: 0, firstSeenAt: null, lastSeenAt: null,
    };
  }
  return report.groups[groupKey];
}

function updateGroup(group, entry) {
  group.requestCount += 1;
  group.durationMsTotal += Number(entry.duration || 0);
  if (entry.response?.status >= 400) group.errorCount += 1;
  const usage = entry.response?.body?.usage || {};
  group.inputTokens += Number(usage.input_tokens || 0);
  group.outputTokens += Number(usage.output_tokens || 0);
  group.cacheReadTokens += Number(usage.cache_read_input_tokens || 0);
  group.cacheCreationTokens += Number(usage.cache_creation_input_tokens || 0);
  group.toolUseCount += countToolUses(entry.response?.body);
  const ts = entry.timestamp || new Date().toISOString();
  if (!group.firstSeenAt) group.firstSeenAt = ts;
  group.lastSeenAt = ts;
}

function buildRows() {
  const groups = report?.groups && typeof report.groups === 'object' ? Object.values(report.groups) : [];
  return groups.map((g) => {
    const requestCount = Number(g.requestCount || 0);
    const inputTokens = Number(g.inputTokens || 0);
    const outputTokens = Number(g.outputTokens || 0);
    return {
      artifact_type: g.artifact_type || 'unknown',
      variant: g.variant || 'unknown',
      teammate: g.teammate || 'main',
      sample_id: g.sample_id || 'unknown',
      requestCount,
      errorCount: Number(g.errorCount || 0),
      durationMsTotal: Number(g.durationMsTotal || 0),
      avgDurationMs: requestCount > 0 ? Number(g.durationMsTotal || 0) / requestCount : 0,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheReadTokens: Number(g.cacheReadTokens || 0),
      cacheCreationTokens: Number(g.cacheCreationTokens || 0),
      toolUseCount: Number(g.toolUseCount || 0),
      firstSeenAt: g.firstSeenAt || null,
      lastSeenAt: g.lastSeenAt || null,
    };
  });
}

function buildSummary(rows) {
  const byVariant = {};
  for (const row of rows) {
    const key = `${row.artifact_type}::${row.variant}`;
    if (!byVariant[key]) {
      byVariant[key] = {
        artifact_type: row.artifact_type, variant: row.variant,
        groupCount: 0, requestCount: 0, errorCount: 0, durationMsTotal: 0,
        inputTokens: 0, outputTokens: 0, totalTokens: 0,
        cacheReadTokens: 0, cacheCreationTokens: 0, toolUseCount: 0,
      };
    }
    const item = byVariant[key];
    item.groupCount += 1;
    item.requestCount += row.requestCount;
    item.errorCount += row.errorCount;
    item.durationMsTotal += row.durationMsTotal;
    item.inputTokens += row.inputTokens;
    item.outputTokens += row.outputTokens;
    item.totalTokens += row.totalTokens;
    item.cacheReadTokens += row.cacheReadTokens;
    item.cacheCreationTokens += row.cacheCreationTokens;
    item.toolUseCount += row.toolUseCount;
  }
  return Object.values(byVariant).map((item) => ({
    ...item,
    avgDurationMs: item.requestCount > 0 ? item.durationMsTotal / item.requestCount : 0,
    errorRate: item.requestCount > 0 ? item.errorCount / item.requestCount : 0,
  })).sort((a, b) => a.artifact_type.localeCompare(b.artifact_type) || a.variant.localeCompare(b.variant));
}

function filterRows(rows, query = {}) {
  return rows.filter((row) => {
    if (query.artifact_type && row.artifact_type !== query.artifact_type) return false;
    if (query.variant && row.variant !== query.variant) return false;
    if (query.teammate && row.teammate !== query.teammate) return false;
    if (query.sample_id && row.sample_id !== query.sample_id) return false;
    return true;
  }).sort((a, b) =>
    a.artifact_type.localeCompare(b.artifact_type) ||
    a.variant.localeCompare(b.variant) ||
    a.teammate.localeCompare(b.teammate) ||
    a.sample_id.localeCompare(b.sample_id),
  );
}

function toPayload(query = {}) {
  loadReport();
  const rows = filterRows(buildRows(), query);
  return {
    updatedAt: report.updatedAt || null,
    totalEntries: Number(report.totalEntries || 0),
    rowCount: rows.length,
    summary: buildSummary(rows),
    rows,
    reportServerUrl: reportSrv?.getUrl() || null,
  };
}

export default {
  name: 'cc-insight',
  hooks: {
    async onNewEntry(entry) {
      if (!entry || (!entry.mainAgent && !entry.teammate)) return;
      loadReport();
      report.totalEntries += 1;

      const texts = extractTextMessages(entry.body?.messages);
      const variant = extractTag(texts, ['variant']) || 'unknown';
      const sampleId = extractTag(texts, ['sample_id', 'sample', 'case']) || 'unknown';
      const artifactType = extractTag(texts, ['artifact_type']) || 'unknown';
      const teammate = entry.teammate || 'main';
      const groupKey = `${artifactType}::${variant}::${teammate}::${sampleId}`;

      const group = ensureGroup(groupKey, { artifact_type: artifactType, variant, teammate, sample_id: sampleId });
      updateGroup(group, entry);
      saveReport();
      if (!announcedReady) {
        announcedReady = true;
        console.error(`[cc-insight] passive collection ready: ${reportSrv?.getUrl() || 'starting...'}`);
      }
    },
    async reportData({ query = {} } = {}) {
      return toPayload(query);
    },
    async serverStarted() {
      reportSrv = createReportServer();
      await reportSrv.start();
      writeServiceInfo();
    },
    async serverStopping() {
      if (reportSrv) await reportSrv.stop();
    },
  },
};
