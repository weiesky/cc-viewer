// Local log management routes (moved verbatim from server.js handleRequest).
import { existsSync, realpathSync, statSync, createReadStream, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import { LOG_DIR } from '../../findcc.js';
import { _projectName, _v2Writer } from '../interceptor.js';
import { listV2Logs, listV2LogsPage, listLocalLogs, countListedV1Files, deleteLogFiles, validateLogPath } from '../lib/log-management.js';
import { countLogEntries, streamRawEntriesAsync, readTailEntries } from '../lib/log-stream.js';
import { sseHead, sseWrite, wireEnd } from '../lib/wire-compress.js';
import { dirSizeSync, sanitizePathComponent } from '../lib/v2/layout.js';
import { extractV2Zip } from '../lib/log-zip.js';
import { startConvert, stopConvert, convertStatus } from '../lib/v2/convert-manager.js';
import { migrationStatus } from '../lib/v2/migrate-prompt.js';

// Cap for the in-memory zip build (adm-zip toBuffer holds the whole archive in
// heap) and the upload accumulation — the repo has an OOM history, so both the
// zipped source folder and the uploaded archive are bounded before buffering.
const MAX_UPLOAD = 300 * 1024 * 1024;
// Download-zip source cap; read per-request so CCV_MAX_ZIP_SOURCE is an ops
// tunable (and a test seam) without a restart.
const maxZipSource = () => Number(process.env.CCV_MAX_ZIP_SOURCE) || 300 * 1024 * 1024;

async function localLogs(req, res, parsedUrl, isLocal, deps) {
  try {
    // 1.7.0: the DEFAULT list is v2 sessions, unconditionally. `?view=v1`
    // serves the legacy-file list for the modal's v1 view (list + migrate +
    // open + delete for leftovers the converter never removes).
    if (parsedUrl?.searchParams?.get('view') === 'v1') {
      const v1 = await listLocalLogs(LOG_DIR, _projectName);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(v1));
      return;
    }
    // Server-side pagination (2026-07-31): ?page=&pageSize= switches the v2
    // list to a per-project page — only the requested page's sessions are
    // summarized. Response shape becomes {items, total, page, pageSize} plus
    // the same _-prefixed side signals below. No params = legacy grouped shape.
    const pageParam = parsedUrl?.searchParams?.get('page');
    let payload;
    if (pageParam != null) {
      // Optional ?project= views another project's logs (the modal's project
      // switcher). Strict-compare against sanitizePathComponent (same pattern
      // as parseV2Ref) so '..'/ separators can't traverse out of LOG_DIR;
      // absent/empty falls back to the active project.
      const rawProject = parsedUrl.searchParams.get('project');
      let target = _projectName;
      if (rawProject) {
        if (rawProject !== sanitizePathComponent(rawProject)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid project name' }));
          return;
        }
        target = rawProject;
      }
      const page = Math.max(1, parseInt(pageParam, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(parsedUrl.searchParams.get('pageSize'), 10) || 50));
      payload = listV2LogsPage(LOG_DIR, target, { page, pageSize });
      // _currentProject must stay the ACTIVE project (_projectName), not the
      // viewed one (listV2LogsPage sets it to `target`): the frontend's global
      // currentProject drives the sidebar / migration counts / v1 banner, and
      // the viewed project is carried separately by its own logViewProject
      // state. Overwriting it here would let "viewing project A" leak into
      // global state. _viewedProject tells the client which project this page
      // actually lists.
      payload._currentProject = _projectName || '';
      payload._viewedProject = target || '';
      // Project list for the modal's switcher dropdown. LOG_DIR's top level
      // holds one dir per project (recycle dirs live INSIDE each project, so
      // nothing to filter here) — but skip dot-prefixed hidden dirs.
      try {
        payload._allProjects = readdirSync(LOG_DIR, { withFileTypes: true })
          .filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name).sort();
      } catch { payload._allProjects = []; }
    } else {
      payload = listV2Logs(LOG_DIR, _projectName);
    }
    // Legacy v1 files are not in this list — surface two distinct signals:
    //  - _v1FileCount: v1 files ON DISK (gates the v1-view entry link; the
    //    converter never deletes sources, so this outlives a finished migration)
    //  - _unmigratedV1Count/Bytes: files still AWAITING migration (gates the
    //    migrate button + hint inside the v1 view and the startup prompt)
    const mig = migrationStatus(LOG_DIR, _projectName || '');
    payload._unmigratedV1Count = mig.files;
    payload._unmigratedV1Bytes = mig.totalBytes;
    payload._v1FileCount = _projectName ? countListedV1Files(join(LOG_DIR, _projectName)) : 0;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function downloadLog(req, res, parsedUrl) {
  const file = parsedUrl.searchParams.get('file');
  if (!file || file.includes('..')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid file name' }));
    return;
  }
  // wire-v2 S5: rebuilt download for v2 sessions — the adapter stream as a v1
  // `.jsonl`. `format=raw` (session-dir zip) is the S6a half of the S0 contract:
  // a lossless zip of the whole session folder, the transport for round-tripping
  // a v2 session (folder) back through the upload-and-parse flow.
  if (file.startsWith('v2:')) {
    if (parsedUrl.searchParams.get('format') === 'raw') {
      try {
        const sessionDir = validateLogPath(LOG_DIR, file);
        if (dirSizeSync(sessionDir) > maxZipSource()) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session too large to zip', code: 'TOO_LARGE' }));
          return;
        }
        const dirName = basename(sessionDir);
        const zip = new AdmZip();
        // Wrap the folder under `<dirName>/` and skip dotfiles (.DS_Store etc.).
        // adm-zip passes the zip-internal path (incl. the `<dirName>/` root) to
        // the filter, so match on any path segment starting with a dot.
        zip.addLocalFolder(sessionDir, dirName, (n) => !/(^|\/)\./.test(n.replace(/\\/g, '/')));
        const buf = zip.toBuffer();
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(`${dirName}.zip`)}"`,
          'Content-Length': buf.length,
        });
        res.end(buf);
      } catch (err) {
        if (!res.headersSent) {
          const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'ACCESS_DENIED' ? 403 : 500;
          // Don't leak internal messages (may contain absolute paths) on 500 —
          // genericize like the upload handler does.
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: status >= 500 ? 'server_error' : err.message }));
        } else {
          res.end();
        }
      }
      return;
    }
    try {
      const sessionDir = validateLogPath(LOG_DIR, file);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`${basename(sessionDir)}.v2-rebuilt.jsonl`)}"`,
        'Transfer-Encoding': 'chunked',
      });
      await streamRawEntriesAsync(sessionDir, (raw) => {
        res.write(raw);
        res.write('\n---\n');
      });
      res.end();
    } catch (err) {
      if (!res.headersSent) {
        const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'ACCESS_DENIED' ? 403 : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } else {
        res.end();
      }
    }
    return;
  }
  if (!file.endsWith('.jsonl')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid file type' }));
    return;
  }
  const filePath = join(LOG_DIR, file);
  try {
    if (!existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
      return;
    }
    const realPath = realpathSync(filePath);
    const realLogDir = realpathSync(LOG_DIR);
    if (!realPath.startsWith(realLogDir)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied' }));
      return;
    }
    const format = parsedUrl.searchParams.get('format');
    const fileName = basename(file);
    // Delta storage: format=raw 下载原始文件；默认下载重建后的全量格式
    if (format === 'raw') {
      const stat = statSync(realPath);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Content-Length': stat.size,
      });
      const stream = createReadStream(realPath);
      stream.pipe(res);
    } else {
      // 流式下载原始条目（不重建，保持 delta 格式），避免 OOM
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
        'Transfer-Encoding': 'chunked',
      });
      await streamRawEntriesAsync(realPath, (raw) => {
        res.write(raw);
        res.write('\n---\n');
      });
      res.end();
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function localLog(req, res, parsedUrl) {
  const file = parsedUrl.searchParams.get('file');
  if (!file || file.includes('..')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid file name' }));
    return;
  }

  // 验证文件类型：v2 寻址（spec §12）；直连 .jsonl 保留为未迁移日志的逃生舱
  // （代码与转换器共享，UI 无入口——1.7.0 决策）。
  const isV2Ref = file.startsWith('v2:');
  if (!isV2Ref && !file.endsWith('.jsonl')) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid file type. Only .jsonl files are allowed.' }));
    return;
  }

  try {
    // 独立 SSE 流：直接向请求方返回 event-stream，不走 /events 广播
    // v2 寻址时 validateLogPath 返回 session 目录绝对路径，log-stream 据此分派适配器
    const filePath = validateLogPath(LOG_DIR, file);
    const limitVal = Math.min(parseInt(parsedUrl.searchParams.get('limit'), 10) || 0, 500);

    // Negotiated Content-Encoding (br|identity) — every subsequent byte MUST
    // go through sseWrite/wireEnd (see server/lib/wire-compress.js).
    sseHead(req, res, 200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    if (limitVal > 0) {
      // 尾部加载模式：跳过 countLogEntries，只读文件末尾
      const { entries, hasMore, oldestTimestamp, estimatedTotal } = await readTailEntries(filePath, { limit: limitVal });
      sseWrite(res, `event: load_start\ndata: ${JSON.stringify({ total: estimatedTotal, incremental: false, hasMore, oldestTs: oldestTimestamp })}\n\n`);
      for (const raw of entries) {
        sseWrite(res, 'event: load_chunk\ndata: [');
        sseWrite(res, raw.includes('\n') ? raw.replace(/\n/g, '') : raw);
        sseWrite(res, ']\n\n');
      }
    } else {
      // 全量加载模式（向后兼容）
      const total = await countLogEntries(filePath);
      sseWrite(res, `event: load_start\ndata: ${JSON.stringify({ total, incremental: false })}\n\n`);
      await streamRawEntriesAsync(filePath, (raw) => {
        sseWrite(res, 'event: load_chunk\ndata: [');
        sseWrite(res, raw.includes('\n') ? raw.replace(/\n/g, '') : raw);
        sseWrite(res, ']\n\n');
      });
    }
    sseWrite(res, `event: load_end\ndata: {}\n\n`);
    wireEnd(res);
  } catch (err) {
    // 如果 headers 未发送，返回 JSON 错误；否则关闭连接
    // 落 stderr 让用户在 ccv 终端能看到具体原因（SSE onerror 在客户端
    // 不携带错误明细，只能从服务端日志反查）
    console.error('[local-log]', file, err && err.stack || err);
    if (!res.headersSent) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'ACCESS_DENIED' ? 403 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } else {
      wireEnd(res); // flush the encoder trailer if the stream was compressed
    }
  }
}

