// Generic IM bridge orchestrator — platform-agnostic glue between one bound Claude Code PTY
// session and N IM platform adapters (DingTalk, Feishu, …).
//
// Inbound  (IM → session): adapter normalizes its platform event → onInbound(normalized, ackCtx)
//   → ack immediately → msgId dedup → access control → /stop interrupt OR inject the text as a
//   prompt (bracketed paste, ⟦im:<id>⟧ origin marker).
// Outbound (session → IM): on the debounced turn_end, read the Claude session transcript JSONL
//   (path forwarded from the Stop hook), assemble the last main-agent text turn, chunk it, and
//   push via the owning adapter's sendOne.
//
// SINGLE SHARED PTY ⇒ SINGLE-FLIGHT INJECTION. Only one adapter may have an injected turn in
// flight at a time (`activeInjection`, a core-global). It replaces the per-adapter pendingReply:
// one source of truth. notifyTurnEnd routes the reply solely to the owner; the slot releases on
// every terminal path (turn-end reply / /stop / inject-failure / timeout) and the release kicks
// ALL adapters' drains so a second platform's queued prompt can proceed.
//
// Design notes:
// - This module NEVER imports pty-manager / server.js. All PTY access + the streaming-busy probe
//   are injected per platform via `deps`, so unit tests mock them with zero node-pty / network.
// - Adapters get a `ctx` ({ fetch, store }) — `fetch` is the shared test-seam'd fetch; `store` is
//   a per-instance scratch object (token cache, send client) cleared on reset.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_DIR } from '../../findcc.js';
import { t } from '../i18n.js';
import { upsertSender } from './im-senders.js';

// ─── tunables (shared across platforms; per-platform rate caps come from adapter.rateLimit) ───
const SEEN_MAX = 500;
const RATE_WINDOW_MS = 60_000;
const MAX_CHUNKS_PER_TURN = 5;
const MAX_QUEUE = 50;                    // cap inbound backlog so an authorized sender can't grow it unbounded
const PENDING_TIMEOUT_MS = process.env.CCV_IM_PLATFORM ? 2 * 60_000 : 10 * 60_000;
const IDLE_POLL_INTERVAL_MS = 5_000;     // check every 5s if streaming stopped
const IDLE_POLL_THRESHOLD = 3;           // 3 consecutive idle ticks (15s) → synthetic turn_end
const CONNECT_TIMEOUT_MS = 15_000;       // bound adapter.connect() so a hung start can't block others
const STOP_WORDS = new Set(['/stop', 'stop', '停止', 'esc', '/esc']);
// ─── 逐字流式（钉钉 AI 卡片）推送节流：每帧计费，故节流 + 帧上限 ───
// 推送轮询间隔。300ms：数秒级回复约展示 10 帧打字机效果；过大→短/秒回回复在首 tick 前就 finalize、
// 看不到流式；过小→帧数与计费上升，且建卡本身有网络往返、再低收益有限。测试经 __setStreamTickMsForTests 调低。
let STREAM_TICK_MS = 300;
const STREAM_MIN_DELTA = 20;             // 累计增长达 20 字才推一帧（对齐钉钉官方节流，省调用）
const STREAM_MAX_FRAMES = 25;            // 每回合中途流式帧硬上限；超限停推，finalize 仍落全文
const STREAM_MAX_CHARS = 20_000;         // 卡片内容字符上限，超出截断

// Poll interval for adapters that expose connectionProbe() instead of lifecycle events
// (dingtalk-stream replaces its internal ws on every reconnect, so no listener survives).
let CONN_POLL_MS = 5_000;

// ─── registry + core-global single-flight ───
const instances = new Map();             // platformId → instance
let activeInjection = null;              // { platformId, since, target } — the one in-flight turn
let activeInjectionTimer = null;         // self-heal timer if a turn_end never arrives
let idlePollTimer = null;               // secondary idle detection (IM worker only)
let idlePollCount = 0;                  // consecutive ticks where isStreaming() is false
let fetchImpl = null;                    // shared test seam

// ─── test seams ───
export function __setFetchForTests(fn) { fetchImpl = fn; }
export function coreFetch(...args) { return (fetchImpl || globalThis.fetch)(...args); }

function newInstance(adapter) {
  return {
    adapter,
    client: null,
    running: false,
    connected: false,
    connectionState: 'disconnected',      // 'connected' | 'reconnecting' | 'disconnected'; invariant: connected === (connectionState === 'connected')
    startGen: 0,                          // generation counter; stale adapter listeners from a previous start are ignored
    connPollTimer: null,                  // fallback poll timer for adapters exposing connectionProbe()
    lastError: null,
    bridgeDeps: null,
    boundConversation: null,
    lastRepliedTurnTs: null,
    maxQueueOverride: null,
    seenMsgIds: [],
    queue: [],
    sendTimes: [],
    store: {},                           // adapter scratch (token cache, send client)
    ackCardPromise: null,                 // Promise<handle|null> for the in-flight ack card
    streamTimer: null,                    // 逐字流式推送定时器（AI 卡片）；绑当前注入 slot 生命周期
  };
}

