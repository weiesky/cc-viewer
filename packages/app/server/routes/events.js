// SSE event stream + log-registration / resume / turn-end routes (moved verbatim from server.js).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { _projectName, getLiveLogSource, isContinuedLaunch } from '../interceptor.js';
import { LOG_DIR } from '../../findcc.js';
import { streamRawEntriesAsync } from '../lib/log-stream.js';
import { migrationStatus } from '../lib/v2/migrate-prompt.js';
import { reportSwallowed } from '@ccv/core/error-report';
import { sseHead, sseWrite, needsDrain, wireEnd, awaitWireDrain, isWireV3Enabled } from '../lib/wire-compress.js';
import { readV2ColdBundle } from '../lib/v2/meta-rows.js';
import { readV2SingleEntry } from '../lib/v2/adapter.js';
import { resolveSessionDirName, latestMainSessionDir } from '../lib/v2/session-select.js';
import { sanitizePathComponent, normalizeSessionCwd } from '../lib/v2/layout.js';
import { listLivePtys } from '../pty-manager.js';
import { enrichRawIfNeeded } from '../lib/enrich-plan-input.js';
import { validateLogPath } from '../lib/log-management.js';
import { isMainAgentEntry, extractCachedContent } from '../lib/kv-cache-analyzer.js';
import { CONTEXT_WINDOW_FILE, readModelContextSize, buildContextWindowEvent, getContextSizeForModel } from '../lib/context-watcher.js';
import { adaptContextWindow } from '@ccv/core/context-rules';

function turnEndNotify(req, res, parsedUrl, isLocal, deps) {
  if (!isLocal) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Loopback only' }));
    return;
  }
  if (req.headers['x-ccviewer-internal'] !== deps.INTERNAL_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid bridge token' }));
    return;
  }
  let body = '';
  let truncated = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 16384) { truncated = true; req.destroy(); }
  });
  req.on('end', () => {
    if (truncated) {
      console.warn('[turn-end-notify] body exceeded 16KB cap — request destroyed');
      return; // socket already closed by destroy()
    }
    let payload = {};
    let badJson = false;
    try { payload = body ? JSON.parse(body) : {}; }
    catch { badJson = true; console.warn('[turn-end-notify] malformed JSON body'); }
    if (badJson) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'malformed JSON body' }));
      return;
    }
    deps.scheduleTurnEndBroadcast(payload.sessionId || null, payload.ts || Date.now(), payload.transcriptPath || null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// SessionStart hook notify (session-start-bridge.js): the conversation-switch
// signal for an in-terminal /resume. Same security shape as turnEndNotify
// (loopback-only + internal token + 16KB cap); the actual gating on
// payload.source and the V2Writer re-bind live behind deps.onSessionStartNotify
// (server.js → interceptor.markSessionStart).
function sessionStartNotify(req, res, parsedUrl, isLocal, deps) {
  if (!isLocal) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Loopback only' }));
    return;
  }
  if (req.headers['x-ccviewer-internal'] !== deps.INTERNAL_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid bridge token' }));
    return;
  }
  let body = '';
  let truncated = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 16384) { truncated = true; req.destroy(); }
  });
  req.on('end', () => {
    if (truncated) {
      console.warn('[session-start-notify] body exceeded 16KB cap — request destroyed');
      return; // socket already closed by destroy()
    }
    let payload = {};
    let badJson = false;
    try { payload = body ? JSON.parse(body) : {}; }
    catch { badJson = true; console.warn('[session-start-notify] malformed JSON body'); }
    if (badJson) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'malformed JSON body' }));
      return;
    }
    try { deps.onSessionStartNotify(payload); }
    catch (err) { reportSwallowed('session-start-notify.dispatch', err); }
    // Task-checklist boundary: reset on main-agent startup/clear, skipped for
    // subagent events (payload.agentId). Separate deps callback so it is never
    // swallowed by markSessionStart's source early-return.
    try { deps.onTaskSessionBoundary?.(payload); }
    catch (err) { reportSwallowed('task-session-boundary', err); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// Task-event hook notify (task-bridge.js): TaskCreated / TaskCompleted /
// PostToolUse(TaskUpdate) → the task-checklist reducer. Same security shape
// as sessionStartNotify (loopback-only + internal token + 16KB cap); the
// state update + debounced SSE broadcast live behind deps.onTaskEvent
// (server.js → lib/task-state.js).
function taskEventNotify(req, res, parsedUrl, isLocal, deps) {
  if (!isLocal) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Loopback only' }));
    return;
  }
  if (req.headers['x-ccviewer-internal'] !== deps.INTERNAL_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid bridge token' }));
    return;
  }
  let body = '';
  let truncated = false;
  req.on('data', chunk => {
    body += chunk;
    if (body.length > 16384) { truncated = true; req.destroy(); }
  });
  req.on('end', () => {
    if (truncated) {
      console.warn('[task-event] body exceeded 16KB cap — request destroyed');
      return; // socket already closed by destroy()
    }
    let payload = {};
    let badJson = false;
    try { payload = body ? JSON.parse(body) : {}; }
    catch { badJson = true; console.warn('[task-event] malformed JSON body'); }
    if (badJson) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'malformed JSON body' }));
      return;
    }
    try { deps.onTaskEvent?.(payload); }
    catch (err) { reportSwallowed('task-event.dispatch', err); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
}