function deleteLogs(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const { files } = JSON.parse(body);
      if (!Array.isArray(files) || files.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No files specified' }));
        return;
      }
      const results = deleteLogFiles(LOG_DIR, files, { liveSessionDir: _v2Writer.currentSessionDir() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

// wire-v2 S8: one-click v1→v2 migration of the CURRENT project, run by the
// resident convert-manager worker. GET = status snapshot for the modal's
// polling; POST {action:'start'|'stop'} controls the task. Local/LAN exposure
// via the existing auth middleware (same posture as delete-logs).
function getWireV2Convert(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(convertStatus(LOG_DIR, _projectName || '')));
}

function postWireV2Convert(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > deps.MAX_POST_BODY) req.destroy(); });
  req.on('end', () => {
    try {
      const { action } = JSON.parse(body || '{}');
      if (action !== 'start' && action !== 'stop') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'action must be "start" or "stop"' }));
        return;
      }
      if (action === 'start' && !_projectName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no active project' }));
        return;
      }
      const result = action === 'start' ? startConvert(LOG_DIR, _projectName) : stopConvert();
      res.writeHead(result.ok ? 200 : 409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.ok ? { ok: true } : { error: result.error }));
    } catch (err) {
      const status = err instanceof SyntaxError ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err?.message || 'internal error' }));
    }
  });
}

