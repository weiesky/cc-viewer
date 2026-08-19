// Generic multi-IM bridge config + process-control API. Platform-parametric (keyed by descriptor id).
//
//   GET  /api/im/:platform/status  — public; remote callers get only enabled+hasSecret+connection,
//                                    the local (admin) caller additionally gets plaintext secrets + process info.
//   POST /api/im/:platform/config  — loopback-only; save creds, then drive the process manager
//                                    (enable→stop+spawn worker, disable→stop). Allowlist is optional:
//                                    enabling with an empty one warns (not blocked) since the worker
//                                    runs with --dangerously-skip-permissions.
//   POST /api/im/:platform/test    — loopback-only; validate creds (fetch an access token).
//   POST /api/im/:platform/process — loopback-only; {action:start|stop|restart} the detached worker.
//                                    'start' requires stored creds (400 `missing …` otherwise) and
//                                    also persists enabled:true (merged into the stored config):
//                                    a worker spawned while the config says disabled no-ops in
//                                    im-bridge-core and would not survive a restart reconcile,
//                                    so "start" must mean "enable + spawn".
//   GET  /api/im/:platform/logs    — resolve the worker's latest .jsonl (for the records popup).
//
// Architecture: IM adapters no longer run in the main ccv. Each enabled IM runs as an independent
// detached ccv worker (im-process-manager). In the MAIN process, status/process routes go through the
// manager (lock + loopback probe of the worker). In a WORKER process (CCV_IM_PLATFORM set), status
// reports its own in-process adapter (deps.im.getBridgeStatus) — that's what the manager probes.
import { getDescriptor, loadConfig, loadState, saveConfig } from '../lib/im-config.js';
import { findRecentLog } from '../lib/interceptor-core.js';
import { listV2Sessions } from '../lib/v2/adapter.js';
import { readSenders } from '../lib/im-senders.js';
import { readImAppendSystem, writeImAppendSystem, buildImAppendSystemPreset, MAX_IM_APPEND_SYSTEM_CHARS } from '../lib/im-append-system.js';
import { imDir } from '../lib/im-lock.js';
import { resolvePrefLang } from '../lib/im-lang.js';
import { listSkills, moveSkill, deleteSkill } from '../lib/skills-api.js';
import { importSkillTo } from './skills.js';
import { LOG_DIR } from '../../findcc.js';
import { join, basename } from 'node:path';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const IM_RE = /^\/api\/im\/([a-z0-9_-]+)\/(status|config|test|process|logs|senders|append-system|skills|skills\/toggle|skills\/delete|skills\/import)$/;

/** Resolve a known platform id from the URL, or null (→ 404) for an unknown one. */
function platformOf(url) {
  const m = IM_RE.exec(url);
  if (!m) return null;
  return getDescriptor(m[1]) ? m[1] : null;
}

function imPredicate(verb, method) {
  return (url, m) => {
    if (m !== method) return false;
    const x = IM_RE.exec(url);
    return !!x && x[2] === verb;
  };
}

function notFound(res) {
  res.writeHead(404, JSON_HEADERS);
  res.end(JSON.stringify({ error: 'Unknown IM platform' }));
}
function loopbackOnly(res) {
  res.writeHead(403, JSON_HEADERS);
  res.end(JSON.stringify({ error: 'Loopback only' }));
}

function secretKeys(id) {
  return getDescriptor(id).fields.filter((f) => f.type === 'secret').map((f) => f.key);
}

/** Required cred/secret field keys that are empty in `cfg` (same gate as the /test route). */
function missingCreds(id, cfg) {
  return getDescriptor(id).fields
    .filter((f) => (f.type === 'cred' || f.type === 'secret') && !cfg[f.key])
    .map((f) => f.key);
}

// Audit every path that flips a platform on with an empty sender allowlist (bind-first-conversation
// under --dangerously-skip-permissions). Shared by config POST and process 'start' so no enabling
// path can bypass the server-side warning — headless callers never see the frontend toast.
function warnIfEmptyAllowlist(id, cfg) {
  const allowField = getDescriptor(id).allowListField;
  // 过滤空白项后再判空：saveConfig 会 normalize（trim+丢空），若只看原始长度，[" "] 这类全空白
  // 白名单会被当成"已配置"而漏掉审计告警，但实际保存的是空名单（与 dingtalk 路由保持一致）。
  const raw = Array.isArray(cfg[allowField]) ? cfg[allowField] : [];
  const list = raw.filter((s) => typeof s === 'string' && s.trim());
  if (list.length === 0) {
    console.warn(`[CC Viewer] IM ${id} enabled with EMPTY allowlist — bind-first-conversation; the first conversation to message can drive this --dangerously-skip-permissions session`);
  }
}

