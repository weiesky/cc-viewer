import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const pluginPath = fileURLToPath(new URL('./index.mjs', import.meta.url));
const logDir = process.env.CCV_LOG_DIR || join(process.cwd(), 'tmp', 'plugin-verify');
process.env.CCV_LOG_DIR = logDir;
mkdirSync(logDir, { recursive: true });

const pluginMod = await import(pathToFileURL(pluginPath).href);
const plugin = pluginMod.default || pluginMod;

const now = new Date().toISOString();
const entry = {
  mainAgent: true,
  timestamp: now,
  duration: 88,
  body: {
    messages: [
      { role: 'user', content: '[artifact_type:skill] [variant:verify] [sample_id:smoke] validate plugin' },
    ],
  },
  response: {
    status: 200,
    body: {
      usage: {
        input_tokens: 8,
        output_tokens: 3,
        cache_read_input_tokens: 1,
        cache_creation_input_tokens: 0,
      },
      content: [{ type: 'tool_use', name: 'demo_tool' }],
    },
  },
};

let payload = null;
try {
  await plugin.hooks.serverStarted();
  await plugin.hooks.onNewEntry(entry);
  payload = await plugin.hooks.reportData({ query: { artifact_type: 'skill', sample_id: 'smoke' } });
  if (!payload?.reportServerUrl) throw new Error('missing reportServerUrl');
  const apiRes = await fetch(`${payload.reportServerUrl}/api/report`);
  if (!apiRes.ok) throw new Error(`api report failed: ${apiRes.status}`);
  const apiJson = await apiRes.json();
  const pageRes = await fetch(`${payload.reportServerUrl}/`);
  if (!pageRes.ok) throw new Error(`page failed: ${pageRes.status}`);
  const pageText = await pageRes.text();
  const serviceInfoPath = join(logDir, 'tmp', 'context-engineering-evaluator-service.json');
  const reportPath = join(logDir, 'tmp', 'context-engineering-evaluator-report.json');
  if (!existsSync(serviceInfoPath)) throw new Error('service info file missing');
  if (!existsSync(reportPath)) throw new Error('report file missing');
  const serviceInfo = JSON.parse(readFileSync(serviceInfoPath, 'utf-8'));
  const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
  const ok = Boolean(
    payload.rowCount >= 1
    && apiJson.rowCount >= 1
    && serviceInfo.ready === true
    && report.totalEntries >= 1
    && pageText.includes('Context Engineering Evaluation Report')
  );
  if (!ok) throw new Error('verification assertions failed');
  console.log(JSON.stringify({
    ok: true,
    reportServerUrl: payload.reportServerUrl,
    rowCount: payload.rowCount,
    apiRowCount: apiJson.rowCount,
    reportTotalEntries: report.totalEntries,
    serviceReady: serviceInfo.ready,
  }, null, 2));
} finally {
  await plugin.hooks.serverStopping();
}
