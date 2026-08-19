// DingTalk bridge config API. See server/lib/dingtalk-config.js (storage) and
// server/lib/dingtalk-bridge.js (the Stream client) for the underlying logic.
//
//   GET  /api/dingtalk/status — public; remote callers get only hasSecret, the local (admin)
//                               caller additionally gets the plaintext appSecret to view/copy.
//   POST /api/dingtalk/config — loopback-only (!isLocal → 403); save creds, reload bridge.
//   POST /api/dingtalk/test   — loopback-only; validate creds (fetch an access token).
import { loadDingTalkState, saveDingTalkConfig, loadDingTalkConfig } from '../lib/dingtalk-config.js';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function readBody(req, deps, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > deps.MAX_POST_BODY) req.destroy();
  });
  req.on('end', () => cb(body));
}

async function dingtalkStatus(req, res, parsedUrl, isLocal, deps) {
  // 与 /api/im/:platform/status 一致：worker 报自身在进程适配器状态（manager 据此探活）；
  // 主进程经 manager 报 detached worker 的进程/连接状态。
  let conn;
  let processInfo = null;
  if (deps.dingtalk.isWorker) {
    conn = deps.dingtalk.getBridgeStatus();
  } else {
    processInfo = await deps.dingtalk.getProcessStatus();
    conn = {
      running: processInfo.running,
      connected: processInfo.connected,
      connectionState: processInfo.connectionState,
      lastError: processInfo.lastError ?? null,
    };
  }
  res.writeHead(200, JSON_HEADERS);
  if (!isLocal) {
    // connectionState passes through as-is; lastError stays loopback-only (mirrors routes/im.js).
    res.end(JSON.stringify({
      enabled: loadDingTalkState().enabled,
      hasSecret: loadDingTalkState().hasSecret,
      connection: { running: conn.running, connected: conn.connected, connectionState: conn.connectionState },
    }));
    return;
  }
  // 本机(127.0.0.1)= admin / manager 探活：附带明文 appSecret 与 pid（供身份匹配）。
  res.end(JSON.stringify({
    ...loadDingTalkState(),
    appSecret: loadDingTalkConfig().appSecret,
    connection: conn,
    process: processInfo,
    pid: deps.dingtalk.isWorker ? process.pid : (processInfo?.pid ?? null),
  }));
}

function dingtalkConfigPost(req, res, parsedUrl, isLocal, deps) {
  // Loopback-only: an app_secret must never be settable over the LAN even with a valid token.
  if (!isLocal) {
    res.writeHead(403, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'Loopback only' }));
    return;
  }
  readBody(req, deps, async (body) => {
    let incoming;
    try { incoming = JSON.parse(body); }
    catch {
      res.writeHead(400, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    // 发送者白名单为非必填：启用时若 allowStaffIds 为空不再硬拦截（前端弹安全警告）。worker 以
    // --dangerously-skip-permissions 运行，空白名单运行期退化为 bind-first-conversation。打一条
    // 服务端审计（curl/headless 启用走不到前端 toast）；PreToolUse permissions.deny 硬拦截仍生效。
    const staff = Array.isArray(incoming.allowStaffIds)
      ? incoming.allowStaffIds.filter((s) => typeof s === 'string' && s.trim())
      : [];
    if (incoming.enabled && staff.length === 0) {
      console.warn('[CC Viewer] IM dingtalk enabled with EMPTY allowlist — bind-first-conversation; the first conversation to message can drive this --dangerously-skip-permissions session');
    }
    // saveDingTalkConfig preserves the stored secret when appSecret is empty/omitted.
    const saved = saveDingTalkConfig({
      enabled: incoming.enabled,
      appKey: incoming.appKey,
      appSecret: incoming.appSecret,
      allowStaffIds: incoming.allowStaffIds,
      maxChunkChars: incoming.maxChunkChars,
      blockOnSkipPermissions: incoming.blockOnSkipPermissions,
      ackCard: incoming.ackCard,
      cardTemplateId: incoming.cardTemplateId,
      aiCardTemplateId: incoming.aiCardTemplateId,
      aiCardStreamKey: incoming.aiCardStreamKey,
    });
    // 驱动进程管理器（替代旧的在进程 reloadBridge）：启用→重启 worker，停用→停 worker。
    try {
      if (saved?.enabled ?? incoming.enabled) await deps.dingtalk.restartProcess();
      else await deps.dingtalk.stopProcess();
    } catch (e) {
      console.error('[CC Viewer] IM config apply failed for dingtalk:', e?.message || e);
    }
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ ...loadDingTalkState(), connection: { running: !!(saved?.enabled ?? incoming.enabled), connected: false, connectionState: 'disconnected' } }));
  });
}

function dingtalkTestPost(req, res, parsedUrl, isLocal, deps) {
  if (!isLocal) {
    res.writeHead(403, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'Loopback only' }));
    return;
  }
  readBody(req, deps, async (body) => {
    let incoming = {};
    try { incoming = body ? JSON.parse(body) : {}; } catch { /* fall back to stored */ }
    const stored = loadDingTalkConfig();
    const cfg = {
      appKey: incoming.appKey || stored.appKey,
      // empty appSecret → use the stored one (the UI masks it, so edits often omit it)
      appSecret: incoming.appSecret || stored.appSecret,
    };
    if (!cfg.appKey || !cfg.appSecret) {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false, detail: 'missing appKey/appSecret' }));
      return;
    }
    const result = await deps.dingtalk.testConnection(cfg);
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify(result));
  });
}

export const dingtalkRoutes = [
  { method: 'GET', match: 'exact', path: '/api/dingtalk/status', handler: dingtalkStatus },
  { method: 'POST', match: 'exact', path: '/api/dingtalk/config', handler: dingtalkConfigPost },
  { method: 'POST', match: 'exact', path: '/api/dingtalk/test', handler: dingtalkTestPost },
];
