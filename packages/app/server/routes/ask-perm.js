// Ask / permission hook bridge routes (moved verbatim from server.js handleRequest).
import { loadAskStore, consumeIfFinal as askStoreConsumeIfFinal, markCancelled as askStoreMarkCancelled } from '../lib/ask-store.js';
import { runWaterfallHook, runParallelHook } from '../lib/plugin-loader.js';
import { sendEventToClients } from '../lib/log-watcher.js';

function pendingAsks(req, res, parsedUrl, isLocal, deps) {
  try {
    // 优先内存 Map（含活跃 res / timer 的真实状态），用 createdAt 排序；
    // 再 union disk（hydrate 已死 entry 或本进程未持有的孤儿 entry，用于恢复 UI 列表，
    // 答案投递仍由 WS ask-hook-answer 路径走 server 端 first-write-wins）。
    const memEntries = [...deps.pendingAskHooks.entries()].map(([id, e]) => ({
      id, questions: e.questions, createdAt: e.createdAt, source: 'memory',
    }));
    const memIds = new Set(memEntries.map(e => e.id));
    const diskAll = loadAskStore();
    // 只暴露 status === 'pending' 的 disk entry —— markAnswered 创建的 questions=[] 终态占位
    // 也会被 loadAskStore 返回，但它不是真"待回答"，前端 inject 会渲染空 ghost ask。
    // 另外过滤 questions 数组非空（防御性）。
    const diskOnly = Object.values(diskAll)
      .filter(e => !memIds.has(e.id) && e.status === 'pending' && Array.isArray(e.questions) && e.questions.length > 0)
      .map(e => ({ id: e.id, questions: e.questions, createdAt: e.createdAt, source: 'disk' }));
    const all = [...memEntries, ...diskOnly].sort((a, b) => a.createdAt - b.createdAt);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ pendingAsks: all, askProtocolVersion: 1 }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'failed to read pending asks', detail: String(err?.message || err) }));
  }
}