/**
 * The contract every platform adapter under server/lib/adapters/ must satisfy. The core owns all
 * generic orchestration (dedup, access control, queue, single-flight inject, chunk, turn-end
 * reply); an adapter only knows its platform's transport, payload shape, and send.
 *
 * @typedef {Object} ImAdapter
 * @property {string}  id            Platform id, also the preferences.json key (e.g. 'dingtalk').
 * @property {string}  i18nNs        i18n namespace for the core's user-facing replies (e.g. 'server.feishu').
 * @property {string}  allowListField  Config key holding the sender allowlist (e.g. 'allowStaffIds').
 * @property {{max:number,windowMs:number}} [rateLimit]  Per-platform outbound cap (defaults 18/60s).
 * @property {Object}  [capabilities]  Informational flags ({inboundAck, sdkManagesToken}); not read by the core.
 * @property {(cfg:Object)=>boolean}  hasCreds        True when cfg carries enough creds to connect.
 * @property {(cfg:Object)=>Object}   [statusFields]  Extra non-secret status fields for the admin API.
 * @property {(cfg:Object, hooks:{onInbound:(normalized:Object, ackCtx:*)=>void, onConnectionChange?:(state:?string, err?:*)=>void}, ctx:{fetch,store})=>Promise<*>} connect
 *           Open the long connection; return the live client. Call hooks.onInbound(normalized, ackCtx)
 *           per inbound message, where normalized = {text, conversationId, senderId, msgId, target}.
 *           Optionally call hooks.onConnectionChange?.(state, err) on transport lifecycle changes,
 *           where state ∈ 'connected'|'reconnecting'|'disconnected', or null to record err only.
 *           Always invoke it with optional chaining — callers (tests) may pass onInbound alone.
 * @property {(client:*)=>('connected'|'reconnecting'|'disconnected')} [connectionProbe]
 *           For SDKs without usable lifecycle events: derive the live connection state from the
 *           client's fields. When present, the core polls it every CONN_POLL_MS while running.
 * @property {(client:*, ctx:{fetch,store})=>Promise<void>} [disconnect]  Tear down the client (best-effort).
 * @property {(ackCtx:*, client:*)=>void} [ack]  Ack an inbound msg (platforms that redeliver if not acked).
 * @property {(cfg:Object, target:Object, content:string, ctx:{fetch,store})=>Promise<void>} sendOne  Send one chunk.
 * @property {(cfg:Object, ctx:{fetch,store})=>Promise<{ok:boolean, detail?:string}>} testConnection  Validate creds, no socket.
 *
 * ── Optional AI-card streaming (only platforms that support an updatable card implement these) ──
 * @property {(cfg:Object)=>boolean} [streamEnabled]  Whether per-character streaming is on for this cfg.
 *           When absent the core falls back to `!!cfg.aiCardTemplateId` (DingTalk's template-id switch).
 * @property {(cfg:Object, target:Object, statusText:string, ctx:Object)=>Promise<?Object>} [sendAckCard]
 *           Send the instant ack as an (ideally streamable) card; return a handle ({streaming:true,…})
 *           to enable streaming, a non-streaming handle, or null to fall back to a plain-text ack.
 * @property {(cfg:Object, target:Object, handle:Object, fullText:string, ctx:Object)=>Promise<boolean>} [streamCardText]
 *           Push the cumulative reply text into the card (best-effort; drives the typewriter effect).
 * @property {(cfg:Object, target:Object, handle:Object, fullText:string, status:string, ctx:Object)=>Promise<boolean>} [updateAckCard]
 *           Finalize the card with the authoritative reply text + terminal status (done/interrupted/error).
 */

/** Register a platform adapter (called at adapter-module import). Idempotent per id. */
export function registerAdapter(adapter) {
  if (!instances.has(adapter.id)) instances.set(adapter.id, newInstance(adapter));
  return instances.get(adapter.id);
}

function ctxFor(inst) {
  return { fetch: coreFetch, store: inst.store };
}

// 发送者身份解析的缓存有效期：同一 senderId 在此窗口内只解析一次（避免每条消息打 contact API）。
const SENDER_RESOLVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 负缓存有效期：解析「没拿到任何身份」（外部用户 / 无 scope / API 失败）也要短期记一笔，否则像飞书这种
// 无免费字段、靠 contact API 的平台会对每条消息重复打 API（触发租户限流）。10min 后再重试，兼顾「拿到瞬时失败可恢复」。
const SENDER_NEG_TTL_MS = 10 * 60 * 1000;

/**
 * 后台解析发送者 {name, avatar} 并持久化到 IM_<id>/im-senders.json（供 /senders 路由 + 对话记录展示）。
 * 优先用 normalizeInbound 免费带出的 senderName/senderAvatar；缺失再调可选的 adapter.resolveSender
 * （需打 contact API 的平台）。整段静默：任何失败都不得影响消息注入。**调用方必须 void（不 await）。**
 */
async function resolveAndPersistSender(inst, senderId, normalized) {
  if (!senderId) return;
  const store = inst.store || (inst.store = {});
  const cache = store.senderCache || (store.senderCache = {});
  const now = Date.now();
  // 缓存项形如 { ts, ok }：解析成功用 7d TTL，负缓存（没拿到）用 10min TTL。
  const c = cache[senderId];
  if (c && (now - c.ts) < (c.ok ? SENDER_RESOLVE_TTL_MS : SENDER_NEG_TTL_MS)) return;
  try {
    let name = normalized.senderName != null ? String(normalized.senderName) : null;
    let avatar = normalized.senderAvatar != null ? String(normalized.senderAvatar) : null;
    // 免费字段不全且适配器支持 → 调一次 contact API 补齐（仅 feishu；dingtalk/wecom 无 resolveSender）。
    let attemptedResolve = false;
    if ((!name || !avatar) && typeof inst.adapter.resolveSender === 'function') {
      attemptedResolve = true;
      const r = await inst.adapter.resolveSender(inst.bridgeDeps.getConfig(), senderId, ctxFor(inst));
      if (r) {
        if (!name && r.name != null) name = String(r.name);
        if (!avatar && r.avatar != null) avatar = String(r.avatar);
      }
    }
    if (name || avatar) {
      upsertSender(inst.adapter.id, senderId, { name, avatar });
      cache[senderId] = { ts: now, ok: true };
    } else if (attemptedResolve) {
      // 调过 contact API 但什么都没拿到 → 负缓存，避免对该发送者每条消息反复打 API。
      cache[senderId] = { ts: now, ok: false };
    }
  } catch (e) {
    cache[senderId] = { ts: now, ok: false }; // 失败也负缓存（短 TTL，10min 后自动重试）
    audit(inst, 'resolve-sender-error', { senderId, error: String(e?.message || e) });
  }
}

function queueCap(inst) {
  return inst.maxQueueOverride ?? MAX_QUEUE;
}

/**
 * Await the in-flight ack card promise, update it with terminal text/status, and null
 * the promise on `inst`. Returns true if the card was successfully updated. Best-effort:
 * never throws, never blocks the slot release.
 */
