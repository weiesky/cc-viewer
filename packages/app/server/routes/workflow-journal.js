// Workflow run journal route: serve normalized panel data + arm live watch.
// 完成后读权威快照 <runId>.json；运行中（快照未落盘）回退到 subagents/workflows/<runId>
// 的逐帧推导，并武装运行中目录监视，使面板逐帧实时刷新。
import { resolveJournalPath, resolveWorkflowsDir, readNormalizedJournal } from '../lib/workflow-journal.js';
import { resolveRunDir, deriveLiveJournal } from '../lib/workflow-live.js';
import { armWorkflowWatch, armWorkflowLiveWatch } from '../lib/workflow-watcher.js';

// session 会进入 findTranscriptPath 的路径拼接（<root>/<dir>/<session>.jsonl），
// 限制为无路径分隔符/`..` 的安全字符集，纵深防御穿越（底层 realpath 容器校验之外的早拒）。
const SESSION_RE = /^[A-Za-z0-9_-]+$/;

function workflowJournal(req, res, parsedUrl, isLocal, deps) {
  try {
    const session = parsedUrl.searchParams.get('session') || '';
    const runId = parsedUrl.searchParams.get('runId') || '';
    const taskId = parsedUrl.searchParams.get('taskId') || '';
    const project = parsedUrl.searchParams.get('project') || undefined;

    if (!session) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'missing session' }));
      return;
    }
    if (!SESSION_RE.test(session)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'invalid session' }));
      return;
    }
    if (!runId && !taskId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'missing runId or taskId' }));
      return;
    }

    // 惰性 arm：只监视真有人在看的 session workflows 目录，后续 journal 覆写经 SSE 实时推送。
    const wfDir = resolveWorkflowsDir(session, project);
    if (wfDir && deps && Array.isArray(deps.clients)) {
      try {
        armWorkflowWatch({ workflowsDir: wfDir, sessionId: session, project, clients: deps.clients });
      } catch {}
    }

    // 1) 完成快照优先（权威，含 phase 分组）
    const journalPath = resolveJournalPath({ sessionId: session, projectHint: project, runId, taskId });
    if (journalPath) {
      const data = readNormalizedJournal(journalPath);
      if (data) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data }));
        return;
      }
    }

    // 2) 运行中逐帧推导（快照尚未落盘）+ 武装运行中目录监视
    if (runId) {
      const runDir = resolveRunDir(session, project, runId);
      const live = runDir ? deriveLiveJournal(runDir, runId) : null;
      if (live) {
        if (deps && Array.isArray(deps.clients)) {
          try { armWorkflowLiveWatch({ runDir, runId, sessionId: session, project, clients: deps.clients }); } catch {}
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: live }));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}

export const workflowJournalRoutes = [
  { method: 'GET', match: 'exact', path: '/api/workflow-journal', handler: workflowJournal },
];