// Ask hook bridge: long-poll endpoint for PreToolUse AskUserQuestion hook
function askHook(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  let bodyTooLarge = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1000000) { // 1MB limit (questions may contain large previews)
      bodyTooLarge = true;
      req.destroy();
    }
  });
  // Phase 3: ask-bridge 用 `X-Ask-Poll-Mode: short` 头声明走短轮询。新 server 看到后
  // 立即返 { id, capability: 'short-poll' }（不挂 res），client 之后 GET /api/ask-hook/:id/result 取答案。
  // 老 server 不识别此头 → 按长轮询走（仍挂 res 直到答案/24h 超时）→ 完全向后兼容。
  const shortPollMode = (req.headers['x-ask-poll-mode'] || '').toLowerCase() === 'short';
  req.on('end', async () => {
    if (bodyTooLarge) {
      try { if (!res.headersSent) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Request body too large' })); } } catch {}
      return;
    }
    try {
      const { questions, toolUseId } = JSON.parse(body);
      if (!Array.isArray(questions) || questions.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing questions' }));
        return;
      }
      // 镜像 ask-bridge 的 normalize：覆盖 plugin/SDK 等非 ask-bridge 的 client。
      // 缺失 description 补 ""，前端按 hasOptionDescription 判断走非渲染分支。
      for (const q of questions) {
        if (!q || typeof q !== 'object' || !Array.isArray(q.options)) continue;
        for (const opt of q.options) {
          if (opt && typeof opt === 'object' && opt.description === undefined) {
            opt.description = '';
          }
        }
      }

      // Evict oldest if Map is full (prevent memory leak from pathological concurrency).
      // Mirrors perm-hook eviction; an evicted bridge process gets HTTP 429 and falls back
      // to its own terminal UI rather than leaking long-poll state.
      if (deps.pendingAskHooks.size >= deps.ASK_HOOK_MAP_MAX) {
        const oldestId = deps.pendingAskHooks.keys().next().value;
        const oldest = deps.pendingAskHooks.get(oldestId);
        if (oldest) {
          clearTimeout(oldest.timer);
          try { if (!oldest.res.headersSent) { oldest.res.writeHead(429, { 'Content-Type': 'application/json' }); oldest.res.end(JSON.stringify({ error: 'Too many concurrent requests' })); } } catch {}
          deps.pendingAskHooks.delete(oldestId);
          deps.persistAskDelete(oldestId);
          if (deps.terminalWss) {
            const tmsg = JSON.stringify({ type: 'ask-hook-timeout', id: oldestId });
            deps.terminalWss.clients.forEach((c) => {
              if (c.readyState === 1) try { c.send(tmsg); } catch {}
            });
          }
          deps.notifyParentPending({ type: 'ask-hook-timeout', id: oldestId });
        }
      }

      // 实质等同"无超时"，仍保留兜底防 entry 泄漏（plugin throw / OOM 等异常路径）。
      // ask-bridge 不设客户端 timeout，由 server 单向控制 response 终止。
      const HOOK_TIMEOUT = deps.ASK_HOOK_TIMEOUT_MS;
      // toolUseId 路由策略：
      //  - char whitelist + ≤256 长度 防恶意 1MB key 撑大 Map
      //  - 已存在同 id 但旧 res 已断（writableEnded/destroyed）→ 复用槽位（ask-bridge 重试场景）
      //  - 已存在同 id 且旧 res 活 → 返 409 Conflict（真重复）而非走 fallback id 让前端 portal 失效
      //  - 缺 toolUseId 或非法 → fallback 自生成 id
      const wantsToolUseId = toolUseId && typeof toolUseId === 'string'
        && toolUseId.length > 0 && toolUseId.length <= 256
        && /^[a-zA-Z0-9_-]+$/.test(toolUseId);
      let id;
      if (wantsToolUseId) {
        const existing = deps.pendingAskHooks.get(toolUseId);
        if (!existing) {
          id = toolUseId;
        } else if (!existing.res || existing.res.writableEnded || existing.res.destroyed) {
          // 旧 res 已断（包含占位 res:null 残留）— ask-bridge 重试同 toolUseId 合理，复用槽位
          if (existing.timer) clearTimeout(existing.timer);
          deps.pendingAskHooks.delete(toolUseId);
          deps.persistAskDelete(toolUseId);
          id = toolUseId;
        } else {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Duplicate toolUseId, previous request still pending' }));
          return;
        }
      } else {
        // Fallback id：当 hook caller 没传 toolUseId（如老 Claude Code PreToolUse hook
        // payload 不含 tool_use_id），生成 ask_${ts}_${rnd} 占位。这个 id 与 jsonl 里
        // tool_use.id（toolu_xxx）不同名，前端 portal 决策必须按 ask_* 前缀通配命中。
        // 协议锚点：src/utils/askPortalMatcher.js — 改此处前缀格式必须同步改 matcher。
        do { id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; } while (deps.pendingAskHooks.has(id));
      }

      // TOCTOU 防御：占位 id 之前先注册 res.on('close')，否则 await runWaterfallHook 期间 client
      // abort 的 close 事件落空 → entry 残到 HOOK_TIMEOUT（24h）。占位 set 提前到 await 之前防两条同 ms 并发
      // POST 的 do-while 都通过 collision check 后 set 互相覆盖（first res 永泄漏到 HOOK_TIMEOUT）。
      const _placeholderEntry = { questions, res, timer: null, createdAt: Date.now(), shortPoll: shortPollMode };
      deps.pendingAskHooks.set(id, _placeholderEntry);
      deps.persistAskEntry(id, _placeholderEntry);
      // Seed waiter liveness for the reaper (ask-reaper.js). Optional chaining:
      // older deps stubs and third-party callers may not provide the map.
      if (shortPollMode) deps.askWaiterLastPoll?.set(id, Date.now());

      // res.on('close') 提前注册：handler 用 entry.timer 守卫（占位期 timer:null → 仅 delete Map）
      // Phase 3: short-poll 模式下 res 主动 end，close 不视为 client cancel；entry 由 24h timer 兜底清理。
      res.on('close', () => {
        const entry = deps.pendingAskHooks.get(id);
        if (entry) {
          if (entry.shortPoll) return;
          if (entry.timer) clearTimeout(entry.timer);
          deps.pendingAskHooks.delete(id);
          deps.persistAskDelete(id);
          if (deps.terminalWss) {
            const tmsg = JSON.stringify({ type: 'ask-hook-timeout', id });
            deps.terminalWss.clients.forEach((c) => {
              if (c.readyState === 1) try { c.send(tmsg); } catch {}
            });
          }
          deps.notifyParentPending({ type: 'ask-hook-timeout', id });
        }
      });

      // Plugin hook: let plugins answer questions directly
      try {
        const hookResult = await runWaterfallHook('onAskRequest', { id, questions, mode: 'hook' });
        if (hookResult.answers) {
          deps.pendingAskHooks.delete(id); // 释放占位 — plugin 直接答了
          deps.persistAskDelete(id);
          // race: plugin 执行期间 client 主动断开 → res.on('close') 已清 entry，
          // 但本闭包仍持着 res 引用；guard 防 writeHead 抛 ERR_STREAM_WRITE_AFTER_END
          if (!res.writableEnded && !res.destroyed && !res.headersSent) {
            try {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ answers: hookResult.answers }));
            } catch {}
          }
          return;
        }
      } catch {}

      const timer = setTimeout(() => {
        const entry = deps.pendingAskHooks.get(id);
        if (entry) {
          deps.pendingAskHooks.delete(id);
          deps.persistAskDelete(id);
          try {
            // null guard：plugin throw + outer body-parse race 极端下占位残留时 fire 防 TypeError
            if (entry.res && !entry.res.headersSent) {
              entry.res.writeHead(408, { 'Content-Type': 'application/json' });
              entry.res.end(JSON.stringify({ error: 'Timeout' }));
            }
          } catch {}
          if (deps.terminalWss) {
            const tmsg = JSON.stringify({ type: 'ask-hook-timeout', id });
            deps.terminalWss.clients.forEach((c) => {
              if (c.readyState === 1) try { c.send(tmsg); } catch {}
            });
          }
          deps.notifyParentPending({ type: 'ask-hook-timeout', id });
        }
      }, HOOK_TIMEOUT);

      const askStartedAt = Date.now();
      const _liveEntry = { questions, res, timer, createdAt: askStartedAt, shortPoll: shortPollMode };
      deps.pendingAskHooks.set(id, _liveEntry);
      deps.persistAskEntry(id, _liveEntry);

      // Phase 3: short-poll 模式立即返 ack，让 client 改走 GET 轮询；entry 留在内存等 ws answer。
      if (shortPollMode) {
        try {
          if (!res.headersSent) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ id, capability: 'short-poll' }));
          }
        } catch {}
      }

      // Broadcast to all terminal WS clients — 附 startedAt + timeoutMs 让前端渲染倒计时
      if (deps.terminalWss) {
        const pmsg = JSON.stringify({ type: 'ask-hook-pending', id, questions, startedAt: askStartedAt, timeoutMs: HOOK_TIMEOUT });
        deps.terminalWss.clients.forEach((client) => {
          if (client.readyState === 1) {
            try { client.send(pmsg); } catch {}
          }
        });
      }
      deps.notifyParentPending({ type: 'ask-hook-pending', id, questions });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
  });
}

