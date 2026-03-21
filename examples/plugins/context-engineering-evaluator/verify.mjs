import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const pluginPath = fileURLToPath(new URL('./index.mjs', import.meta.url));
const logDir = process.env.CCV_LOG_DIR || join(process.cwd(), 'tmp', 'plugin-verify');
process.env.CCV_LOG_DIR = logDir;
const port = Number(process.env.CCV_CONTEXT_EVAL_PORT || 18779);
process.env.CCV_CONTEXT_EVAL_PORT = String(port);
rmSync(logDir, { recursive: true, force: true });
mkdirSync(logDir, { recursive: true });

function createEntry({ artifactType, variant, sampleId, teammate = null, status = 200, duration = 50, usage = {}, toolUses = 0 }) {
  const content = [];
  for (let i = 0; i < toolUses; i += 1) content.push({ type: 'tool_use', name: `tool_${i}` });
  return {
    mainAgent: !teammate,
    teammate,
    timestamp: new Date().toISOString(),
    duration,
    body: {
      messages: [
        { role: 'user', content: `[artifact_type:${artifactType}] [variant:${variant}] [sample_id:${sampleId}] verify` },
      ],
    },
    response: {
      status,
      body: {
        usage: {
          input_tokens: usage.input_tokens || 0,
          output_tokens: usage.output_tokens || 0,
          cache_read_input_tokens: usage.cache_read_input_tokens || 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens || 0,
        },
        content,
      },
    },
  };
}

async function loadPluginInstance() {
  const mod = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}_${Math.random()}`);
  return mod.default || mod;
}

const checks = [];
function check(name, condition, details = {}) {
  const passed = Boolean(condition);
  checks.push({ name, passed, details });
  if (!passed) {
    throw new Error(`check failed: ${name} ${JSON.stringify(details)}`);
  }
}

const entries = [
  createEntry({
    artifactType: 'skill',
    variant: 'v1',
    sampleId: 's001',
    teammate: null,
    status: 200,
    duration: 120,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 },
    toolUses: 1,
  }),
  createEntry({
    artifactType: 'skill',
    variant: 'v1',
    sampleId: 's002',
    teammate: null,
    status: 429,
    duration: 80,
    usage: { input_tokens: 6, output_tokens: 4, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
    toolUses: 2,
  }),
  createEntry({
    artifactType: 'skill',
    variant: 'v2',
    sampleId: 's001',
    teammate: null,
    status: 200,
    duration: 60,
    usage: { input_tokens: 4, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    toolUses: 0,
  }),
  createEntry({
    artifactType: 'skill',
    variant: 'v2',
    sampleId: 's003',
    teammate: 'coder',
    status: 200,
    duration: 40,
    usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    toolUses: 1,
  }),
];

let plugin = await loadPluginInstance();
let payload = null;
try {
  await plugin.hooks.serverStarted();
  for (const entry of entries) {
    await plugin.hooks.onNewEntry(entry);
  }
  payload = await plugin.hooks.reportData({ query: { artifact_type: 'skill' } });
  check('reportServerUrl exists', typeof payload.reportServerUrl === 'string' && payload.reportServerUrl.length > 0, { reportServerUrl: payload.reportServerUrl });
  check('multi variant summary', payload.summary.some((s) => s.variant === 'v1') && payload.summary.some((s) => s.variant === 'v2'), { summary: payload.summary.map((s) => s.variant) });
  const v1Summary = payload.summary.find((s) => s.variant === 'v1');
  check('multi sample accumulate', v1Summary?.requestCount === 2, { v1RequestCount: v1Summary?.requestCount });
  check('error stats', v1Summary?.errorCount === 1 && Math.abs((v1Summary?.errorRate || 0) - 0.5) < 0.0001, { errorCount: v1Summary?.errorCount, errorRate: v1Summary?.errorRate });
  check('token accumulation', v1Summary?.inputTokens === 16 && v1Summary?.outputTokens === 9, { inputTokens: v1Summary?.inputTokens, outputTokens: v1Summary?.outputTokens });
  const coderRow = payload.rows.find((r) => r.teammate === 'coder' && r.variant === 'v2');
  const mainV2Row = payload.rows.find((r) => r.teammate === 'main' && r.variant === 'v2');
  check('teammate separation', Boolean(coderRow) && Boolean(mainV2Row), { coderRow: Boolean(coderRow), mainV2Row: Boolean(mainV2Row) });
  const apiRes = await fetch(`${payload.reportServerUrl}/api/report?variant=v1`);
  const apiJson = await apiRes.json();
  check('api variant filter status', apiRes.status === 200, { status: apiRes.status });
  check('api variant filter rows', apiJson.rows.every((r) => r.variant === 'v1'), { variants: apiJson.rows.map((r) => r.variant) });
  const serviceInfoPath = join(logDir, 'tmp', 'context-engineering-evaluator-service.json');
  check('service info exists before restart', existsSync(serviceInfoPath), { serviceInfoPath });
  const serviceInfoBeforeRestart = JSON.parse(readFileSync(serviceInfoPath, 'utf-8'));
  check('service ready before restart', serviceInfoBeforeRestart.ready === true, { ready: serviceInfoBeforeRestart.ready });
  await plugin.hooks.serverStopping();

  plugin = await loadPluginInstance();
  await plugin.hooks.serverStarted();
  const restored = await plugin.hooks.reportData({ query: { artifact_type: 'skill' } });
  check('idempotent restore totalEntries', restored.totalEntries === entries.length, { restored: restored.totalEntries, expected: entries.length });
  check('idempotent restore summary', restored.summary.length >= 2, { summaryCount: restored.summary.length });

  const pageRes = await fetch(`${restored.reportServerUrl}/`);
  const pageText = await pageRes.text();
  check('html page ready', pageRes.status === 200 && pageText.includes('Context Engineering Evaluation Report'), { status: pageRes.status });

  const reportPath = join(logDir, 'tmp', 'context-engineering-evaluator-report.json');
  check('service info exists', existsSync(serviceInfoPath), { serviceInfoPath });
  check('report file exists', existsSync(reportPath), { reportPath });
  const serviceInfo = JSON.parse(readFileSync(serviceInfoPath, 'utf-8'));
  const reportFile = JSON.parse(readFileSync(reportPath, 'utf-8'));
  check('service info url present', typeof serviceInfo.reportServerUrl === 'string' && serviceInfo.reportServerUrl.length > 0, { reportServerUrl: serviceInfo.reportServerUrl });
  check('report persisted totalEntries', reportFile.totalEntries === entries.length, { totalEntries: reportFile.totalEntries });

  console.log(JSON.stringify({
    ok: true,
    checks,
    reportServerUrl: restored.reportServerUrl,
    totalEntries: restored.totalEntries,
    variants: restored.summary.map((s) => ({ variant: s.variant, requestCount: s.requestCount, errorCount: s.errorCount })),
  }, null, 2));
} finally {
  await plugin.hooks.serverStopping();
}