// SSE endpoint
// 构造「有新版」徽标的 SSE 帧（pending = {version, source}）。pending 为空返回 null。
// 抽成纯函数便于单测帧格式；events() 在新连接上调用它补推，使版本徽标跨刷新持续显示。
export function sseUpdateBadgeFrame(pending) {
  return pending
    ? `event: update_major_available\ndata: ${JSON.stringify(pending)}\n\n`
    : null;
}

async function events(req, res, parsedUrl, isLocal, deps) {
  // Negotiated Content-Encoding (br|identity). From here on, every byte of
  // this response MUST go through sseWrite — a bare res.write would corrupt
  // the compressed stream (see server/lib/wire-compress.js).
  sseHead(req, res, 200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // 注意：不要在此处 clients.push(res)！
  // 必须等 load_end + kv_cache + context_window 全部发送完毕后再加入广播列表，
  // 否则 streamRawEntriesAsync 的 setImmediate yield 间隙会让 watcher 的
  // sendToClients 向该客户端推送 live entry，而 load_end 的 setState 会覆盖这些
  // 已处理的 live entry，导致 对话条目"显示→消失→重现"闪烁。

  // SSE 心跳保活：每 30s 发送 ping 事件，防止连接被 OS/代理/浏览器静默断开
  const pingTimer = setInterval(() => {
    try { sseWrite(res, 'event: ping\ndata: {}\n\n'); } catch {}
  }, 30000);

  // server_config: 给前端推一次性的关键运行时常量，让前端 cooldown / debounce 等
  // 模块常量能跟随 server env 自动对齐（避免「server 改了 env、前端写死」漂移）。
  // 见 server.js 顶部 turnEnd debounce 的 SUNSET-MARKER 注释。
  // write 失败要 warn：之前静默吞会让 env override 漂移到前端硬常量 10s 而无人发觉。
  try {
    sseWrite(res, `event: server_config\ndata: ${JSON.stringify({ turnEndDebounceMs: deps.turnEndDebounceMs, wireV3: !!deps.wireV3, build: deps.serverBuild || '' })}\n\n`);
  } catch (err) {
    console.warn(`[server_config] SSE write failed (turnEndDebounceMs=${deps.turnEndDebounceMs}):`, err && err.message);
  }

  // 补推「有新版」徽标：复用启动检查缓存的结果，让刷新/新标签页连上即恢复徽标。
  // 置于 deps.clients.push(res) 之前 → 新客户端仅得一份，不与一次性广播竞态。
  const updFrame = sseUpdateBadgeFrame(deps.pendingMajorUpdate);
  if (updFrame) sseWrite(res, updFrame);

  // 1.7.0 迁移引导（P2）：「正在被查看的项目」仍有未转换的 v1 日志 → 连接即推 migrate_prompt。
  // 是否弹窗由客户端决定（「不再提醒」偏好在客户端；continued=true 时无视 dismissed
  // 再提醒一次——`-c` 续接的对话前半段在旧格式里，不迁移就看不到）。工作区切换后的
  // 提示由 workspaces launch 路由对存量连接广播（本帧只覆盖新连接）。viewedProject
  // (declared below from ?project=) scopes the check to the project the client is
  // actually viewing, not always the bound one.
  try {
    const migProject = parsedUrl.searchParams.get('project') || _projectName || '';
    const mig = migrationStatus(LOG_DIR, migProject);
    if (mig.pending) {
      sseWrite(res, `event: migrate_prompt\ndata: ${JSON.stringify({ ...mig, continued: isContinuedLaunch() })}\n\n`);
    }
  } catch (e) { reportSwallowed('sse.migrate_prompt', e); }

  // 增量加载参数：移动端带 since/cc/project 请求增量数据
  const sinceParam = parsedUrl.searchParams.get('since');
  const ccParam = parseInt(parsedUrl.searchParams.get('cc'), 10) || 0;
  const projectParam = parsedUrl.searchParams.get('project');
  // Multi-project (2026-10): a foreign `?project=` (a parallel-project VIEW)
  // may ALSO resume incrementally — the view-state cache keeps the departing
  // project's lastTs and the client returns with `?project=<p>&since=<lastTs>`.
  // The previous `projectMatch` gate forced a full cold reload for any
  // non-bound project (the "slow switch" half of the bug). `?project` already
  // self-declares the view scope, and the cold-source resolution below serves
  // that project's current session read-only without re-binding the server —
  // so the bound-match condition is dropped (cc>0 + a valid date still guard).
  const useIncremental = !!(sinceParam && ccParam > 0 && !isNaN(new Date(sinceParam).getTime()));

  // 分页参数：
  // - mobile 首次加载传 ?limit=200
  // - bare desktop 请求（无任何 query 参数）默认套 DEFAULT_EVENTS_LIMIT
  // - 显式 ?limit=0 表示"我要全量"（保留旧行为入口）
  const limitParamRaw = parsedUrl.searchParams.get('limit');
  const limitParamGiven = limitParamRaw !== null;
  const limitParamNum = parseInt(limitParamRaw, 10);
  let effectiveLimit = 0;
  if (!useIncremental) {
    if (limitParamGiven) {
      effectiveLimit = Number.isFinite(limitParamNum) && limitParamNum > 0 ? limitParamNum : 0;
    } else {
      effectiveLimit = deps.DEFAULT_EVENTS_LIMIT;
    }
  }
  const useLimit = effectiveLimit > 0;

  // Cold-load source resolution. Two view scopes, both read-only and NEITHER
  // re-binds the server (the bound project `_projectName` is untouched):
  //  - `?sid=<uuid>`: THAT session's full transcript (incl. pre-attach history)
  //    instead of the single "current" session dir. `?project=<p>` scopes the
  //    sid lookup to project <p>'s dir; without it the lookup scans the bound
  //    project and a foreign sid resolves to null.
  //  - `?project=<p>` (no sid): project <p>'s CURRENT session — the newest
  //    readable, non-teammate session with a main turn — so a parallel-project
  //    chip can be VIEWED without respawning or killing its process.
  const sidParamRaw = parsedUrl.searchParams.get('sid');
  const sidParam = (typeof sidParamRaw === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sidParamRaw)) ? sidParamRaw : null;
  // Multi-instance (2026-10-06): `?instance=<instanceKey>` narrows the view to ONE concurrent
  // process of a same-cwd project (which otherwise share a basename session dir pool). It
  // scopes the no-sid cold-load pick (each instance resolves to ITS OWN latest session) and is
  // stamped on the SSE response so the per-project live feed can route to exactly the clients
  // viewing that instance. Validated to the minted `ccv-<hex>` shape.
  const instanceParamRaw = parsedUrl.searchParams.get('instance');
  const instanceParam = (typeof instanceParamRaw === 'string' && /^ccv-[0-9a-f]+$/.test(instanceParamRaw)) ? instanceParamRaw : null;
  // `projectParam` (declared above for the incremental guard) doubles as the view
  // scope. The project this client is VIEWING: the explicit ?project= override,
  // else the bound project. Stamped onto the SSE response so per-project feeds can
  // route live entries to exactly the clients viewing that project.
  const viewedProject = projectParam || (_projectName || '');
  const resolveColdSource = () => {
    if (sidParam) {
      const project = projectParam || _projectName;
      if (!project) return null;
      try {
        const projectDir = join(LOG_DIR, sanitizePathComponent(project));
        const dirName = resolveSessionDirName(projectDir, sidParam);
        return dirName ? join(projectDir, 'sessions', dirName) : null;
      } catch (err) {
        reportSwallowed('events.sid-resolve', err, { sid: sidParam });
        return null;
      }
    }
    // No sid: a foreign ?project= resolves to that project's current session
    // (skipForeignLive honors multi-window isolation, same as getLiveLogSource's
    // fallback). When it matches the bound project (or is absent) the standard
    // live source already serves exactly this — return null to take that path.
    // Multi-instance (2026-10-06): an explicit `?instance=` ALSO drives a cold-source pick even
    // when the project IS the bound one — a second same-cwd instance must cold-load ITS OWN
    // latest session, not the bound project's `_currentSid` (which the most-recent instance
    // overwrites). Without this branch the instance filter was unreachable for the bound
    // project and the first paint showed the OTHER instance's conversation.
    if (projectParam && (projectParam !== (_projectName || '') || instanceParam)) {
      try {
        // Same-name isolation (2026-10-07): resolve the TARGET instance's owning cwd so the
        // cold-load fallback can be scoped to it (two cross-dir same-basename projects share
        // this basename pool). The live PTY record's cwd is the same spawn cwd the writer
        // stamped into meta.cwd (its `s.cwd`) — so compare after the same lexical normalize.
        // Instance dead / no live record / lookup failure → '' → no cwd filter
        // (conservative, identical to today's whole-pool fallback; never mis-excludes history).
        let targetCwd = '';
        if (instanceParam) {
          try {
            const rec = listLivePtys().find((p) => p && p.instanceKey === instanceParam);
            targetCwd = rec && rec.cwd ? normalizeSessionCwd(rec.cwd) : '';
          } catch (err) { targetCwd = ''; reportSwallowed('events.target-cwd', err); }
        }
        return latestMainSessionDir(join(LOG_DIR, sanitizePathComponent(projectParam)), { skipForeignLive: true, instanceKey: instanceParam || '', targetCwd }) || null;
      } catch (err) {
        reportSwallowed('events.project-resolve', err, { project: projectParam });
        return null;
      }
    }
    return null;
  };
  const viewColdDir = resolveColdSource();
  // Silent-fallback guard (design: never silently fall back). A `?sid=<uuid>`
  // that resolves to null (the session dir was /clear-pruned or quota-cleaned)
  // must NOT fall through to the live current session while the client believes
  // it attached — tell the client explicitly so it can toast + auto-detach.
  const sidNotFound = !!(sidParam && !viewColdDir);
  if (sidNotFound) {
    try { sseWrite(res, `event: sid-not-found\ndata: ${JSON.stringify({ sid: sidParam, ts: Date.now() })}\n\n`); } catch { }
  }
  // Multi-instance (2026-10-06): an explicit `?instance=` that resolves to NO session dir must
  // likewise NOT silently fall through to the bound project's current session (the instance
  // filter excludes legacy/other-instance dirs, so an empty result would otherwise show the
  // WRONG project's/instance's conversation). Tell the client explicitly (same posture as
  // sid-not-found) so it can surface an empty state instead of cross-project bleed.
  const instanceNotFound = !!(instanceParam && !sidParam && !viewColdDir);
  if (instanceNotFound) {
    try { sseWrite(res, `event: sid-not-found\ndata: ${JSON.stringify({ sid: null, instance: instanceParam, reason: 'instance-no-session', ts: Date.now() })}\n\n`); } catch { }
  }
  // When a view-scoped dir was requested AND resolved, it replaces the live-source
  // cold load; otherwise fall back to the standard single-current-session source.
  const coldSource = viewColdDir || null;
  // A client viewing a non-bound project needs that project's live feed running
  // (its PTY is alive but its feed is lazy). Start it idempotently; the feed's
  // per-project client filter keeps its entries scoped to this project's viewers.
  if (viewedProject && viewedProject !== (_projectName || '') && typeof deps.ensureProjectFeed === 'function') {
    try { deps.ensureProjectFeed(viewedProject); } catch (err) { reportSwallowed('events.ensure-feed', err, { project: viewedProject }); }
  }

  // KV-Cache / context_window 追踪（扫描全量条目，不受 since 过滤影响）
  let latestKvCache = null;
  let latestContextWindow = null;
  let pushedContextWindow = false;
  // 只记忆最后 K 条 mainAgent 候选原始字符串，Pass 1 结束后 newest-first 结构化校验
  // （isMainAgentEntry），最多 parse K 次。旧逻辑在 onScan 里对每条 mainAgent raw 全量
  // JSON.parse —— `-c` 大会话日志里多个数十 MB 的 checkpoint 会让每次 SSE 连接阻塞
  // event loop 数秒（Windows 卡死主因之一）。
  // ring=3 的容错意义：团队会话末尾常有连续 teammate 伪 mainAgent 条目，单记忆位会被
  // 挤掉真实 mainAgent；子串预过滤的理论误伤（键/值恰为 "teammate" 的真实条目）也由
  // 环内更早候选兜底。
  // KEEP IN SYNC: server/lib/v2/adapter.js MAINAGENT_RING_DEPTH — on the v2 path
  // the adapter's mainAgentRing (that depth) wholesale REPLACES this ring, so a
  // mismatch would silently give v1 and v2 sessions different candidate depths.
  const MAINAGENT_SCAN_RING = 3;
  const mainAgentRawRing = [];

  // Wire v3 (V3.S5): flagged + v2 source ⇒ the legacy full-entry cold stream
  // is REPLACED by rows + native lines (the byte win); the client assembler
  // rebuilds entries locally. v1 legacy files keep the entry pipeline.
  const _v3Src = deps.wireV3 ? (coldSource || getLiveLogSource()) : null;
  const v3Cold = !!(_v3Src && existsSync(join(_v3Src, 'journal.jsonl')));

  // S6b: the cold-load source is the current v2 session dir when the v2
  // writer is active (adapter stream), else the v1 file.
  // serveInFlight follows the wire: the legacy entry stream ships the
  // in-flight placeholder, which the client batch gate still blocks — the
  // previous conversation is the better cold load there (interceptor.js
  // getLiveLogSource header comment).
  const coldLoadResult = v3Cold ? null : await streamRawEntriesAsync(coldSource || getLiveLogSource({ serveInFlight: !!deps.wireV3 }), async (raw) => {
    // 直接发送原始 JSON 字符串，不做 parse/reconstruct/stringify
    // ExitPlanMode V2 空 input 的条目按需补全 plan / planFilePath，其它原样透传
    if (res.destroyed || !res.writable) return;
    const out = enrichRawIfNeeded(raw);
    // SSE data 字段不允许裸换行，去除 pretty-printed JSON 的换行
    // 写入路径整体 try-catch 兜底：连接在 res.write 之间被对端 RST/destroy 时不至于
    // 把 EPIPE 抛穿 async callback；res.on('close'|'error') 已会做 clients 数组清理。
    let drained = true;
    try {
      sseWrite(res, 'event: load_chunk\ndata: [');
      const ok = sseWrite(res, out.includes('\n') ? out.replace(/\n/g, '') : out);
      sseWrite(res, ']\n\n');
      // Two pressure signals: `ok` is the write target's input buffer (the
      // ENCODER on compressed paths — its backlog would otherwise be invisible
      // because compressed output is 20-80x smaller and rarely fills the
      // socket), needsDrain(res) is the socket itself. awaitWireDrain below
      // waits on whichever stream actually applies the pressure.
      drained = ok && !needsDrain(res);
    } catch {
      return;
    }
    // 写缓冲满则等 drain（或 close/error/超时任一 fulfill），防止浏览器侧 renderer OOM。
    // helper 内部会在 fulfill 时把另外两个监听器从 res 上摘掉，避免 N 次 backpressure
    // 累积出 N 个 stale close/error listener 触发 MaxListenersExceededWarning。
    if (!drained) {
      await awaitWireDrain(res, deps.SSE_BACKPRESSURE_TIMEOUT_MS);
    }
  }, {
    since: useIncremental ? sinceParam : undefined,
    limit: useLimit ? effectiveLimit : undefined,
    onScan: (raw) => {
      // 只做子串检测 + 入环，不 parse（巨型 checkpoint 逐条 parse 会阻塞 event loop）。
      // teammate 条目恒带 "teammate" 字段，子串预过滤减少环污染；结构化判定留给
      // Pass 1 结束后的 newest-first 校验（isMainAgentEntry），预过滤误伤由环容错。
      if ((raw.includes('"mainAgent":true') || raw.includes('"mainAgent": true')) &&
          !raw.includes('"teammate"')) {
        mainAgentRawRing.push(raw);
        if (mainAgentRawRing.length > MAINAGENT_SCAN_RING) mainAgentRawRing.shift();
      }
    },
    onReady: ({ totalCount, hasMore, oldestTs }) => {
      // Pass 1 完成、Pass 2 开始前：发送 load_start
      // 增量模式下不显示 loading 遮罩，非增量模式显示进度
      const loadStartData = { total: totalCount, incremental: !!useIncremental };
      // 分页模式下附加 hasMore/oldestTs（增量模式由客户端从缓存自行判断）
      if (useLimit) {
        loadStartData.hasMore = !!hasMore;
        loadStartData.oldestTs = oldestTs || '';
      }
      sseWrite(res, `event: load_start\ndata: ${JSON.stringify(loadStartData)}\n\n`);
    },
  });

  // Wire v3 (V3.S2/S4/S5): cold rows + native lines land BEFORE load_end so
  // the flagged client can assemble its window in the same load cycle. The
  // legacy chunk stream was skipped above (v3Cold) — load_start is emitted
  // here from the rows metadata instead.
  if (v3Cold) {
    try {
      const src = _v3Src;
      // Single-flighted bundle (review P2-b): a reconnect storm coalesces to
      // one journal fold + one native read per (dir, window). `since` scopes
      // an incremental reconnect to the delta window (review P1-2) — the
      // client upserts those rows instead of resetting the list.
      const { meta, native } = await readV2ColdBundle(src, {
        limit: useLimit ? effectiveLimit : 0,
        since: useIncremental ? sinceParam : null,
      });
      // Build every payload BEFORE load_start so it can carry the exact byte
      // total — the client renders a real received/total progress (the legacy
      // wire's per-entry count-up has no per-frame granularity here).
      const rowsPayload = JSON.stringify({ rows: meta.rows, totalCount: meta.totalCount, hasMore: meta.hasMore, oldestTs: meta.oldestTimestamp, incremental: !!useIncremental });
      let v3Bytes = rowsPayload.length;
      for (const p of native.convPayloads) v3Bytes += p.length;
      for (const p of native.respPayloads) v3Bytes += p.length;
      const loadStartData = { total: meta.totalCount, incremental: !!useIncremental, v3Bytes };
      if (useLimit) {
        loadStartData.hasMore = !!meta.hasMore;
        loadStartData.oldestTs = meta.oldestTimestamp || '';
      }
      sseWrite(res, `event: load_start\ndata: ${JSON.stringify(loadStartData)}\n\n`);
      sseWrite(res, `event: v2_requests\ndata: ${rowsPayload}\n\n`);
      for (const payload of native.convPayloads) sseWrite(res, `event: v3_conv\ndata: ${payload}\n\n`);
      for (const payload of native.respPayloads) sseWrite(res, `event: v3_resp\ndata: ${payload}\n\n`);
      // kv-cache / context_window sources: rebuild the newest completed
      // mainAgent rows. Depth 3 mirrors the legacy scan-ring fallback (review
      // P2-e): the newest main may lack usage/cached-content or be a
      // synthesis-gated orphan — earlier candidates then provide the values.
      const mains = meta.rows.filter((r) => r.mainAgent && !r.inProgress).slice(-3);
      for (const m of mains) {
        const detail = await readV2SingleEntry(src, { seq: m.seq, sessionId: m.sessionId });
        if (detail && detail.entry) mainAgentRawRing.push(detail.entry);
      }
    } catch (err) { reportSwallowed('sse.v2_requests', err); }
  }

  sseWrite(res, `event: load_end\ndata: {}\n\n`);

  // S10a: v2 sources no longer invoke onScan (the two-pass window never
  // stringifies out-of-window entries) — the adapter returns the newest-main
  // raws as `mainAgentRing` instead. v1 sources still fill the ring via onScan.
  if (Array.isArray(coldLoadResult?.mainAgentRing) && coldLoadResult.mainAgentRing.length > 0) {
    mainAgentRawRing.length = 0;
    mainAgentRawRing.push(...coldLoadResult.mainAgentRing);
  }

  // Pass 1 入环的候选 newest-first 校验 + parse（≤K 次）。kv_cache 与 context_window
  // 各自取"最新一条能提供该值的真实 mainAgent"—— 与旧版逐条覆盖语义等价（环深度内）。
  for (let ri = mainAgentRawRing.length - 1; ri >= 0 && (!latestKvCache || !latestContextWindow); ri--) {
    try {
      const entry = JSON.parse(mainAgentRawRing[ri]);
      if (!isMainAgentEntry(entry)) continue;
      if (!latestKvCache) {
        const cached = extractCachedContent(entry);
        if (cached) latestKvCache = cached;
      }
      if (!latestContextWindow) {
        const usage = entry.response?.body?.usage;
        if (usage) {
          const contextSize = getContextSizeForModel(entry);
          const cw = buildContextWindowEvent(usage, contextSize);
          if (cw) latestContextWindow = cw;
        }
      }
    } catch { }
  }

  // 发送最新 MainAgent 的 KV-Cache 和 context_window
  if (latestKvCache) {
    sseWrite(res, `event: kv_cache_content\ndata: ${JSON.stringify(latestKvCache)}\n\n`);
  }
  if (latestContextWindow) {
    sseWrite(res, `event: context_window\ndata: ${JSON.stringify(latestContextWindow)}\n\n`);
    pushedContextWindow = true;
  }
  // Fallback: no MainAgent in log (e.g. fresh session after -c), read context-window.json
  if (!pushedContextWindow) {
    try {
      const cwRaw = readFileSync(CONTEXT_WINDOW_FILE, 'utf-8');
      const cwFile = JSON.parse(cwRaw);
      if (cwFile?.context_window) {
        // Recalculate with correct context size from model.id
        const { contextSize } = readModelContextSize();
        const cw = cwFile.context_window;
        const inputTokens = cw.total_input_tokens || 0;
        const outputTokens = cw.total_output_tokens || 0;
        const totalTokens = inputTokens + outputTokens;
        // 自适应纠偏:与 buildContextWindowEvent 同源(context-rules.adaptContextWindow),
        // 避免这条 fallback 与已纠偏的主路径产出不一致的血条。
        const effectiveSize = adaptContextWindow(contextSize, inputTokens);
        const usedPct = effectiveSize > 0 ? Math.round((totalTokens / effectiveSize) * 100) : 0;
        const data = { ...cw, context_window_size: effectiveSize, used_percentage: usedPct, remaining_percentage: 100 - usedPct };
        sseWrite(res, `event: context_window\ndata: ${JSON.stringify(data)}\n\n`);
      }
    } catch { }
  }

  // 历史数据 + KV-Cache + context_window 全部发送完毕后，才将客户端加入广播列表。
  // 这样 watcher 的 sendToClients 不会在 load 阶段向该客户端推送 live entry。
  // Stamp the viewed project so per-project feeds route live entries to exactly
  // the clients viewing that project (unset ⇒ the bound project, the default).
  if (viewedProject) res._ccvViewProject = viewedProject;
  // Multi-instance: stamp the viewed instance too, so a same-cwd project's live feed can
  // route each instance's entries to exactly the clients viewing THAT instance (unset ⇒
  // instance-agnostic, the pre-multi-instance default).
  if (instanceParam) res._ccvViewInstance = instanceParam;
  deps.clients.push(res);

  // 任务清单快照补推：内存态不在冷加载数据里，页面刷新/重连后横条要等下一次
  // 任务事件才恢复 —— 连接建立即推一份当前快照（空列表也推，清掉客户端残留）。
  try {
    const snap = deps.getTaskSnapshot?.();
    if (snap) sseWrite(res, `event: task_update\ndata: ${JSON.stringify({ sessionId: snap.sessionId, tasks: snap.tasks, ts: Date.now() })}\n\n`);
  } catch (err) { reportSwallowed('sse.task_update.snapshot', err); }

  // req.on('close') 在某些异常断连时不一定立即触发；res 端 close/error 兜底保证
  // 不会在 clients 数组里留下幽灵 res，防止 sendToClients 后续写入触发慢泄漏。
  const removeFromClients = () => {
    clearInterval(pingTimer);
    const idx = deps.clients.indexOf(res);
    if (idx !== -1) deps.clients.splice(idx, 1);
  };
  req.on('close', removeFromClients);
  res.on('close', removeFromClients);
  res.on('error', removeFromClients);
}