// Phase 3: short-poll handoff endpoint. ask-bridge GET /api/ask-hook/:id/result?wait=30000
// 在 wait ms 内若答案/cancel 到达 → 立即返；否则返 204 让 client 重发。
// 内存有 entry → 注册 listener；内存无 → 查 disk consume（server 重启场景）。
async function askHookResult(req, res, parsedUrl, isLocal, deps) {
  const url = parsedUrl.pathname;
  try {
    // URL 形如 /api/ask-hook/<id>/result?wait=30000；id 受白名单约束（与 POST 同源）
    const m = url.match(/^\/api\/ask-hook\/([^/?]+)\/result(?:\?(.*))?$/);
    if (!m) { res.writeHead(400); res.end(); return; }
    const id = decodeURIComponent(m[1]);
    if (!id || id.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid id' }));
      return;
    }
    const qs = new URLSearchParams(m[2] || '');
    const wait = Math.max(1000, Math.min(60000, parseInt(qs.get('wait') || '30000', 10)));
    // Refresh waiter liveness on every poll arrival (see ask-reaper.js). Unconditional:
    // even a poll that ends in 404/final proves the waiter process is alive; the reaper
    // GCs records for ids that are no longer pending.
    deps.askWaiterLastPoll?.set(id, Date.now());

    // 1) disk 命中 answered/cancelled：浏览器答得早过 GET 到达 → 立即返并消费（一次性）
    // 用 consumeIfFinal 单次 withLock 内判 status 决定是否 delete —— 旧设计的
    // "consume + 若 pending 再 setEntry 写回" 两段是 race window：中间被 markAnswered 命中后，
    // setEntry 走 status guard 已经不会覆盖；但不删的 pending 也无须重写一遍。
    const diskEntry = await askStoreConsumeIfFinal(id);
    if (diskEntry && diskEntry.status === 'answered') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ answers: diskEntry.answers || {} }));
      return;
    }
    if (diskEntry && diskEntry.status === 'cancelled') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cancelled: true, reason: diskEntry.cancelReason || '' }));
      return;
    }
    // diskEntry.status === 'pending' → consumeIfFinal 已保留它，无须重写

    // 2) entry 仍 pending：注册 listener 等 wait ms。内存或 disk 至少一个有就允许注册——
    //    server 重启后 disk 是 pending，但内存无 entry，仍要让 GET 挂等（浏览器答案到达时
    //    会走 ws ask-hook-answer handler 路径，handler 内 markAnswered 落 disk + _notifyShortPollAnswer 直推 listener）。
    const memEntry = deps.pendingAskHooks.get(id);
    if (!memEntry && !diskEntry) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no such ask' }));
      return;
    }
    const listener = { res, finished: false, tid: null };
    if (!deps.shortPollListeners.has(id)) deps.shortPollListeners.set(id, new Set());
    deps.shortPollListeners.get(id).add(listener);
    listener.tid = setTimeout(() => {
      if (listener.finished) return;
      listener.finished = true;
      deps.shortPollListeners.get(id)?.delete(listener);
      try { if (!res.headersSent) { res.writeHead(204); res.end(); } } catch {}
    }, wait);
    res.on('close', () => {
      if (listener.finished) return;
      listener.finished = true;
      clearTimeout(listener.tid);
      deps.shortPollListeners.get(id)?.delete(listener);
    });
  } catch (err) {
    try {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String(err?.message || err) }));
      }
    } catch {}
  }
}