function readBody(req, deps, cb) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > deps.MAX_POST_BODY) req.destroy();
  });
  req.on('end', () => cb(body));
}

async function imStatus(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  const state = loadState(id);

  let connection;
  let processInfo = null;
  if (deps.im.isWorker) {
    // WORKER: report its own in-process adapter status — this is exactly what the main process's
    // manager probes over loopback to learn whether the bot is actually connected.
    connection = deps.im.getBridgeStatus(id);
  } else {
    // MAIN: the adapter runs in a detached worker, not here. Resolve process+connection via manager.
    processInfo = await deps.im.getProcessStatus(id);
    connection = {
      running: processInfo.running,
      connected: processInfo.connected,
      connectionState: processInfo.connectionState,
      lastError: processInfo.lastError ?? null,
    };
  }

  res.writeHead(200, JSON_HEADERS);
  if (!isLocal) {
    // Loopback gate: a token-authorized LAN client sees only what the header chip needs.
    // connectionState is passed through as-is (no defaulting); lastError stays loopback-only.
    res.end(JSON.stringify({
      enabled: state.enabled,
      hasSecret: state.hasSecret,
      connection: { running: connection.running, connected: connection.connected, connectionState: connection.connectionState },
    }));
    return;
  }
  // 本机(127.0.0.1)= admin / 或 manager 探活：附带明文密钥与 pid（供身份匹配），镜像旧策略。
  const cfg = loadConfig(id);
  const secrets = {};
  for (const k of secretKeys(id)) secrets[k] = cfg[k];
  res.end(JSON.stringify({
    ...state,
    ...secrets,
    connection,
    process: processInfo,
    pid: deps.im.isWorker ? process.pid : (processInfo?.pid ?? null),
  }));
}

function imConfigPost(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  readBody(req, deps, async (body) => {
    let incoming;
    try { incoming = JSON.parse(body); }
    catch {
      res.writeHead(400, JSON_HEADERS);
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    // 【已评审确认 / ACCEPTED】允许空白名单是有意的产品取舍，非缺陷——code review 请勿反复 flag。
    //   缓解层：PreToolUse permissions.deny（perm-bridge/im-deny，独立于白名单）始终硬拦截 + 服务端审计日志。
    // 发送者白名单为非必填：启用时若白名单为空，不再硬拦截，而是允许保存（前端会弹安全警告）。
    // 安全提示：worker 以 --dangerously-skip-permissions 运行；白名单为空时运行期退化为
    // bind-first-conversation（im-bridge-core.js）——首个向机器人发消息的会话被绑定，该会话内任何人
    // 都可无审批驱动本地会话。这里打一条服务端审计（curl/headless 启用走不到前端 toast），
    // PreToolUse permissions.deny 硬拦截（perm-bridge/im-deny，独立于白名单）仍然生效。
    if (incoming.enabled) warnIfEmptyAllowlist(id, incoming);
    const saved = saveConfig(id, incoming);
    // applyProcess（默认 true，保持旧调用方语义）：前端 onBlur 自动保存传 false → 仅存盘、不驱动进程，
    // 否则每次输入框失焦都会重启 worker。显式「启动/停止」按钮则不传（=true），沿用下述驱动逻辑。
    // 注：applyProcess 是未知字段，saveConfig/normalize 不会把它写盘。
    // 驱动进程管理器（替代旧的在进程 reloadBridge）：启用→重启 worker（吸收新凭证），停用→停 worker。
    try {
      if (incoming.applyProcess !== false) {
        if (saved.enabled) await deps.im.restartProcess(id);
        else await deps.im.stopProcess(id);
      }
    } catch (e) {
      // 进程操作失败不应阻塞配置保存的响应，但必须记录——否则 worker 起不来时用户看到乐观的
      // running:true 却毫无线索（spawn 失败 / EACCES on process.out.log 等）。
      console.error(`[CC Viewer] IM config apply failed for ${id}:`, e?.message || e);
    }
    res.writeHead(200, JSON_HEADERS);
    // 乐观返回：worker 刚 spawn 尚未就绪，避免回包瞬间显示"已停止"；chip 轮询会很快收敛到真实态。
    res.end(JSON.stringify({ ...loadState(id), connection: { running: !!saved.enabled, connected: false, connectionState: 'disconnected' } }));
  });
}

function imTestPost(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  readBody(req, deps, async (body) => {
    let incoming = {};
    try { incoming = body ? JSON.parse(body) : {}; } catch { /* fall back to stored */ }
    const stored = loadConfig(id);
    const cfg = {};
    for (const f of getDescriptor(id).fields) cfg[f.key] = incoming[f.key] || stored[f.key];
    const missing = missingCreds(id, cfg);
    if (missing.length) {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false, detail: `missing ${missing.join('/')}` }));
      return;
    }
    const result = await deps.im.testConnection(id, cfg);
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify(result));
  });
}