async function finalizeAckCard(inst, target, text, status) {
  try {
    const handle = await inst.ackCardPromise?.catch(() => null);
    inst.ackCardPromise = null;
    if (handle && typeof inst.adapter.updateAckCard === 'function') {
      const cfg = inst.bridgeDeps?.getConfig();
      if (cfg) return !!(await inst.adapter.updateAckCard(cfg, target, handle, text, status, ctxFor(inst)).catch(() => false));
    }
  } catch { /* best-effort */ }
  inst.ackCardPromise = null;
  return false;
}

// ─── activeInjection lifecycle ───
function clearActiveInjection() {
  // 先停掉持有 slot 的实例的逐字流式定时器（slot 释放的每条路径都经此：turn-end / /stop / 超时 /
  // inject-fail / stopBridge），杜绝定时器泄漏与 finalize 后的乱序推送。
  if (activeInjection) {
    const owner = instances.get(activeInjection.platformId);
    if (owner && owner.streamTimer) { clearInterval(owner.streamTimer); owner.streamTimer = null; }
  }
  activeInjection = null;
  if (activeInjectionTimer) { clearTimeout(activeInjectionTimer); activeInjectionTimer = null; }
  if (idlePollTimer) { clearInterval(idlePollTimer); idlePollTimer = null; }
  idlePollCount = 0;
}

// slot 仍属本次注入？streamTick 入口与每次 await 后都要重验——slot 可能在 await 期间被 finalize/释放，
// 重验保证 finalize 永远是最后一次 PUT、定时器也不在易主后继续推。
function isSlotOwned(inst, since) {
  return !!activeInjection && activeInjection.platformId === inst.adapter.id && activeInjection.since === since;
}

/**
 * 逐字流式推送一帧（钉钉 AI 卡片）。常驻 setInterval 驱动，贯穿本注入 slot 生命周期——**不**随
 * isStreaming() 抖动停（带工具的回合中间 streamingState 每个 API 调用会 false↔true，停了就断流）。
 * 全程 best-effort：任何失败都不影响最终 finalize（notifyTurnEnd 用 transcript 权威全文落定）。
 */