// POST /api/ask-hook/:id/cancel — best-effort cancel from a dying hook process
// (ask-bridge SIGTERM/SIGINT handler) or any client that wants to durably resolve
// a pending ask. Mirrors the WS ask-cancel handler in server.js for the hook path.
// Auth: standard request prelude (loopback-exempt), same as the sibling ask-hook routes.
function askHookCancel(req, res, parsedUrl, isLocal, deps) {
  const m = parsedUrl.pathname.match(/^\/api\/ask-hook\/([^/?]+)\/cancel$/);
  const id = m ? decodeURIComponent(m[1]) : '';
  if (!id || id.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid id' }));
    return;
  }
  let body = '';
  let bodyTooLarge = false;
  req.on('data', (chunk) => {
    if (bodyTooLarge) return;
    body += chunk;
    if (body.length > 4096) {
      // Respond here, not in 'end': req.destroy() never emits 'end' in real Node,
      // so a deferred 413 would be dead code (mirrors permHook's in-data rejection).
      bodyTooLarge = true;
      try { if (!res.headersSent) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Request body too large' })); } } catch {}
      req.destroy();
    }
  });
  req.on('end', async () => {
    if (bodyTooLarge) return;
    let reason = 'hook process exited';
    try {
      const parsed = body ? JSON.parse(body) : {};
      if (typeof parsed.reason === 'string' && parsed.reason) reason = parsed.reason.slice(0, 500);
    } catch {}
    // Respond fast: the caller may be a process that is about to die.
    try { if (!res.headersSent) { res.writeHead(204); res.end(); } } catch {}
    try {
      let handled = false;
      const entry = deps.pendingAskHooks.get(id);
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        deps.pendingAskHooks.delete(id);
        deps.askWaiterLastPoll?.delete(id);
        if (entry.shortPoll) {
          const wrote = await askStoreMarkCancelled(id, reason);
          if (wrote) deps.notifyShortPollCancel?.(id, reason);
          handled = wrote;
        } else {
          // Long-poll: end the hanging hook response so the bridge unblocks.
          try {
            if (entry.res && !entry.res.headersSent) {
              entry.res.writeHead(200, { 'Content-Type': 'application/json' });
              entry.res.end(JSON.stringify({ cancelled: true, reason }));
            }
          } catch {}
          deps.persistAskDelete(id);
          handled = true;
        }
      } else {
        // Disk-only (e.g. entry orphaned by a previous server process). Wake any
        // hanging poll listeners too — parity with the WS ask-cancel handler.
        handled = await askStoreMarkCancelled(id, reason);
        if (handled) deps.notifyShortPollCancel?.(id, reason);
      }
      if (handled) {
        if (deps.terminalWss) {
          const cmsg = JSON.stringify({ type: 'ask-hook-cancelled', id, reason });
          deps.terminalWss.clients.forEach((c) => {
            if (c.readyState === 1) try { c.send(cmsg); } catch {}
          });
        }
        deps.notifyParentPending({ type: 'ask-hook-cancelled', id });
      }
    } catch {}
  });
}