// API endpoint
async function requests(req, res) {
  // 异步流式 JSON 数组输出，不做 reconstruct，发原始条目
  // flush:false —— whole-stream response: the client parses the array only
  // when complete, so per-macrotask flush boundaries would just cost ratio.
  sseHead(req, res, 200, { 'Content-Type': 'application/json' }, { flush: false });
  try {
    sseWrite(res, '[');
    let first = true;
    // No deps bag on this route — read the wire flag from the same env source
    // server.js uses (isWireV3Enabled), keeping serveInFlight wire-consistent.
    await streamRawEntriesAsync(getLiveLogSource({ serveInFlight: isWireV3Enabled(process.env.CCV_WIRE_V3) }), (raw) => {
      if (!first) sseWrite(res, ',');
      sseWrite(res, enrichRawIfNeeded(raw));
      first = false;
    });
    sseWrite(res, ']');
    wireEnd(res);
  } catch (err) {
    // Mid-stream failure (e.g. session dir converted/removed while streaming):
    // without this catch the rejection propagates through the dispatcher and
    // kills the process. Headers are already sent — close the stream cleanly.
    console.error('[api-requests]', err && err.stack || err);
    wireEnd(res);
  }
}

export const eventsRoutes = [
  { method: 'POST', match: 'exact', path: '/api/turn-end-notify', handler: turnEndNotify },
  { method: 'POST', match: 'exact', path: '/api/session-start-notify', handler: sessionStartNotify },
  { method: 'POST', match: 'exact', path: '/api/task-event', handler: taskEventNotify },
  { method: 'GET', match: 'exact', path: '/events', handler: events },
  { method: 'GET', match: 'exact', path: '/api/requests', handler: requests },
];