function imProcessPost(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  // 只有主进程负责管理 worker；worker 自身不应被要求 spawn/stop（避免嵌套）。
  if (deps.im.isWorker) {
    res.writeHead(409, JSON_HEADERS);
    res.end(JSON.stringify({ error: 'Process control is only available in the main ccv process' }));
    return;
  }
  readBody(req, deps, async (body) => {
    let action;
    try { action = JSON.parse(body || '{}').action; } catch { /* invalid → handled below */ }
    try {
      if (action === 'stop') await deps.im.stopProcess(id);
      else if (action === 'restart') await deps.im.restartProcess(id);
      else if (action === 'start') {
        const cfg = loadConfig(id);
        // Credential gate (same as /test): without creds the spawned worker's bridge no-ops
        // forever, and persisting enabled:true would make reconcile respawn that zombie on
        // every server restart. Reject up front — nothing is persisted, nothing is spawned.
        const missing = missingCreds(id, cfg);
        if (missing.length) {
          res.writeHead(400, JSON_HEADERS);
          res.end(JSON.stringify({ ok: false, error: `missing ${missing.join('/')}`, detail: `missing ${missing.join('/')}` }));
          return;
        }
        // Persist enabled:true first (read-merge-write keeps creds/allowlist intact): a worker
        // spawned with enabled:false no-ops its bridge, and reconcile would not respawn it.
        if (!cfg.enabled) {
          warnIfEmptyAllowlist(id, cfg);
          saveConfig(id, { ...cfg, enabled: true });
        }
        await deps.im.startProcess(id);
      } else {
        res.writeHead(400, JSON_HEADERS);
        res.end(JSON.stringify({ error: 'action must be start|stop|restart' }));
        return;
      }
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, process: await deps.im.getProcessStatus(id) }));
    } catch (e) {
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

function imLogs(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  // 弹窗打开即请求本接口 → 惰性登记该平台日志目录监听，后续写入经 im_log_update SSE 零滞后推送。
  deps.ensureImWatch?.(id);
  const project = `IM_${id}`;
  let latest = null;
  try {
    // wire-v2: prefer the newest v2 session (by meta.startTs, journal mtime as
    // tie-break); fall back to legacy v1 files until they are migrated.
    const sessions = listV2Sessions(join(LOG_DIR, project)).filter((s) => !s.leader && !s.discard);
    if (sessions.length > 0) {
      sessions.sort((a, b) => (a.startTs < b.startTs ? 1 : a.startTs > b.startTs ? -1 : 0));
      latest = `v2:${project}/${sessions[0].sid}`; // 直接喂给 /api/local-log?file=
    } else {
      const abs = findRecentLog(join(LOG_DIR, project), project); // 已排除 *_temp.jsonl
      if (abs) latest = `${project}/${basename(abs)}`; // 相对 LOG_DIR
    }
  } catch { /* 无目录/无日志 → latest=null */ }
  res.writeHead(200, JSON_HEADERS);
  res.end(JSON.stringify({ project, latest }));
}

// 发送者身份映射（senderId → {name, avatar, ts}）：供「对话记录」按 senderId 显示真实姓名+头像。
// loopback-only：姓名/头像属个人信息，不向局域网暴露（与 config/test/process 同级）。
function imSenders(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  res.writeHead(200, JSON_HEADERS);
  res.end(JSON.stringify({ platform: id, senders: readSenders(id) }));
}

// 「模型性格定义」= 该 IM worker 工作目录下的 CC_APPEND_SYSTEM.md（启动 claude 时注入为
// --append-system-prompt-file）。loopback-only：本地文件内容、admin-only。
// 该文件仅在 worker 启动时读取一次，故保存后需重启该 IM worker 才生效（前端据此提示用户）。
// ?default=1：返回当前语言的预置文本（绕过磁盘文件），供编辑器「恢复默认」按钮加载——不落盘，由用户保存才生效。
function imAppendSystemGet(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  try {
    const def = parsedUrl?.searchParams?.get('default');
    const lang = resolvePrefLang();
    const content = (def === '1' || def === 'true') ? buildImAppendSystemPreset(id, lang) : readImAppendSystem(id, lang);
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ platform: id, content }));
  } catch (e) {
    res.writeHead(500, JSON_HEADERS);
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
}