// Permission hook bridge: receive tool permission request from perm-bridge.js, long-poll for user decision
function permHook(req, res, parsedUrl, isLocal, deps) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1000000) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Request body too large' }));
      return;
    }
  });
  req.on('end', async () => {
    try {
      const { toolName, input } = JSON.parse(body);
      if (!toolName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing toolName' }));
        return;
      }

      // Evict oldest if Map is full (prevent memory leak from pathological concurrency)
      if (deps.pendingPermHooks.size >= deps.PERM_HOOK_MAP_MAX) {
        const oldestId = deps.pendingPermHooks.keys().next().value;
        const oldest = deps.pendingPermHooks.get(oldestId);
        if (oldest) {
          clearTimeout(oldest.timer);
          try { if (!oldest.res.headersSent) { oldest.res.writeHead(429, { 'Content-Type': 'application/json' }); oldest.res.end(JSON.stringify({ error: 'Too many concurrent requests' })); } } catch {}
          deps.pendingPermHooks.delete(oldestId);
        }
      }

      const PERM_HOOK_TIMEOUT = 5 * 60 * 1000;
      const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Plugin hook: let plugins handle permission requests directly.
      // 与 sdk-manager.js:401-412 对齐：严格白名单 'allow'|'deny'，未知值 fall-through 到常规审批。
      // 早期 truthy-check 会把 plugin 返回的任意字符串原样转发到 perm-bridge（再被 coerce 为 'deny'），
      // 既违反 cb2326e 声明的 fail-safe 语义，又让 SDK 与 bridge 两路径行为不对称。
      try {
        const hookResult = await runWaterfallHook('onPermRequest', { id, toolName, input, mode: 'hook' });
        if (hookResult.decision === 'allow' || hookResult.decision === 'deny') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ decision: hookResult.decision }));
          return;
        }
      } catch {}

      const timer = setTimeout(() => {
        const entry = deps.pendingPermHooks.get(id);
        if (entry) {
          deps.pendingPermHooks.delete(id);
          try {
            if (!entry.res.headersSent) {
              entry.res.writeHead(408, { 'Content-Type': 'application/json' });
              entry.res.end(JSON.stringify({ error: 'Timeout' }));
            }
          } catch {}
          if (deps.terminalWss) {
            const tmsg = JSON.stringify({ type: 'perm-hook-timeout', id });
            deps.terminalWss.clients.forEach((c) => {
              if (c.readyState === 1) try { c.send(tmsg); } catch {}
            });
          }
        }
      }, PERM_HOOK_TIMEOUT);

      deps.pendingPermHooks.set(id, { toolName, input, res, timer, createdAt: Date.now() });

      // Broadcast to all terminal WS clients
      if (deps.terminalWss) {
        const pmsg = JSON.stringify({ type: 'perm-hook-pending', id, toolName, input });
        deps.terminalWss.clients.forEach((client) => {
          if (client.readyState === 1) {
            try { client.send(pmsg); } catch {}
          }
        });
      }

      // Handle perm-bridge.js disconnection
      res.on('close', () => {
        const entry = deps.pendingPermHooks.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          deps.pendingPermHooks.delete(id);
          if (deps.terminalWss) {
            const tmsg = JSON.stringify({ type: 'perm-hook-timeout', id });
            deps.terminalWss.clients.forEach((c) => {
              if (c.readyState === 1) try { c.send(tmsg); } catch {}
            });
          }
        }
      });
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    }
  });
}