async function streamTick(inst, since) {
  // slot 已释放/易主 → 自停（定时器自清）
  if (!isSlotOwned(inst, since)) {
    if (inst.streamTimer) { clearInterval(inst.streamTimer); inst.streamTimer = null; }
    return;
  }
  if (inst._streamInFlight) return;          // 单 in-flight：避免乱序 PUT（钉钉靠 guid 排序）
  if (inst._streamHandle === null) return;   // 已判定不可流式（无句柄 / 非 AI 卡片）
  const d = inst.bridgeDeps;
  if (!d || typeof d.getLiveText !== 'function') return;
  // 解析一次 ack 卡片句柄并缓存：null/非流式 → 永久关停本轮推送，不再每 tick 重复 await。
  if (inst._streamHandle === undefined) {
    inst._streamHandle = (await inst.ackCardPromise?.catch(() => null)) ?? null;
    // 落审计便于诊断：streaming=false 说明 AI 卡片建卡失败/回退 legacy（aiErr 给出钉钉返回的原因）；
    // liveLen=0 说明文本源没采到（多半 mainAgent 判定或采集开关问题）。
    audit(inst, 'stream-handle', { streaming: !!inst._streamHandle?.streaming, liveLen: (d.getLiveText?.() || '').length, aiErr: inst.store?.lastAiCardError || undefined });
    if (!inst._streamHandle?.streaming) { inst._streamHandle = null; return; }
  }
  if (inst._streamFrames >= STREAM_MAX_FRAMES) return; // 计费上限：停中途推送，finalize 仍落全文
  let text = d.getLiveText();
  if (typeof text !== 'string') return;
  if (text.length > STREAM_MAX_CHARS) text = text.slice(0, STREAM_MAX_CHARS);
  if (text.length - (inst._streamPushedLen || 0) < STREAM_MIN_DELTA) return; // 增长不足，省调用
  inst._streamInFlight = true;
  const target = activeInjection.target;
  const cfg = d.getConfig();
  const ok = await inst.adapter.streamCardText(cfg, target, inst._streamHandle, text, ctxFor(inst)).catch(() => false);
  inst._streamInFlight = false;
  // await 后重新校验 slot：期间可能已 finalize/释放 → 本帧作废，不计数（保证 finalize 是最后一次 PUT）。
  if (!isSlotOwned(inst, since)) return;
  // 落审计：ok=false 说明 /card/streaming 被拒（多半 Card.Streaming.Write 权限缺失）；ok=true 却看不到
  // 流式则多半是 AI 卡片模板里流式变量名不叫 content（见 streamFrame 的 key）。
  audit(inst, 'stream-push', { len: text.length, ok });
  if (ok) {
    inst._streamPushedLen = text.length;
    inst._streamFrames = (inst._streamFrames || 0) + 1;
    if (inst._streamFrames === STREAM_MAX_FRAMES) audit(inst, 'stream-frame-cap', { conversationId: target?.conversationId, frames: inst._streamFrames });
    idlePollCount = 0; // 有流式活动 → 重置空闲计数，避免 idlePoll 误判触发合成 turn_end
  }
}
function armActiveInjection(inst, target, since) {
  activeInjection = { platformId: inst.adapter.id, since, target, transcriptPath: null };
  if (activeInjectionTimer) clearTimeout(activeInjectionTimer);
  activeInjectionTimer = setTimeout(async () => {
    // Only fire if THIS injection still owns the slot (symmetry with the inject-failure guard).
    if (!activeInjection || activeInjection.since !== since) return;
    audit(inst, 'reply-timeout', { conversationId: target?.conversationId });
    const cardUpdated = await finalizeAckCard(inst, target, tr(inst, 'ackTimeout'), 'error');
    if (!activeInjection || activeInjection.since !== since) return;
    clearActiveInjection();
    if (!cardUpdated) void sendReply(inst, target, tr(inst, 'ackTimeout'));
    drainAll();                          // …and let any platform's queue proceed
  }, PENDING_TIMEOUT_MS);
  if (typeof activeInjectionTimer.unref === 'function') activeInjectionTimer.unref();
  // Secondary idle detection: poll isStreaming() to catch missed Stop hook events.
  if (idlePollTimer) clearInterval(idlePollTimer);
  idlePollCount = 0;
  let sawStreaming = false;
  idlePollTimer = setInterval(() => {
    if (!activeInjection || activeInjection.since !== since) { clearInterval(idlePollTimer); idlePollTimer = null; return; }
    const d = inst.bridgeDeps;
    if (!d) return;
    if (d.isStreaming()) { sawStreaming = true; idlePollCount = 0; return; }
    if (!sawStreaming) return; // haven't seen streaming start yet — don't count idle
    idlePollCount++;
    if (idlePollCount >= IDLE_POLL_THRESHOLD) {
      clearInterval(idlePollTimer); idlePollTimer = null;
      audit(inst, 'idle-turn-end', { conversationId: target?.conversationId, idleSeconds: idlePollCount * IDLE_POLL_INTERVAL_MS / 1000 });
      notifyTurnEnd(null, since, activeInjection?.transcriptPath || null);
    }
  }, IDLE_POLL_INTERVAL_MS);
  if (typeof idlePollTimer.unref === 'function') idlePollTimer.unref();

  // 逐字流式（钉钉 AI 卡片）：仅当配了 aiCardTemplateId、开了 ack 卡片、且平台具备流式能力（worker
  // 注入了 getLiveText + 适配器实现 streamCardText）时启动常驻推送定时器。注入轮次开始即重置文本源。
  const cfg = inst.bridgeDeps?.getConfig?.();
  // 流式总开关：钉钉用专属 aiCardTemplateId（非空即开）；其它平台(飞书/微信)无模板 id，改由适配器
  // 自报 streamEnabled(cfg)（通常 !!cfg.aiCard）。适配器未定义 → 回落旧逻辑，钉钉零回归。
  const streamEnabled = !!cfg && (typeof inst.adapter.streamEnabled === 'function'
    ? !!inst.adapter.streamEnabled(cfg)
    : !!cfg.aiCardTemplateId);
  if (streamEnabled) {
    const canStream = cfg.ackCard !== false
      && typeof inst.bridgeDeps.getLiveText === 'function'
      && typeof inst.adapter.streamCardText === 'function'
      // 同时要求 updateAckCard：能逐字推却无法 finalize 会让卡片永远停在流式中途、停在「生成中」。
      && typeof inst.adapter.updateAckCard === 'function';
    if (canStream) {
      inst.bridgeDeps.resetLiveText?.();
      if (inst.store) inst.store.lastAiCardError = null; // 清上一轮的诊断残留
      inst._streamPushedLen = 0;
      inst._streamFrames = 0;
      inst._streamHandle = undefined; // 首 tick 解析一次后缓存（null = 不可流式）
      inst._streamInFlight = false;
      if (inst.streamTimer) clearInterval(inst.streamTimer);
      inst.streamTimer = setInterval(() => { void streamTick(inst, since); }, STREAM_TICK_MS);
      if (typeof inst.streamTimer.unref === 'function') inst.streamTimer.unref();
      audit(inst, 'stream-armed', { conversationId: target?.conversationId });
    } else {
      // 配了 aiCardTemplateId 却没起流式：把原因落审计，便于诊断「没有流式输出」。
      audit(inst, 'stream-skip', {
        reason: cfg.ackCard === false ? 'ackCardOff'
          : typeof inst.bridgeDeps?.getLiveText !== 'function' ? 'noGetLiveText(非 worker?)'
            : typeof inst.adapter.streamCardText !== 'function' ? 'noStreamCardText'
              : 'noUpdateAckCard',
      });
    }
  }
}

/**
 * Transition the tri-state connection status. `gen` binds the caller to one startBridge lifetime,
 * so a stale adapter listener firing after stopBridge/reloadBridge can never flip the state.
 * state === null records the error only; identical consecutive states are no-ops (collapses
 * SDK error/reconnect storms into single audited transitions).
 */
function setConnectionState(inst, gen, state, err) {
  if (gen !== inst.startGen || !inst.running) return;
  const errStr = err != null ? String(err?.message || err) : null;
  if (errStr) inst.lastError = errStr;
  if (state == null || state === inst.connectionState) return;
  inst.connectionState = state;
  inst.connected = state === 'connected';
  // Recovery clears the retained disconnect cause — the UI ranks lastError above connected, so
  // keeping it would leave the status stuck on "Error" after every transient drop. Deduped
  // repeats and null-state calls don't clear, preserving send-failure diagnostics while healthy.
  if (state === 'connected' && !errStr) inst.lastError = null;
  audit(inst, 'connection', { state, ...(errStr ? { error: errStr } : {}) });
}

// ─── small helpers ───
function audit(inst, event, data) {
  try {
    appendFileSync(join(LOG_DIR, `${inst.adapter.id}-audit.log`),
      JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + '\n');
  } catch { /* best-effort */ }
}

/** Bracketed-paste + submit, matching the frontend's ptyChunkBuilder. Kept local so the core
 *  never imports pty-manager (which would pull node-pty into the unit test). */
function bracketPasteSubmit(text) {
  return ['\x1b[200~' + text + '\x1b[201~', '\r'];
}

/** Prepend the IM-origin marker `⟦im:<id>⟧` or `⟦im:<id>:<senderId>⟧`, EXCEPT for slash commands
 *  (a marker prefix would stop the CLI from recognizing `/clear` etc.). trim() guards leading
 *  whitespace / full-width spaces. senderId is embedded only when it's "safe" (no space / `:` / `⟧`)
 *  so the marker stays unambiguous; otherwise it degrades to the platform-only form.
 *  KEEP IN SYNC with IM_ORIGIN_RE in src/utils/imOrigin.js. */