function imAppendSystemPost(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  readBody(req, deps, (body) => {
    let incoming;
    try { incoming = JSON.parse(body); }
    catch { res.writeHead(400, JSON_HEADERS); res.end(JSON.stringify({ error: 'Invalid JSON' })); return; }
    if (typeof incoming.content !== 'string') {
      res.writeHead(400, JSON_HEADERS); res.end(JSON.stringify({ error: 'content must be a string' })); return;
    }
    if (incoming.content.length > MAX_IM_APPEND_SYSTEM_CHARS) {
      res.writeHead(413, JSON_HEADERS); res.end(JSON.stringify({ error: 'content too large' })); return;
    }
    try {
      writeImAppendSystem(id, incoming.content);
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, platform: id }));
    } catch (e) {
      res.writeHead(500, JSON_HEADERS);
      res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
  });
}

// 「${IM} SKILL 管理」= 该 IM worker 工作目录下的 .claude/skills/。loopback-only（本地文件操作、admin-only）。
// 复用 skills-api 的 listSkills/moveSkill（按 projectDir 参数化）+ skills.js 的 importSkillTo（按 skillsRoot 参数化）。
// IM worker 仅在启动时读取 skills，故增删/启停后需重启该 IM worker 才生效（前端提示用户）。
function imSkills(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  try {
    const dir = imDir(id);
    // projectDir 与 homeDir 都指向 IM 目录：两次扫描命中同一 .claude/skills（user+project 重复），
    // 过滤 source==='project' 去重并排除 plugin/builtin → 恰好是该 IM 自己的 skills(+skills-skip)。
    const skills = listSkills({ projectDir: dir, homeDir: dir }).filter((s) => s.source === 'project');
    res.writeHead(200, JSON_HEADERS);
    res.end(JSON.stringify({ platform: id, skills }));
  } catch (e) {
    res.writeHead(500, JSON_HEADERS);
    res.end(JSON.stringify({ error: String(e?.message || e) }));
  }
}

function imSkillsToggle(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  readBody(req, deps, (body) => {
    let incoming;
    try { incoming = JSON.parse(body); }
    catch { res.writeHead(400, JSON_HEADERS); res.end(JSON.stringify({ error: 'Invalid JSON' })); return; }
    try {
      moveSkill({ source: 'project', name: incoming.name, enable: !!incoming.enable, projectDir: imDir(id) });
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      const statusMap = { INVALID_NAME: 400, INVALID_SOURCE: 400, PATH_ESCAPE: 400, SYMLINK: 400, SOURCE_MISSING: 404, DUPLICATE: 409 };
      const status = statusMap[err?.code] || 500;
      res.writeHead(status, JSON_HEADERS);
      res.end(JSON.stringify({ error: err?.message || 'internal_error', code: err?.code || 'unknown' }));
    }
  });
}

function imSkillsDelete(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  readBody(req, deps, (body) => {
    let incoming;
    try { incoming = JSON.parse(body); }
    catch { res.writeHead(400, JSON_HEADERS); res.end(JSON.stringify({ error: 'Invalid JSON' })); return; }
    try {
      deleteSkill({ source: 'project', name: incoming.name, enabled: !!incoming.enabled, projectDir: imDir(id) });
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      const statusMap = { INVALID_NAME: 400, INVALID_SOURCE: 400, PATH_ESCAPE: 400, SYMLINK: 400, NOT_FOUND: 404 };
      const status = statusMap[err?.code] || 500;
      res.writeHead(status, JSON_HEADERS);
      res.end(JSON.stringify({ error: err?.message || 'internal_error', code: err?.code || 'unknown' }));
    }
  });
}

function imSkillsImport(req, res, parsedUrl, isLocal, deps) {
  const id = platformOf(parsedUrl.pathname);
  if (!id) { notFound(res); return; }
  if (!isLocal) { loopbackOnly(res); return; }
  importSkillTo(req, res, { skillsRoot: join(imDir(id), '.claude', 'skills'), windowsReserved: deps.WINDOWS_RESERVED_NAMES });
}

export const imRoutes = [
  { predicate: imPredicate('status', 'GET'), handler: imStatus },
  { predicate: imPredicate('config', 'POST'), handler: imConfigPost },
  { predicate: imPredicate('test', 'POST'), handler: imTestPost },
  { predicate: imPredicate('process', 'POST'), handler: imProcessPost },
  { predicate: imPredicate('logs', 'GET'), handler: imLogs },
  { predicate: imPredicate('senders', 'GET'), handler: imSenders },
  { predicate: imPredicate('append-system', 'GET'), handler: imAppendSystemGet },
  { predicate: imPredicate('append-system', 'POST'), handler: imAppendSystemPost },
  { predicate: imPredicate('skills', 'GET'), handler: imSkills },
  { predicate: imPredicate('skills/toggle', 'POST'), handler: imSkillsToggle },
  { predicate: imPredicate('skills/delete', 'POST'), handler: imSkillsDelete },
  { predicate: imPredicate('skills/import', 'POST'), handler: imSkillsImport },
];