// 流式 chunk 接收端点：interceptor 在 SSE 流过程中推送的 partial entry
// 仅广播，不落盘。前端按 timestamp|url 自动与最终 entry 去重覆盖。
// 鉴权：server 绑 0.0.0.0 允许同机任意进程访问，必须校验 remote 必须是 loopback
// 且请求带 x-cc-viewer-internal: 1 header，防止同机其他进程伪造 SSE 内容注入广播。
function streamChunk(req, res, parsedUrl, isLocal, deps) {
  const remote = req.socket.remoteAddress || '';
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const internalHeader = req.headers['x-cc-viewer-internal'] === '1';
  if (!isLoopback || !internalHeader) {
    try { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Forbidden' })); } catch {}
    return;
  }
  let body = '';
  let aborted = false;
  req.on('data', (chunk) => {
    if (aborted) return;
    body += chunk;
    if (body.length > 8 * 1024 * 1024) {
      aborted = true;
      try { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Payload too large' })); } catch {}
    }
  });
  req.on('end', () => {
    if (aborted) return;
    try {
      const entry = JSON.parse(body);
      const key = `${entry.timestamp}|${entry.url}`;
      const seq = typeof entry._chunkSeq === 'number' ? entry._chunkSeq : 0;
      const lastSeq = deps.liveStreamLastSeq.get(key);
      if (lastSeq !== undefined && seq < lastSeq) {
        // 乱序到达的旧 chunk 丢弃
        try { res.writeHead(204); res.end(); } catch {}
        return;
      }
      deps.liveStreamLastSeq.set(key, seq);
      // 清理 seq 记录：超过 200 条时 FIFO 驱逐最早的 100 条（Map 保持插入顺序）
      if (deps.liveStreamLastSeq.size > 200) {
        const keys = Array.from(deps.liveStreamLastSeq.keys()).slice(0, 100);
        for (const k of keys) deps.liveStreamLastSeq.delete(k);
      }
      // 用 named event 'stream-progress' 避免混入 data: 流与 dedup 冲突
      // 精简 payload：前端只需要 timestamp/url/content 渲染 Live overlay
      const _streamChunkPayload = {
        timestamp: entry.timestamp,
        url: entry.url,
        content: entry.response?.body?.content || [],
        model: entry.body?.model,
      };
      sendEventToClients(deps.clients, 'stream-progress', _streamChunkPayload);
      runParallelHook('onStreamChunk', _streamChunkPayload);
    } catch {}
    try { res.writeHead(204); res.end(); } catch {}
  });
}

export const askPermRoutes = [
  { method: 'GET', match: 'exact', path: '/api/pending-asks', handler: pendingAsks },
  { method: 'POST', match: 'exact', path: '/api/ask-hook', handler: askHook },
  { predicate: (url, method) => url.startsWith('/api/ask-hook/') && url.includes('/result') && method === 'GET', handler: askHookResult },
  { predicate: (url, method) => url.startsWith('/api/ask-hook/') && url.includes('/cancel') && method === 'POST', handler: askHookCancel },
  { method: 'POST', match: 'exact', path: '/api/perm-hook', handler: permHook },
  { method: 'POST', match: 'exact', path: '/api/stream-chunk', handler: streamChunk },
];