function markOrigin(id, senderId, content) {
  if (content.trim().startsWith('/')) return content;
  const safe = (typeof senderId === 'string' && /^[^\s:⟧]+$/.test(senderId)) ? `:${senderId}` : '';
  return `⟦im:${id}${safe}⟧` + content;
}

/**
 * Strip the bracketed-paste terminator/initiator and all C0 control bytes (except newline and
 * tab) from untrusted inbound text. Without this, a crafted message containing `\x1b[201~` (or
 * other ESC sequences) would break out of the paste frame and inject raw keystrokes into the
 * Claude TUI. CR is removed too: it is the submit key, so leaving it in inbound text would be a
 * submit byte smuggled into the paste frame.
 */
function sanitizeInbound(text) {
  return String(text)
    .replace(/\x1b\[20[01]~/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

function remember(inst, msgId) {
  if (!msgId) return false;
  if (inst.seenMsgIds.includes(msgId)) return true;
  inst.seenMsgIds.push(msgId);
  if (inst.seenMsgIds.length > SEEN_MAX) inst.seenMsgIds.shift();
  return false;
}

function isStopCommand(text) {
  return STOP_WORDS.has(text.trim().toLowerCase());
}

function tr(inst, key, params) {
  return t(`${inst.adapter.i18nNs}.${key}`, params);
}

// ─── transcript extraction (the safe outbound text source) ───
function parseLine(line) {
  try { const o = JSON.parse(line); return o && typeof o === 'object' ? o : null; }
  catch { return null; }
}

function isRealUserPrompt(obj) {
  const c = obj.message?.content;
  if (typeof c === 'string') return c.trim().length > 0;
  if (Array.isArray(c)) return c.some(b => b && b.type !== 'tool_result'); // tool_result-only = continuation
  return false;
}

/**
 * Read the LAST main-agent text turn from a Claude Code transcript JSONL. Walks backward from
 * EOF, collecting contiguous assistant `text` blocks, stopping at the previous real user prompt.
 * Skips thinking/tool_use blocks, sidechain (subagent) entries, and non-message sidecar lines.
 */
export function extractLastAssistantText(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  let lines;
  try { lines = readFileSync(transcriptPath, 'utf-8').split('\n'); }
  catch { return ''; }
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    const obj = parseLine(line);
    if (!obj || !obj.type) continue;
    if (obj.type === 'assistant') {
      if (obj.isSidechain) continue;
      const content = obj.message?.content;
      if (Array.isArray(content)) {
        const txt = content.filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
        if (txt) parts.unshift(txt);
      }
      continue;
    }
    if (obj.type === 'user') {
      if (obj.isSidechain) continue;    // subagent prompt — not the main-agent turn boundary
      if (isRealUserPrompt(obj)) break; // start of this turn — stop
      continue;                         // tool_result continuation — keep scanning
    }
    // system / summary / file-history-snapshot / metadata sidecars → skip
  }
  return parts.join('\n\n').trim();
}

// ─── chunking + rate limiting ───
export function chunkText(text, max) {
  if (!text) return [];
  if (text.length <= max) return [text];
  const chunks = [];
  let buf = '';
  for (const seg of text.split(/(\n\n)/)) {
    if ((buf + seg).length <= max) { buf += seg; continue; }
    if (buf) { chunks.push(buf); buf = ''; }
    if (seg.length > max) {
      let rest = seg;
      while (rest.length > max) {
        let cut = rest.lastIndexOf('\n', max);
        if (cut <= 0) cut = rest.lastIndexOf(' ', max);
        if (cut <= 0) cut = max;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      buf = rest;
    } else {
      buf = seg;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.map(c => c.trim()).filter(Boolean);
}

async function rateLimitGate(inst) {
  const max = inst.adapter.rateLimit?.max ?? 18;
  const windowMs = inst.adapter.rateLimit?.windowMs ?? RATE_WINDOW_MS;
  const now = Date.now();
  while (inst.sendTimes.length && now - inst.sendTimes[0] > windowMs) inst.sendTimes.shift();
  if (inst.sendTimes.length >= max) {
    const wait = windowMs - (now - inst.sendTimes[0]) + 50;
    await new Promise(r => setTimeout(r, wait));
    return rateLimitGate(inst);
  }
  inst.sendTimes.push(Date.now());
}

async function sendReply(inst, target, text) {
  const cfg = inst.bridgeDeps.getConfig();
  let chunks = chunkText(text, cfg.maxChunkChars);
  if (chunks.length > MAX_CHUNKS_PER_TURN) {
    chunks = chunks.slice(0, MAX_CHUNKS_PER_TURN);
    chunks[MAX_CHUNKS_PER_TURN - 1] += '\n\n' + tr(inst, 'truncated');
  }
  for (const c of chunks) {
    try {
      await rateLimitGate(inst);
      await inst.adapter.sendOne(cfg, target, c, ctxFor(inst));
    } catch (e) {
      inst.lastError = String(e?.message || e);
      audit(inst, 'send-error', { error: inst.lastError });
      break;
    }
  }
  audit(inst, 'out', { conversationId: target.conversationId, chunks: chunks.length });
}

// ─── inbound ───
function handleInbound(inst, normalized, ackCtx) {
  // ACK first: some platforms (DingTalk) redeliver if not acked within ~5-15s.
  try { inst.adapter.ack?.(ackCtx, inst.client); } catch { /* best-effort; dedup catches a redelivery */ }
  try { handleInboundInner(inst, normalized); }
  catch (e) { audit(inst, 'inbound-error', { error: String(e?.message || e) }); }
}

function handleInboundInner(inst, normalized) {
  if (!normalized) return;
  const msgId = normalized.msgId;
  if (remember(inst, msgId)) return; // redelivery

  const text = sanitizeInbound(normalized.text ?? '').trim();
  const conversationId = normalized.conversationId;
  const senderId = normalized.senderId;
  const target = normalized.target;
  const cfg = inst.bridgeDeps.getConfig();
  const allowList = cfg[inst.adapter.allowListField] || [];

  // access control: allowlist (if any) else bind-first-conversation
  if (allowList.length > 0) {
    if (!allowList.includes(senderId)) {
      audit(inst, 'reject-sender', { senderId, conversationId });
      void sendReply(inst, target, tr(inst, 'notAuthorized'));
      return;
    }
  } else if (!inst.boundConversation) {
    inst.boundConversation = { conversationId };
    audit(inst, 'bind', { conversationId });
  } else if (conversationId !== inst.boundConversation.conversationId) {
    audit(inst, 'reject-conversation', { conversationId });
    void sendReply(inst, target, tr(inst, 'notBound'));
    return;
  }

  audit(inst, 'in', { msgId, senderId, conversationId, len: text.length });
  // 后台解析并持久化发送者身份（姓名/头像）供「对话记录」展示。fire-and-forget：
  // 绝不 await（解析可能要打 contact API），不阻塞/不影响下面的消息注入。
  void resolveAndPersistSender(inst, senderId, normalized);
  if (!text) return; // non-text messages (image/voice/file) are ignored in v1

  if (isStopCommand(text)) {
    inst.bridgeDeps.writeToPty('\x1b'); // ESC interrupts the current turn (NOT killPty)
    audit(inst, 'stop', { conversationId });
    const stoppedInst = activeInjection ? instances.get(activeInjection.platformId) : null;
    const stoppedTarget = activeInjection?.target;
    if (stoppedInst && stoppedTarget) {
      void finalizeAckCard(stoppedInst, stoppedTarget, tr(stoppedInst, 'interrupted'), 'interrupted');
    }
    // ESC interrupts whatever turn is live on the shared PTY (possibly another platform's), which
    // may mean its turn_end never fires. Release the global slot and resume all queues so /stop
    // can never wedge the bridge.
    clearActiveInjection();
    void sendReply(inst, target, tr(inst, 'interrupted'));
    drainAll();
    return;
  }

  if (inst.queue.length >= queueCap(inst)) {
    audit(inst, 'queue-full', { conversationId, queued: inst.queue.length });
    void sendReply(inst, target, tr(inst, 'queueFull', { max: String(queueCap(inst)) }));
    return;
  }
  inst.queue.push({ ...target, senderId, content: text });
  if (activeInjection || inst.bridgeDeps.isStreaming()) {
    const ahead = inst.queue.length - 1;
    void sendReply(inst, target, tr(inst, 'busyQueued', { ahead: String(ahead), max: String(queueCap(inst)) }));
  }
  drainQueue(inst);
}

function drainQueue(inst) {
  const d = inst.bridgeDeps;
  if (!d) return;
  while (inst.queue.length) {
    if (activeInjection || d.isStreaming()) return; // a turn is in flight (any platform)
    const item = inst.queue[0];
    const st = d.getPtyState();
    if (!st.running || d.getPtyKind() !== 'claude') {
      inst.queue.shift();
      void sendReply(inst, item, tr(inst, 'noSession'));
      continue;
    }
    inst.queue.shift();
    const cfg = d.getConfig();
    const skipPerm = d.getPtySkipPermissions();
    // 独立 IM worker 模型下，worker 本就以 --dangerously-skip-permissions 自主运行（安全由
    // 强制 allowlist + PreToolUse 硬拦截 + 注入的 permissions.deny 保证）。因此对 IM worker：
    //   - 不应用 blockOnSkipPermissions（否则 skipPerm 恒真 → 拦下每条消息让机器人彻底失能，
    //     尤其坑迁移用户：旧设置里若开了此项，升级后机器人将完全不回复）；
    //   - 不再逐条发送 skip-perm 警告（worker 恒为 skip-perm，逐条警告纯噪声）。
    // 仅在非 worker 场景保留旧硬阻/告警语义（防御性；新模型下适配器只在 worker 内运行）。
    const isImWorker = !!process.env.CCV_IM_PLATFORM;
    if (!isImWorker && skipPerm && cfg.blockOnSkipPermissions) {
      audit(inst, 'skip-perm-blocked', { conversationId: item.conversationId });
      void sendReply(inst, item, tr(inst, 'skipPermBlocked'));
      continue; // not armed, not injected — move to the next queued prompt
    }
    const since = Date.now();
    armActiveInjection(inst, item, since);
    // Instant ack: fire-and-forget so writeToPtySequential is never delayed.
    if (cfg.ackCard !== false && typeof inst.adapter.sendAckCard === 'function') {
      const ackTarget = item;
      inst.ackCardPromise = inst.adapter.sendAckCard(cfg, item, tr(inst, 'ackProcessing'), ctxFor(inst))
        .then((handle) => { if (!handle) void sendReply(inst, ackTarget, tr(inst, 'ackProcessing')); return handle; })
        .catch((e) => { audit(inst, 'ack-card-error', { error: String(e?.message || e) }); void sendReply(inst, ackTarget, tr(inst, 'ackProcessing')); return null; });
    } else if (cfg.ackCard !== false) {
      void sendReply(inst, item, tr(inst, 'ackProcessing'));
      inst.ackCardPromise = null;
    } else {
      inst.ackCardPromise = null;
    }
    if (!isImWorker && skipPerm && cfg.ackCard === false) {
      audit(inst, 'skip-perm-warning', { conversationId: item.conversationId });
      void sendReply(inst, item, tr(inst, 'skipPermWarning'));
    }
    // React to a failed injection (PTY gone/died mid-write → onComplete(false)). Without this the
    // prompt never submits, no turn_end ever comes, and the slot wedges until the timeout. Only
    // act if THIS injection still owns the slot (a /stop or timeout may have released it).
    d.writeToPtySequential(bracketPasteSubmit(markOrigin(inst.adapter.id, item.senderId, item.content)), (ok) => {
      if (ok) return;
      if (!activeInjection || activeInjection.platformId !== inst.adapter.id || activeInjection.since !== since) return;
      audit(inst, 'inject-failed', { conversationId: item.conversationId });
      void (async () => {
        const cardUpdated = await finalizeAckCard(inst, item, tr(inst, 'injectFailed'), 'error');
        if (!activeInjection || activeInjection.platformId !== inst.adapter.id || activeInjection.since !== since) return;
        clearActiveInjection();
        if (!cardUpdated) void sendReply(inst, item, tr(inst, 'injectFailed'));
        drainAll();
      })().catch(() => {});
    }, { settleMs: 250 });
    return; // one at a time; resume on the next turn_end
  }
}

/** Resume every platform's queue (used after the in-flight slot is released). */
function drainAll() {
  for (const inst of instances.values()) {
    if (inst.running) drainQueue(inst);
  }
}

// ─── outbound trigger (called from server.js _emitTurnEnd) ───
export async function notifyTurnEnd(sessionId, ts, transcriptPath) {
  if (transcriptPath && activeInjection) activeInjection.transcriptPath = transcriptPath;
  if (!activeInjection) { drainAll(); return; } // only reply to turns a bridge initiated
  const inst = instances.get(activeInjection.platformId);
  if (!inst) { clearActiveInjection(); drainAll(); return; }
  // A turn_end whose turn ended before we injected belongs to an earlier (e.g. local) turn, not
  // ours — don't consume our slot or leak that turn's text. (Narrow window; full per-turn
  // correlation is a v2 item.)
  if (ts && activeInjection.since && ts < activeInjection.since) { drainAll(); return; }
  const target = activeInjection.target;
  // Grab the ack card promise before clearing state.
  const ackP = inst.ackCardPromise;
  inst.ackCardPromise = null;
  clearActiveInjection();
  // Idempotency for a doubled turn_end of the SAME turn (a re-broadcast carries the same ts).
  // Keyed on ts, NOT reply text.
  if (ts && ts === inst.lastRepliedTurnTs) { drainAll(); return; }
  inst.lastRepliedTurnTs = ts || null;
  // Resume every platform's queue NOW (the slot is already released). The reply send below is
  // independent of the single-flight slot, so a slow/rate-limited sendOne must not starve the
  // other platform's queued prompt behind this await.
  drainAll();
  let text = extractLastAssistantText(transcriptPath);
  if (!text) text = tr(inst, 'noTextReply');

  // Try to update the ack card in-place with the reply. Fall back to sendReply on failure.
  const handle = await ackP?.catch(() => null);
  if (handle && typeof inst.adapter.updateAckCard === 'function') {
    const cfg = inst.bridgeDeps.getConfig();
    if (handle.streaming) {
      // AI 卡片：整条回复就在卡片内（流式期间已逐字呈现）。finalize 用 transcript 权威全文一次性
      // 落定 + 状态标签（执行完成），**不分块、不另发消息**——避免把已显示的全文截回首块。
      let full = text;
      if (full.length > STREAM_MAX_CHARS) full = full.slice(0, STREAM_MAX_CHARS) + '\n\n' + tr(inst, 'truncated');
      try {
        const updated = await inst.adapter.updateAckCard(cfg, target, handle, full, 'done', ctxFor(inst));
        if (!updated) await sendReply(inst, target, text);
        audit(inst, 'out', { conversationId: target.conversationId, streaming: true, cardUpdated: !!updated });
      } catch (e) {
        inst.lastError = String(e?.message || e);
        audit(inst, 'card-update-error', { error: inst.lastError });
        try { await sendReply(inst, target, text); } catch { /* already logged in sendReply */ }
      }
      return;
    }
    let chunks = chunkText(text, cfg.maxChunkChars);
    if (chunks.length > MAX_CHUNKS_PER_TURN) {
      chunks = chunks.slice(0, MAX_CHUNKS_PER_TURN);
      chunks[MAX_CHUNKS_PER_TURN - 1] += '\n\n' + tr(inst, 'truncated');
    }
    try {
      const updated = await inst.adapter.updateAckCard(cfg, target, handle, chunks[0] || text, 'done', ctxFor(inst));
      if (updated && chunks.length > 1) {
        for (let i = 1; i < chunks.length; i++) {
          try { await rateLimitGate(inst); await inst.adapter.sendOne(cfg, target, chunks[i], ctxFor(inst)); }
          catch (e) { inst.lastError = String(e?.message || e); audit(inst, 'send-error', { error: inst.lastError }); break; }
        }
      } else if (!updated) {
        await sendReply(inst, target, text);
      }
      audit(inst, 'out', { conversationId: target.conversationId, chunks: chunks.length, cardUpdated: !!updated });
    } catch (e) {
      inst.lastError = String(e?.message || e);
      audit(inst, 'card-update-error', { error: inst.lastError });
      try { await sendReply(inst, target, text); } catch { /* already logged in sendReply */ }
    }
  } else {
    try { await sendReply(inst, target, text); }
    catch (e) { inst.lastError = String(e?.message || e); audit(inst, 'send-error', { error: inst.lastError }); }
  }
}

// ─── per-platform lifecycle ───
export async function startBridge(id, deps) {
  const inst = instances.get(id);
  if (!inst) return;
  if (deps) inst.bridgeDeps = deps;
  if (inst.running) return;
  // Guard: reloadBridge (from the config route) calls startBridge with no deps. If the instance
  // was never primed with deps (non-CLI mode, no singleton PTY), refuse to start — otherwise the
  // inbound handler would dereference a null bridgeDeps.
  if (!inst.bridgeDeps || typeof inst.bridgeDeps.getConfig !== 'function') { audit(inst, 'start-skipped', { reason: 'no-deps' }); return; }
  const cfg = inst.bridgeDeps.getConfig();
  if (!cfg || !cfg.enabled || !inst.adapter.hasCreds(cfg)) return; // off / incomplete → no-op
  // Bump AFTER the early-return guards: startBridge on an already-running instance is a legal
  // no-op, and bumping there would orphan the live adapter's listeners (state frozen forever).
  const gen = ++inst.startGen;
  try {
    const hooks = {
      onInbound: (normalized, ackCtx) => handleInbound(inst, normalized, ackCtx),
      onConnectionChange: (state, err) => setConnectionState(inst, gen, state, err),
    };
    // Bound the connect so a hung adapter (e.g. Feishu WSClient.start() on a misconfigured app)
    // becomes a lastError instead of blocking the whole startup chain.
    const client = await Promise.race([
      inst.adapter.connect(cfg, hooks, ctxFor(inst)),
      new Promise((_, reject) => { const tm = setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS); if (typeof tm.unref === 'function') tm.unref(); }),
    ]);
    if (gen !== inst.startGen) {
      // stopBridge / reload ran while the connect was in flight: this start lost the race. Don't
      // resurrect the instance — tear down the late-arriving client so it doesn't leak.
      try { await inst.adapter.disconnect?.(client, ctxFor(inst)); } catch { /* best-effort */ }
      audit(inst, 'start-superseded', {});
      return;
    }
    inst.client = client;
    inst.running = true;
    inst.connected = true;
    inst.connectionState = 'connected';
    inst.lastError = null;
    if (typeof inst.adapter.connectionProbe === 'function') {
      inst.connPollTimer = setInterval(() => {
        try { setConnectionState(inst, gen, inst.adapter.connectionProbe(inst.client), null); }
        catch { /* best-effort: a probe throw must not kill the interval */ }
      }, CONN_POLL_MS);
      if (typeof inst.connPollTimer.unref === 'function') inst.connPollTimer.unref();
    }
    audit(inst, 'start', inst.adapter.statusFields ? inst.adapter.statusFields(cfg) : {});
  } catch (e) {
    if (gen !== inst.startGen) return; // superseded by stop/reload — don't overwrite their state
    inst.lastError = String(e?.message || e);
    inst.connected = false;
    inst.connectionState = 'disconnected';
    audit(inst, 'start-error', { error: inst.lastError });
  }
}

export async function stopBridge(id) {
  const inst = instances.get(id);
  if (!inst) return;
  // Invalidate connection hooks up front so anything the adapter teardown fires can't flip state.
  inst.startGen++;
  if (inst.connPollTimer) { clearInterval(inst.connPollTimer); inst.connPollTimer = null; }
  if (inst.ackCardPromise && activeInjection?.platformId === id) {
    await finalizeAckCard(inst, activeInjection.target, tr(inst, 'noSession'), 'error');
  } else {
    inst.ackCardPromise = null;
  }
  try { await inst.adapter.disconnect?.(inst.client, ctxFor(inst)); } catch { /* best-effort */ }
  if (inst.streamTimer) { clearInterval(inst.streamTimer); inst.streamTimer = null; } // 防御：流式定时器不泄漏
  inst.client = null;
  inst.running = false;
  inst.connected = false;
  inst.connectionState = 'disconnected';
  inst.boundConversation = null;
  if (activeInjection && activeInjection.platformId === id) clearActiveInjection();
  inst.queue.length = 0;
}

export async function reloadBridge(id, deps) {
  await stopBridge(id);
  await startBridge(id, deps);
}

export function isBridgeRunning(id) {
  const inst = instances.get(id);
  return !!(inst && inst.running);
}

export function getBridgeStatus(id) {
  const inst = instances.get(id);
  if (!inst) return { running: false, connected: false, connectionState: 'disconnected', lastError: null, boundConversationId: null };
  const base = {
    running: inst.running,
    connected: inst.connected,
    connectionState: inst.connectionState,
    lastError: inst.lastError,
    boundConversationId: inst.boundConversation?.conversationId || null,
  };
  const cfg = inst.bridgeDeps?.getConfig?.();
  return inst.adapter.statusFields ? { ...base, ...inst.adapter.statusFields(cfg) } : base;
}

/** Validate credentials without opening a Stream connection (the Test button). */
export async function testConnection(id, cfg) {
  const inst = instances.get(id);
  if (!inst) return { ok: false, detail: 'unknown platform' };
  try {
    return await inst.adapter.testConnection(cfg, ctxFor(inst));
  } catch (e) {
    return { ok: false, detail: String(e?.message || e) };
  }
}

// ─── multi-platform fan-out (server.js startup/shutdown) ───
export async function startAll(makeDeps) {
  // Start adapters independently so one platform's slow/failed connect can't block the others
  // (and, via server.js, the whole server bring-up). startBridge self-catches; the connect
  // timeout bounds a hang.
  await Promise.allSettled([...instances.keys()].map((id) => startBridge(id, makeDeps(id))));
}

export async function stopAll() {
  for (const id of instances.keys()) {
    await stopBridge(id);
  }
}

// ─── test seams ───
export function __setStreamTickMsForTests(ms) { STREAM_TICK_MS = (ms == null ? 300 : ms); }

export function __setConnPollMsForTests(ms) { CONN_POLL_MS = (ms == null ? 5_000 : ms); }

export function __setMaxQueueForTests(id, n) {
  const inst = instances.get(id);
  if (inst) inst.maxQueueOverride = n;
}

/** Reset one platform's singleton state (and release the global slot if it owns it). */
export function __resetForTests(id) {
  const inst = instances.get(id);
  if (!inst) return;
  inst.client = null; inst.running = false; inst.connected = false; inst.lastError = null;
  inst.connectionState = 'disconnected';
  inst.startGen++; // orphan any listeners still bound to a previous start
  if (inst.connPollTimer) { clearInterval(inst.connPollTimer); inst.connPollTimer = null; }
  inst.bridgeDeps = null; inst.boundConversation = null; inst.lastRepliedTurnTs = null;
  inst.maxQueueOverride = null;
  inst.seenMsgIds.length = 0; inst.queue.length = 0; inst.sendTimes.length = 0;
  inst.store = {};
  inst.ackCardPromise = null;
  if (inst.streamTimer) { clearInterval(inst.streamTimer); inst.streamTimer = null; }
  if (activeInjection && activeInjection.platformId === id) clearActiveInjection();
}

/** Whole-core reset across all platforms — for cross-adapter tests. */
export function __resetAllForTests() {
  for (const id of instances.keys()) __resetForTests(id);
  clearActiveInjection();
  fetchImpl = null;
}