// wire-v2 S6a: upload a v2-session zip (produced by `?format=raw` download),
// extract it to a temp dir, synthesize + stream it back as v1-shaped `\n---\n`
// raw entries for ephemeral viewing, then delete the temp dir. Nothing is
// written into LOG_DIR — view-only, parity with the legacy client-side `.jsonl`
// upload. Raw `application/zip` body (no multipart); uses its own MAX_UPLOAD
// cap, NOT deps.MAX_POST_BODY (which is ~10MB and would reject any real zip).
function uploadLogZip(req, res) {
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_UPLOAD) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File too large', code: 'TOO_LARGE' }));
    return;
  }
  let chunks = [];
  let totalSize = 0;
  let aborted = false;
  // A large remote upload can reset mid-flight; without an 'error' listener the
  // socket error would crash the process (unhandled 'error' event).
  req.on('error', () => { aborted = true; chunks = []; });
  req.on('data', (chunk) => {
    if (aborted) return;
    totalSize += chunk.length;
    if (totalSize > MAX_UPLOAD) {
      aborted = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large', code: 'TOO_LARGE' }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', async () => {
    if (aborted) return;
    let tmpDir = null;
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'ccv-upload-'));
      const buf = Buffer.concat(chunks);
      chunks = []; // free the per-chunk copies; adm-zip holds `buf` from here
      const sessionDir = extractV2Zip(buf, tmpDir);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Transfer-Encoding': 'chunked',
      });
      await streamRawEntriesAsync(sessionDir, (raw) => {
        res.write(raw);
        res.write('\n---\n');
      });
      res.end();
    } catch (err) {
      const status = err?.status || 500;
      if (status >= 500) console.error('[api/upload-log-zip]', err);
      if (!res.headersSent) {
        const safeError = status >= 500 ? 'server_error' : (err?.message || 'error');
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: safeError, code: err?.code || 'unknown' }));
      } else {
        res.end();
      }
    } finally {
      // Always reclaim the temp dir. The adapter has finished all reads by the
      // time the await settles (cold v2 reads are bounded), so this is race-free
      // even when the client disconnected mid-stream.
      if (tmpDir) { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} }
    }
  });
}

export const logsRoutes = [
  { method: 'GET', match: 'exact', path: '/api/local-logs', handler: localLogs },
  { method: 'GET', match: 'exact', path: '/api/wire-v2-convert', handler: getWireV2Convert },
  { method: 'POST', match: 'exact', path: '/api/wire-v2-convert', handler: postWireV2Convert },
  { method: 'GET', match: 'exact', path: '/api/download-log', handler: downloadLog },
  { method: 'GET', match: 'exact', path: '/api/local-log', handler: localLog },
  { method: 'POST', match: 'exact', path: '/api/delete-logs', handler: deleteLogs },
  { method: 'POST', match: 'exact', path: '/api/upload-log-zip', handler: uploadLogZip },
];
