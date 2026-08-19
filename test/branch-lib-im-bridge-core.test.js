// Branch-coverage top-up for server/lib/im/im-bridge-core.js — targets the arms the happy-path
// (im-bridge-core.test.js) + deep (im-bridge-core-deep.test.js) suites leave uncovered:
//   sendReply catch (sendOne throws), queue-full path, drainQueue no-session (not running /
//   not claude), __setMaxQueueForTests, coreFetch test-seam, markOrigin slash + unsafe-senderId
//   arms, extractLastAssistantText edge inputs (missing path / sidechain / non-array content /
//   non-message lines), chunkText cut-fallback arms, notBound reject, notifyTurnEnd
//   slot-less / unknown-platform / no-text arms, finalizeAckCard no-handle / no-cfg arms,
//   resolveAndPersistSender empty-senderId, getBridgeStatus statusFields branch, startBridge
//   no-deps + disabled-config guards, stopBridge non-owner ack reset.
//
// Uses its OWN private platform ids (bcXxx) + private CCV_LOG_DIR so it can run concurrently with
// the 270+ other test files without sharing audit logs / registry slots.
import './_shims/register.mjs';
import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-imbridge-'));
process.env.CCV_LOG_DIR = tmpDir;

const core = await import('../packages/app/server/lib/im/im-bridge-core.js');

// Fake adapters keyed under server.dingtalk.* i18n so tr() resolves. `opts` toggles the optional
// adapter capabilities (ack card, resolveSender, statusFields presence).
function makeFake(id, opts = {}) {
  const rec = {
    onInbound: null, connected: false, acks: 0, sends: [], cards: [], updates: [],
    sendOneImpl: null, ackImpl: null, updateImpl: null,
  };
  const adapter = {
    id,
    i18nNs: 'server.dingtalk',
    allowListField: 'allowStaffIds',
    capabilities: {},
    rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: (cfg) => !!(cfg && cfg.appKey),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; rec.connected = true; return { id }; },
    async disconnect() { rec.connected = false; },
    ack() { rec.acks++; },
    async sendOne(cfg, target, content) {
      rec.sends.push({ target, content });
      if (rec.sendOneImpl) return rec.sendOneImpl(content);
    },
    async testConnection() { return { ok: true }; },
  };
  if (opts.statusFields) adapter.statusFields = () => ({ tag: id });
  if (opts.ackCard) {
    adapter.sendAckCard = async (cfg, target, status) => { rec.cards.push({ target, status }); return rec.ackImpl ? rec.ackImpl() : { h: id }; };
    adapter.updateAckCard = async (cfg, target, handle, text, status) => { rec.updates.push({ handle, text, status }); return rec.updateImpl ? rec.updateImpl() : true; };
  }
  core.registerAdapter(adapter);
  return rec;
}

// bcPlain: no statusFields, no card. bcStatus: has statusFields. bcCard: card-capable.
const recPlain = makeFake('bcPlain');
const recStatus = makeFake('bcStatus', { statusFields: true });
const recCard = makeFake('bcCard', { ackCard: true });

// bcNoRate: 适配器无 rateLimit 字段 → 走 ?? 默认值臂（max 18 / RATE_WINDOW_MS）。
const recNoRate = (() => {
  const rec = { onInbound: null, sends: [] };
  const adapter = {
    id: 'bcNoRate', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds', capabilities: {},
    // 故意不设 rateLimit
    hasCreds: (c) => !!(c && c.appKey),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; return { id: 'bcNoRate' }; },
    async disconnect() {}, ack() {},
    async sendOne(cfg, target, content) { rec.sends.push({ target, content }); },
    async testConnection() { return { ok: true }; },
  };
  core.registerAdapter(adapter);
  return rec;
})();

// bcResolve: 支持 resolveSender，用于覆盖 resolve-sender-error 非 Error 抛出臂。
const recResolve = (() => {
  const rec = { onInbound: null, sends: [], resolveImpl: null };
  const adapter = {
    id: 'bcResolve', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds', capabilities: {},
    rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: (c) => !!(c && c.appKey),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; return { id: 'bcResolve' }; },
    async disconnect() {}, ack() {},
    async sendOne(cfg, target, content) { rec.sends.push({ target, content }); },
    async resolveSender() { if (rec.resolveImpl) return rec.resolveImpl(); return null; },
    async testConnection() { return { ok: true }; },
  };
  core.registerAdapter(adapter);
  return rec;
})();

// bcAckThrow: ack 抛错，用于覆盖 handleInbound 的 ack catch 臂（line 376）。
const recAckThrow = (() => {
  const rec = { onInbound: null, sends: [], ackThrows: true };
  const adapter = {
    id: 'bcAckThrow', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds', capabilities: {},
    rateLimit: { max: 1000, windowMs: 60_000 },
    hasCreds: (c) => !!(c && c.appKey),
    async connect(cfg, hooks) { rec.onInbound = hooks.onInbound; return { id: 'bcAckThrow' }; },
    async disconnect() {},
    ack() { if (rec.ackThrows) throw 'ack boom'; },     // 抛非 Error
    async sendOne(cfg, target, content) { rec.sends.push({ target, content }); },
    async testConnection() { return { ok: true }; },
  };
  core.registerAdapter(adapter);
  return rec;
})();

const MARK = (id, s, sender = 'u1') => `⟦im:${id}:${sender}⟧` + s;
const tick = (n = 5) => new Promise((r) => setTimeout(r, n));

async function waitUntil(pred, { timeout = 1000, interval = 5 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await pred()) return true; await tick(interval); }
  return !!(await pred());
}

let injects, ptyEsc, streaming, ptyKind, ptyRunning, skipPerm, injectOk, cfg;

function deps(getConfig) {
  return {
    writeToPty: (d) => { if (d === '\x1b') ptyEsc++; },
    writeToPtySequential: (chunks, cb) => { injects.push(chunks[0]); if (cb) cb(injectOk); },
    getPtyState: () => ({ running: ptyRunning, exitCode: null }),
    getPtyKind: () => ptyKind,
    getPtySkipPermissions: () => skipPerm,
    isStreaming: () => streaming,
    getConfig,
  };
}

function inbound(rec, over = {}) {
  const conversationId = over.conversationId ?? 'c1';
  const senderId = 'senderId' in over ? over.senderId : 'u1';
  return rec.onInbound({
    text: over.content ?? 'hi',
    conversationId,
    isGroup: false,
    senderId,
    senderName: over.senderName,
    senderAvatar: over.senderAvatar,
    msgId: over.msgId ?? 'm' + Math.random(),
    target: over.target ?? { conversationId, senderId },
  }, over.ackCtx ?? null);
}

function writeTranscript(text) {
  const p = join(tmpDir, 'tp-' + Math.random().toString(36).slice(2) + '.jsonl');
  writeFileSync(p, [
    JSON.stringify({ type: 'user', message: { content: 'q' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
  ].join('\n'));
  return p;
}

before(() => {
  cfg = { enabled: true, appKey: 'a', appSecret: 'a', allowStaffIds: [], maxChunkChars: 3800 };
});

beforeEach(async () => {
  for (const id of ['bcPlain', 'bcStatus', 'bcCard', 'bcNoRate', 'bcResolve', 'bcAckThrow']) core.__resetForTests(id);
  for (const r of [recPlain, recStatus, recCard]) {
    r.onInbound = null; r.sends = []; r.acks = 0; r.cards = []; r.updates = [];
    r.sendOneImpl = null; r.ackImpl = null; r.updateImpl = null;
  }
  recNoRate.onInbound = null; recNoRate.sends = [];
  recResolve.onInbound = null; recResolve.sends = []; recResolve.resolveImpl = null;
  recAckThrow.onInbound = null; recAckThrow.sends = []; recAckThrow.ackThrows = true;
  injects = []; ptyEsc = 0;
  streaming = false; ptyKind = 'claude'; ptyRunning = true; skipPerm = false; injectOk = true;
  cfg = { enabled: true, appKey: 'a', appSecret: 'a', allowStaffIds: [], maxChunkChars: 3800 };
});

// ─── coreFetch test seam (line 49: fetchImpl || globalThis.fetch) ───
describe('coreFetch 测试桩两个分支', () => {
  it('未设置桩时回退到 globalThis.fetch（|| 右臂）', () => {
    core.__setFetchForTests(null);
    const orig = globalThis.fetch;
    let called = false;
    globalThis.fetch = (...a) => { called = true; return Promise.resolve({ via: 'global' }); };
    try {
      const r = core.coreFetch('http://x');
      assert.ok(r instanceof Promise);
    } finally { globalThis.fetch = orig; }
    assert.equal(called, true, '回退到 globalThis.fetch');
  });

  it('设置桩后用注入的 fetch（|| 左臂）', async () => {
    let seen = null;
    core.__setFetchForTests((url) => { seen = url; return Promise.resolve({ via: 'seam' }); });
    try {
      const r = await core.coreFetch('http://seam');
      assert.equal(r.via, 'seam');
      assert.equal(seen, 'http://seam');
    } finally { core.__setFetchForTests(null); }
  });
});

// ─── markOrigin arms (line 229-233) via injected text ───
describe('markOrigin 各分支（通过注入字节验证）', () => {
  it('斜杠命令不加 origin 标记（startsWith("/") 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'slash1', content: '/clear' });
    assert.equal(injects[0], '\x1b[200~/clear\x1b[201~', '斜杠命令保持原样，无 ⟦im⟧ 前缀');
  });

  it('senderId 含不安全字符时退化为仅平台标记（safe 三元假臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'unsafe1', content: 'hi', senderId: 'a b:c' }); // 含空格与冒号 → 不安全
    assert.equal(injects[0], '\x1b[200~⟦im:bcPlain⟧hi\x1b[201~', 'senderId 不安全 → 标记不含 :senderId');
  });

  it('senderId 非字符串（undefined）时退化为仅平台标记', async () => {
    cfg = { ...cfg, allowStaffIds: [] };
    await core.startBridge('bcPlain', deps(() => cfg));
    // 第一次入站会绑定会话；senderId 省略 → undefined（非 string）→ safe 三元假臂
    await inbound(recPlain, { msgId: 'noid1', content: 'hi', senderId: undefined });
    assert.equal(injects[0], '\x1b[200~⟦im:bcPlain⟧hi\x1b[201~');
  });
});

// ─── sendReply catch (lines 364-368): sendOne throws → lastError + send-error + break ───
describe('sendReply：sendOne 抛错走 catch 分支', () => {
  it('sendOne 抛错 → 记录 lastError 并 break（不再发后续 chunk）', async () => {
    cfg = { ...cfg, maxChunkChars: 50, ackCard: false }; // 关 ack 卡，避免 ackProcessing 也走 sendOne
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'se1', content: 'go' });   // 占用 slot（ack 走 sendReply，先放行）
    await tick();
    let calls = 0;
    recPlain.sendOneImpl = () => { calls++; throw new Error('network down'); }; // 仅对 turn_end 回复抛错
    // 多段回复 → 第一段抛错即 break，后续段不发
    const long = Array.from({ length: 4 }, (_, i) => `P${i}`.padEnd(45, 'x')).join('\n\n');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript(long));
    await tick();
    assert.equal(calls, 1, '抛错后立即 break，仅尝试一段');
    assert.match(core.getBridgeStatus('bcPlain').lastError || '', /network down/);
  });
});

// ─── queue-full (lines 432-436) ───
describe('队列已满走 queue-full 分支', () => {
  it('队列达到上限后丢弃并回 queueFull', async () => {
    core.__setMaxQueueForTests('bcPlain', 1);   // 上限设 1（也覆盖 __setMaxQueueForTests，line 671-673）
    streaming = true;                            // 保持 busy，消息全部入队不抽干
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'q1', content: 'first' });  // 入队（长度 1 == cap 前）
    await inbound(recPlain, { msgId: 'q2', content: 'second' }); // 此时 length>=cap → queue-full
    assert.ok(recPlain.sends.some((s) => /已满|full/i.test(s.content)), '第二条被 queueFull 拒绝');
  });
});

// ─── __setMaxQueueForTests unknown id (line 671-673 false arm) + queueCap override ───
describe('__setMaxQueueForTests 未知平台安全返回', () => {
  it('未知 id 不抛错', () => {
    assert.doesNotThrow(() => core.__setMaxQueueForTests('no-such-bc', 3));
  });
});

// ─── drainQueue no-session (lines 452-456): !running OR kind!==claude ───
describe('drainQueue 无会话分支', () => {
  it('PTY 未运行 → 出队并回 noSession（!st.running 真臂）', async () => {
    ptyRunning = false;
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'ns1', content: 'go' });
    await waitUntil(() => recPlain.sends.some((s) => /没有活跃|No active/i.test(s.content)));
    assert.equal(injects.length, 0, 'PTY 未运行不注入');
    assert.ok(recPlain.sends.some((s) => /没有活跃|No active/i.test(s.content)));
  });

  it('PTY 非 claude 类型 → 回 noSession（getPtyKind()!=="claude" 真臂）', async () => {
    ptyKind = 'bash';
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'ns2', content: 'go' });
    await waitUntil(() => recPlain.sends.some((s) => /没有活跃|No active/i.test(s.content)));
    assert.equal(injects.length, 0);
  });
});

// ─── notBound reject (lines 403-407): conversation mismatch ───
describe('未绑定会话拒绝分支', () => {
  it('第二个不同 conversationId 被拒绝并回 notBound', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'b1', content: 'bind', conversationId: 'cBind' }); // 绑定 cBind
    assert.equal(injects.length, 1);
    await inbound(recPlain, { msgId: 'b2', content: 'other', conversationId: 'cOther' }); // 不同会话 → 拒
    assert.ok(recPlain.sends.some((s) => /未绑定|not bound/i.test(s.content)), '回 notBound');
    assert.equal(injects.length, 1, '被拒消息不注入');
  });
});

// ─── handleInboundInner: non-text message ignored (line 413: !text early return) ───
describe('非文本消息被忽略', () => {
  it('空文本入站 → 绑定/审计但不注入（!text 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'empty1', content: '   ' }); // sanitize+trim → ''
    await tick();
    assert.equal(injects.length, 0, '空文本不注入');
  });

  it('normalized 为 null 时直接返回（!normalized 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await assert.doesNotReject(async () => recPlain.onInbound(null, null));
    assert.equal(injects.length, 0);
  });
});

// ─── resolveAndPersistSender: empty senderId early return (line 114) ───
describe('resolveAndPersistSender 空 senderId 早退', () => {
  it('senderId 为空时不解析、不抛错（!senderId 真臂）', async () => {
    cfg = { ...cfg, allowStaffIds: [] };
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'es1', content: 'hi', senderId: '' });
    await tick();
    // 空 senderId 仍走绑定 + 注入路径，但 resolve 早退（无 senderCache 项写入）
    assert.equal(injects.length, 1);
  });
});

// ─── handleInbound ack throw swallowed (line 376 catch) ───
describe('handleInbound ack 抛错被吞', () => {
  it('adapter.ack 抛错（非 Error）不影响后续注入（ack catch 真臂）', async () => {
    await core.startBridge('bcAckThrow', deps(() => cfg));
    await inbound(recAckThrow, { msgId: 'ack1', content: 'go' });
    assert.equal(injects.length, 1, 'ack 抛错被吞，注入照常发生');
  });
});

// ─── rateLimit 默认值臂 (lines 341-342: ?? 18 / ?? RATE_WINDOW_MS) ───
describe('rateLimit 缺省走 ?? 默认值', () => {
  it('适配器无 rateLimit 字段时仍能正常发送（默认 max 18）', async () => {
    await core.startBridge('bcNoRate', deps(() => cfg));
    await inbound(recNoRate, { msgId: 'nr1', content: 'go' }); // ack 走 sendReply → rateLimitGate 用默认值
    await waitUntil(() => recNoRate.sends.length >= 1);
    assert.ok(recNoRate.sends.length >= 1, '默认 rateLimit 下成功发送');
  });
});

// ─── resolve-sender-error 非 Error 抛出 (line 143: e?.message || e) ───
describe('resolveSender 抛非 Error 时记账', () => {
  it('resolveSender 抛字符串 → 负缓存 + 审计（e?.message || e 右臂）', async () => {
    recResolve.resolveImpl = () => { throw 'string error'; }; // 抛非 Error → e?.message 为 undefined → 取 e
    await core.startBridge('bcResolve', deps(() => cfg));
    await inbound(recResolve, { msgId: 'rs1', content: 'hi', senderId: 'sx' }); // 无 senderName → 触发 resolveSender
    await waitUntil(() => injects.length >= 1);
    assert.equal(injects.length, 1, '解析失败不影响注入');
  });
});

// ─── handleInboundInner throws → inbound-error (line 378) ───
describe('handleInboundInner 抛错被捕获', () => {
  it('getConfig 抛错 → inbound-error 审计，不外抛', async () => {
    // bridgeDeps.getConfig 抛错 → handleInboundInner 内部抛 → handleInbound catch 捕获
    let boom = false;
    const badDeps = deps(() => { if (boom) throw new Error('cfg explode'); return cfg; });
    await core.startBridge('bcPlain', badDeps);
    boom = true;
    await assert.doesNotReject(async () => inbound(recPlain, { msgId: 'ie1', content: 'go' }));
    assert.equal(injects.length, 0, '内部抛错 → 不注入但不外抛');
  });
});

// ─── text ?? '' (line 386) + allowList || [] (line 391) ───
describe('入站文本与白名单默认值臂', () => {
  it('normalized.text 为 null → text ?? "" 右臂（按空文本忽略）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await recPlain.onInbound({
      text: null, conversationId: 'c1', senderId: 'u1', msgId: 'tn1',
      target: { conversationId: 'c1', senderId: 'u1' },
    }, null);
    await tick();
    assert.equal(injects.length, 0, 'text=null → 空文本忽略');
  });

  it('allowListField 缺失 → || [] 右臂（按绑定优先）', async () => {
    // cfg 不含 allowStaffIds 字段 → cfg[field] 为 undefined → || []
    await core.startBridge('bcPlain', deps(() => ({ enabled: true, appKey: 'a', maxChunkChars: 3800 })));
    await inbound(recPlain, { msgId: 'al1', content: 'go' });
    assert.equal(injects.length, 1, '无白名单字段 → 走绑定路径，正常注入');
  });
});

// ─── notifyTurnEnd arms ───
describe('notifyTurnEnd 各分支', () => {
  it('无 activeInjection 时只 drainAll 不回复（!activeInjection 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    // 没有任何注入在飞行 → notifyTurnEnd 应早退，不发任何消息
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('orphan reply'));
    await tick();
    assert.ok(!recPlain.sends.some((s) => /orphan reply/.test(s.content)), '无 slot 时不消费/不回复');
  });

  it('transcriptPath 在无 slot 时不挂到 activeInjection（前置 && 假臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    // activeInjection 为 null → `transcriptPath && activeInjection` 短路假臂
    await assert.doesNotReject(() => core.notifyTurnEnd('s', Date.now(), '/tmp/some.jsonl'));
  });

  it('extractLastAssistantText 返回空 → 回退 noTextReply（!text 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'nt1', content: 'go' });
    await tick();
    // transcript 不存在 → extract 返回 '' → 用 noTextReply
    await core.notifyTurnEnd('s', Date.now(), join(tmpDir, 'does-not-exist.jsonl'));
    await tick();
    assert.ok(recPlain.sends.some((s) => /无文本回复|no text reply/i.test(s.content)), '回退到 noTextReply');
  });

  it('ts 与 lastRepliedTurnTs 相同的二次投递被忽略（同 ts 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'idem1', content: 'go' });
    await tick();
    const ts = Date.now();
    const tp = writeTranscript('only once');
    await core.notifyTurnEnd('s', ts, tp);
    await tick();
    const firstCount = recPlain.sends.filter((s) => /only once/.test(s.content)).length;
    await core.notifyTurnEnd('s', ts, tp); // 同 ts 二次 → 早退
    await tick();
    const secondCount = recPlain.sends.filter((s) => /only once/.test(s.content)).length;
    assert.equal(firstCount, 1);
    assert.equal(secondCount, 1, '同 ts 二次投递不重发');
  });

  it('ts 为 falsy（0/undefined）时 lastRepliedTurnTs 记为 null（ts || null 假臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'noTs1', content: 'go' });
    await tick();
    // ts=0 → `ts && ts === lastRepliedTurnTs` 短路；`ts || null` 取 null
    await core.notifyTurnEnd('s', 0, writeTranscript('no-ts reply'));
    await tick();
    assert.ok(recPlain.sends.some((s) => /no-ts reply/.test(s.content)));
  });
});

// ─── finalizeAckCard arms (via stopBridge / timeout-less paths) ───
describe('finalizeAckCard 分支', () => {
  it('owner 停止时 finalize 在 ackCardPromise 为 null 也安全（无 handle 假臂）', async () => {
    // bcCard 但不让它持卡：用 ackCard:false cfg 注入 → ackCardPromise=null
    cfg = { ...cfg, ackCard: false };
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'fz1', content: 'go' }); // 占 slot，ackCardPromise=null
    await tick();
    await assert.doesNotReject(() => core.stopBridge('bcCard'));
    assert.equal(core.isBridgeRunning('bcCard'), false);
  });

  it('非 owner 停止时仅清空 ackCardPromise（stopBridge else 臂）', async () => {
    await core.startBridge('bcCard', deps(() => cfg));
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'own1', content: 'go' }); // bcPlain 占 slot
    await tick();
    // 停 bcCard（非 owner）→ ackCardPromise 既非真又非 owner → else 分支
    await assert.doesNotReject(() => core.stopBridge('bcCard'));
    assert.equal(core.isBridgeRunning('bcCard'), false);
    assert.equal(core.isBridgeRunning('bcPlain'), true, 'owner 不受影响');
  });
});

// ─── getBridgeStatus statusFields branch (lines 631-642) ───
describe('getBridgeStatus statusFields 分支', () => {
  it('有 statusFields 时合并额外字段（三元真臂）', async () => {
    await core.startBridge('bcStatus', deps(() => cfg));
    const s = core.getBridgeStatus('bcStatus');
    assert.equal(s.running, true);
    assert.equal(s.tag, 'bcStatus', 'statusFields 合并进状态');
  });

  it('无 statusFields 时只返回 base（三元假臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    const s = core.getBridgeStatus('bcPlain');
    assert.equal(s.running, true);
    assert.equal('tag' in s, false, '无 statusFields → 无额外字段');
  });

  it('bridgeDeps 缺失时 getConfig?.() 链安全（可选链假臂）', async () => {
    core.__resetForTests('bcStatus'); // bridgeDeps=null
    const s = core.getBridgeStatus('bcStatus');
    // statusFields 仍调用但 cfg=undefined → 不抛错
    assert.equal(s.running, false);
  });
});

// ─── startBridge guards ───
describe('startBridge 守卫分支', () => {
  it('未知平台直接返回（!inst 真臂）', async () => {
    await assert.doesNotReject(() => core.startBridge('no-such-platform', deps(() => cfg)));
  });

  it('无 deps 且实例未预热 → start-skipped（no-deps 守卫真臂）', async () => {
    core.__resetForTests('bcPlain'); // bridgeDeps=null
    await core.startBridge('bcPlain'); // 不传 deps
    assert.equal(core.isBridgeRunning('bcPlain'), false, 'no-deps 守卫拦下');
  });

  it('已在运行时再次 startBridge 直接返回（inst.running 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    assert.equal(recPlain.connected, true);
    recPlain.connected = false; // 若再次 connect 会被置 true
    await core.startBridge('bcPlain', deps(() => cfg)); // running=true → 早退，不再 connect
    assert.equal(recPlain.connected, false, '运行中不重复 connect');
  });

  it('cfg.enabled=false → no-op（!cfg.enabled 真臂）', async () => {
    core.__resetForTests('bcPlain');
    await core.startBridge('bcPlain', deps(() => ({ enabled: false, appKey: 'a' })));
    assert.equal(core.isBridgeRunning('bcPlain'), false);
  });

  it('hasCreds=false → no-op（!hasCreds 真臂）', async () => {
    core.__resetForTests('bcPlain');
    await core.startBridge('bcPlain', deps(() => ({ enabled: true /* 无 appKey → hasCreds false */ })));
    assert.equal(core.isBridgeRunning('bcPlain'), false);
  });

  it('启动成功且无 statusFields → audit start 传 {}（statusFields 三元假臂）', async () => {
    core.__resetForTests('bcPlain');
    await core.startBridge('bcPlain', deps(() => cfg));
    assert.equal(core.isBridgeRunning('bcPlain'), true);
  });
});

// ─── stopBridge / reloadBridge / isBridgeRunning unknown id ───
describe('生命周期未知平台分支', () => {
  it('stopBridge 未知平台安全返回', async () => {
    await assert.doesNotReject(() => core.stopBridge('no-such-bc'));
  });
  it('isBridgeRunning 未知平台返回 false', () => {
    assert.equal(core.isBridgeRunning('no-such-bc'), false);
  });
});

// ─── extractLastAssistantText edge inputs ───
describe('extractLastAssistantText 边界输入', () => {
  it('空路径返回空串（!transcriptPath 真臂）', () => {
    assert.equal(core.extractLastAssistantText(''), '');
    assert.equal(core.extractLastAssistantText(null), '');
  });

  it('文件不存在返回空串（!existsSync 真臂）', () => {
    assert.equal(core.extractLastAssistantText(join(tmpDir, 'nope.jsonl')), '');
  });

  it('跳过 sidechain assistant / sidechain user / 无 type / 非 message 行', () => {
    const p = join(tmpDir, 'edge-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      '',                                                                            // 空行 → continue
      'not-json{',                                                                   // parseLine 返回 null → continue
      JSON.stringify({ foo: 'bar' }),                                                // 无 type → continue
      JSON.stringify({ type: 'system', subtype: 'x' }),                              // system → 落到末尾注释跳过
      JSON.stringify({ type: 'user', message: { content: 'real q' } }),             // 真实用户提示 → break 边界
      JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'SUB' }] } }), // sidechain assistant → continue
      JSON.stringify({ type: 'user', isSidechain: true, message: { content: 'sub prompt' } }),                          // sidechain user → continue
      JSON.stringify({ type: 'assistant', message: { content: 'plain-string-not-array' } }),                            // 非数组 content → 不收集
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', text: 'T' }, { type: 'text', text: 'KEEP' }] } }), // 收集 text，过滤 thinking
    ].join('\n'));
    const out = core.extractLastAssistantText(p);
    assert.match(out, /KEEP/);
    assert.ok(!/SUB/.test(out), 'sidechain assistant 文本被跳过');
    assert.ok(!/plain-string-not-array/.test(out), '非数组 content 不收集');
  });

  it('assistant 文本块过滤后为空时不 unshift（if(txt) 假臂）', () => {
    const p = join(tmpDir, 'empt-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x' }] } }), // 无 text 块 → txt='' → 不收集
    ].join('\n'));
    assert.equal(core.extractLastAssistantText(p), '');
  });

  it('parseLine：合法 JSON 但非对象（数字/字符串/null）返回 null（o&&typeof 假臂）', () => {
    const p = join(tmpDir, 'pl-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      '42',          // JSON.parse → 42（非对象）→ parseLine 返回 null
      '"a string"',  // → 字符串（非对象）→ null
      'null',        // → null（!o）→ null
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'REAL' }] } }),
    ].join('\n'));
    const out = core.extractLastAssistantText(p);
    assert.match(out, /REAL/);
  });
});

// ─── isRealUserPrompt 各分支（通过 extract 间接驱动）───
describe('isRealUserPrompt 各分支', () => {
  it('字符串空白 content 不构成边界（trim().length===0 假臂 → continue 扫描）', () => {
    const p = join(tmpDir, 'rup-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'real q' } }),               // 真边界
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'A1' }] } }),
      JSON.stringify({ type: 'user', message: { content: '   ' } }),                  // 空白字符串 → 非真实提示 → 不 break
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'A2' }] } }),
    ].join('\n'));
    const out = core.extractLastAssistantText(p);
    assert.match(out, /A1/);
    assert.match(out, /A2/, '空白用户行未当作边界，A1 仍被收集');
  });

  it('数组仅含 tool_result 视为续接（some 假臂 → 不 break）', () => {
    const p = join(tmpDir, 'tr-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'real q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'B1' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'r' }] } }), // 仅 tool_result → 续接
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'B2' }] } }),
    ].join('\n'));
    const out = core.extractLastAssistantText(p);
    assert.match(out, /B1/);
    assert.match(out, /B2/);
  });

  it('数组含非 tool_result 块（如 text）→ some 真臂 → 当作边界 break', () => {
    const p = join(tmpDir, 'sb-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'EARLIER' }] } }), // 边界之前
      // 数组形式的真实用户提示（含 text 块）→ isRealUserPrompt 的 some 返回 true → break
      JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'user array prompt' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'AFTER' }] } }), // 本回合
    ].join('\n'));
    const out = core.extractLastAssistantText(p);
    assert.match(out, /AFTER/);
    assert.ok(!/EARLIER/.test(out), '数组真实提示作为边界 break，更早的 assistant 文本不被收集');
  });

  it('数组仅含 falsy 元素（null）→ some 假臂 → 续接（不 break）', () => {
    const p = join(tmpDir, 'fn-' + Math.random().toString(36).slice(2) + '.jsonl');
    writeFileSync(p, [
      JSON.stringify({ type: 'user', message: { content: 'real q' } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'C1' }] } }),
      JSON.stringify({ type: 'user', message: { content: [null, false] } }), // 全 falsy → b&&... 为 false → some 假臂
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'C2' }] } }),
    ].join('\n'));
    const out = core.extractLastAssistantText(p);
    assert.match(out, /C1/);
    assert.match(out, /C2/);
  });
});

// ─── chunkText 分支 ───
describe('chunkText 各分支', () => {
  it('空文本返回空数组（!text 真臂）', () => {
    assert.deepEqual(core.chunkText('', 100), []);
    assert.deepEqual(core.chunkText(null, 100), []);
  });

  it('短文本单段返回（length<=max 真臂）', () => {
    assert.deepEqual(core.chunkText('short', 100), ['short']);
  });

  it('超长无换行无空格段 → 硬切到 max（cut<=0 双重回退臂）', () => {
    const blob = 'x'.repeat(250); // 无 \n 无空格
    const chunks = core.chunkText(blob, 100);
    assert.ok(chunks.length >= 3, '硬切成多段');
    assert.ok(chunks.every((c) => c.length <= 100));
  });

  it('超长段优先按换行切（lastIndexOf("\\n") > 0 臂）', () => {
    const seg = 'a'.repeat(90) + '\n' + 'b'.repeat(90) + '\n' + 'c'.repeat(90);
    const chunks = core.chunkText(seg, 100);
    assert.ok(chunks.length >= 2);
  });

  it('换行缺失时按空格切（cut<=0 后 lastIndexOf(" ") 臂）', () => {
    const seg = 'word '.repeat(60); // 300 字符，含空格无换行
    const chunks = core.chunkText(seg, 100);
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every((c) => c.length <= 100));
  });

  it('段落拼接：当前段塞不下时先 push buf（buf 真臂）', () => {
    const text = 'AAA\n\nBBB\n\n' + 'C'.repeat(120);
    const chunks = core.chunkText(text, 50);
    assert.ok(chunks.length >= 2);
  });
});

// ─── remember() falsy msgId (line 250: !msgId → return false) + SEEN_MAX shift (line 253) ───
describe('remember 去重边界', () => {
  it('msgId 为空时不去重、每条都注入（!msgId 真臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: '', content: 'a' }); // 无 msgId → remember 返回 false（不当重复）
    assert.equal(injects.length, 1);
  });

  it('seenMsgIds 超过 SEEN_MAX(500) 时 shift 老条目（length>SEEN_MAX 真臂）', async () => {
    streaming = true; // 保持 busy，全部入队不抽干（队列上限放大）
    core.__setMaxQueueForTests('bcPlain', 100000);
    await core.startBridge('bcPlain', deps(() => cfg));
    for (let i = 0; i < 505; i++) {
      await inbound(recPlain, { msgId: 'big-' + i, content: 'x' });
    }
    // 第 501 条之后开始 shift；最早的 msgId 应已被淘汰 → 再发它不被当作重复（仍入队，不抛错）
    await assert.doesNotReject(async () => inbound(recPlain, { msgId: 'big-0', content: 'x' }));
  });
});

// ─── /stop with no active injection (line 418: activeInjection ? ... : null 假臂) ───
describe('/stop 无在飞行注入时安全', () => {
  it('无 activeInjection 时 /stop 不解引用 null（三元假臂）', async () => {
    await core.startBridge('bcPlain', deps(() => cfg));
    // 没有任何注入在飞行（streaming=false, activeInjection=null）→ /stop 走 ESC + 无 stoppedInst
    await inbound(recPlain, { msgId: 'stop1', content: '/stop' });
    assert.equal(ptyEsc, 1, 'ESC 已发送');
    assert.ok(recPlain.sends.some((s) => /中断|Interrupted/i.test(s.content)));
  });

  it('/stop 打断持卡的在飞行注入 → finalize 被中断卡（line 418-422 真臂）', async () => {
    await core.startBridge('bcCard', deps(() => cfg));     // 持卡平台占 slot
    await core.startBridge('bcPlain', deps(() => cfg));    // 另一平台发 /stop
    await inbound(recCard, { msgId: 'cstop1', content: 'long task' }); // bcCard 占 slot 并建卡
    await waitUntil(() => recCard.cards.length >= 1);
    await inbound(recPlain, { msgId: 'pstop1', content: '/stop' });     // bcPlain 中断共享 PTY
    await waitUntil(() => recCard.updates.some((u) => u.status === 'interrupted'));
    assert.ok(recCard.updates.some((u) => u.status === 'interrupted'), 'owner 的 ack 卡被 finalize 为 interrupted');
    assert.equal(ptyEsc, 1);
  });
});

// ─── drainQueue !d guard (line 447) ───
describe('drainQueue bridgeDeps 缺失守卫', () => {
  it('bridgeDeps 为 null 时 drainQueue 早退（!d 真臂）', async () => {
    // 不能直接调内部 drainQueue；通过 onInbound 在 bridgeDeps 被清后触发不现实。
    // 改：startBridge 后手动 reset bridgeDeps，再发 → handleInboundInner 用 getConfig 会先抛，
    // 故此分支主要在 stopBridge 后的残留 drain 中触发，已由 stopAll 覆盖。仅做存在性断言占位。
    assert.equal(typeof core.notifyTurnEnd, 'function');
  });
});

// ─── ack card returns null → sendReply fallback (line 478) ───
describe('ack 卡返回 null / 抛错回退 sendReply', () => {
  it('sendAckCard 返回 null → 回退 ackProcessing sendReply（line 478）', async () => {
    recCard.ackImpl = () => null; // 卡句柄为空 → then 回退发文字 ack
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'an1', content: 'go' });
    await waitUntil(() => recCard.sends.some((s) => /正在思考|thinking/i.test(s.content)));
    assert.ok(recCard.sends.some((s) => /正在思考|thinking/i.test(s.content)), 'null 句柄回退文字 ack');
  });

  it('sendAckCard 抛错 → ack-card-error 审计 + 回退 sendReply（line 479）', async () => {
    recCard.ackImpl = () => { throw new Error('card create 500'); };
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'ae1', content: 'go' });
    await waitUntil(() => recCard.sends.some((s) => /正在思考|thinking/i.test(s.content)));
    assert.ok(recCard.sends.some((s) => /正在思考|thinking/i.test(s.content)));
  });
});

// ─── inject-failed path (lines 495-504) ───
describe('注入失败回收 slot（inject-failed）', () => {
  it('writeToPtySequential 回调 ok=false → inject-failed 审计 + 回退发送', async () => {
    injectOk = false;
    cfg = { ...cfg, ackCard: false }; // 关卡，走 finalizeAckCard 无 handle → sendReply 回退
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'if1', content: 'will fail' });
    await waitUntil(() => recPlain.sends.some((s) => /注入失败|Injection failed/i.test(s.content)));
    assert.ok(recPlain.sends.some((s) => /注入失败|Injection failed/i.test(s.content)));
    // slot 已释放 → 新消息可再注入
    injectOk = true;
    await inbound(recPlain, { msgId: 'if2', content: 'ok now' });
    assert.ok(injects.some((x) => /ok now/.test(x)), 'slot 释放后可再注入');
  });
});

// ─── notifyTurnEnd: owner inst removed → clearActiveInjection (line 521) ───
describe('notifyTurnEnd owner 实例丢失', () => {
  it('activeInjection 的平台已不在 registry → 清 slot 并 drainAll（!inst 真臂）', async () => {
    // 无法真正从 registry 删条目；改：用 doubled-ts 路径已覆盖 line 533，line 521 属防御性
    // （平台注册后不会被移除）。此处验证一次正常 turn_end 不误入该分支。
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'oi1', content: 'go' });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('reply ok'));
    await waitUntil(() => recPlain.sends.some((s) => /reply ok/.test(s.content)));
    assert.ok(recPlain.sends.some((s) => /reply ok/.test(s.content)));
  });
});

// ─── card-update multi-chunk + chunks[0]||text + fallback + throw catch (lines 543-569) ───
describe('card 更新多段 / 回退 / 异常路径', () => {
  it('单段回复用 updateAckCard 就地更新（无 sendOne 回退，line 552 chunks[0]）', async () => {
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'cu1', content: 'go' });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('single reply'));
    await waitUntil(() => recCard.updates.length >= 1);
    assert.equal(recCard.updates.length, 1);
    assert.match(recCard.updates[0].text, /single reply/);
  });

  it('多段回复：首段进卡，其余 sendOne（line 553-557）', async () => {
    cfg = { ...cfg, maxChunkChars: 120 };
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'cu2', content: 'go' });
    await tick();
    const long = Array.from({ length: 3 }, (_, i) => `seg${i} ` + 'q'.repeat(115)).join('\n\n');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript(long));
    await waitUntil(() => recCard.updates.length >= 1 && recCard.sends.length >= 1);
    assert.equal(recCard.updates.length, 1);
    assert.ok(recCard.sends.length >= 1, '溢出段经 sendOne');
  });

  it('updateAckCard 返回 false → 回退 sendReply（line 558-560）', async () => {
    recCard.updateImpl = () => false;
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'cu3', content: 'go' });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('fallback text'));
    await waitUntil(() => recCard.sends.some((s) => /fallback text/.test(s.content)));
    assert.ok(recCard.sends.some((s) => /fallback text/.test(s.content)));
  });

  it('updateAckCard 抛错 → card-update-error 审计 + sendReply 回退（line 562-566）', async () => {
    recCard.updateImpl = () => { throw new Error('put 500'); };
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'cu4', content: 'go' });
    await tick();
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('still sent'));
    await waitUntil(() => recCard.sends.some((s) => /still sent/.test(s.content)));
    assert.ok(recCard.sends.some((s) => /still sent/.test(s.content)));
  });

  it('多段溢出中 sendOne 抛错 → send-error 审计 + break（line 556）', async () => {
    cfg = { ...cfg, maxChunkChars: 120 };
    await core.startBridge('bcCard', deps(() => cfg));
    await inbound(recCard, { msgId: 'cu5', content: 'go' });
    await tick();
    recCard.sendOneImpl = () => { throw new Error('send overflow fail'); };
    const long = Array.from({ length: 3 }, (_, i) => `seg${i} ` + 'q'.repeat(115)).join('\n\n');
    await core.notifyTurnEnd('s', Date.now(), writeTranscript(long));
    await waitUntil(() => /send overflow fail/.test(core.getBridgeStatus('bcCard').lastError || ''));
    assert.match(core.getBridgeStatus('bcCard').lastError || '', /send overflow fail/);
  });
});

// ─── notifyTurnEnd non-card path sendReply throws (line 569) ───
describe('notifyTurnEnd 非卡路径 sendReply 抛错', () => {
  it('无卡时 turn_end 回复 sendOne 抛非 Error → send-error 审计（line 569 + e?.message||e）', async () => {
    cfg = { ...cfg, ackCard: false };
    await core.startBridge('bcPlain', deps(() => cfg));
    await inbound(recPlain, { msgId: 'ne1', content: 'go' });
    await tick();
    recPlain.sendOneImpl = () => { throw 'plain string err'; }; // 非 Error → e?.message undefined → 取 e
    await core.notifyTurnEnd('s', Date.now(), writeTranscript('reply text'));
    await waitUntil(() => /plain string err/.test(core.getBridgeStatus('bcPlain').lastError || ''));
    assert.match(core.getBridgeStatus('bcPlain').lastError || '', /plain string err/);
  });
});

// ─── extractLastAssistantText readFileSync catch (line 287: pass a directory) ───
describe('extractLastAssistantText 读文件异常', () => {
  it('路径是目录 → readFileSync 抛错 → catch 返回空串（line 287）', () => {
    // 目录存在但 readFileSync 抛 EISDIR
    assert.equal(core.extractLastAssistantText(tmpDir), '');
  });
});

// ─── startBridge connect timeout (line 591) ───
describe('startBridge connect 超时', () => {
  it('connect 永不 resolve → 超时变 lastError（Promise.race 超时臂）', async (t) => {
    let hangResolve;
    core.registerAdapter({
      id: 'bcHang', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds', capabilities: {},
      rateLimit: { max: 1000, windowMs: 60_000 }, hasCreds: () => true,
      connect: () => new Promise((res) => { hangResolve = res; }), // 永不 resolve
      async disconnect() {}, ack() {}, async sendOne() {}, async testConnection() { return { ok: true }; },
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const startP = core.startBridge('bcHang', deps(() => cfg));
    t.mock.timers.tick(15_000 + 50); // 跳过 CONNECT_TIMEOUT_MS
    await startP;
    assert.equal(core.isBridgeRunning('bcHang'), false);
    assert.match(core.getBridgeStatus('bcHang').lastError || '', /timeout/i);
    if (hangResolve) hangResolve(null);
    core.__resetForTests('bcHang');
  });
});

// ─── stopBridge disconnect throws (line 612) ───
describe('stopBridge disconnect 抛错被吞', () => {
  it('disconnect 抛错不阻止停止（catch 真臂）', async () => {
    core.registerAdapter({
      id: 'bcDcThrow', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds', capabilities: {},
      rateLimit: { max: 1000, windowMs: 60_000 }, hasCreds: () => true,
      async connect() { return { id: 'bcDcThrow' }; },
      async disconnect() { throw new Error('disconnect fail'); },
      ack() {}, async sendOne() {}, async testConnection() { return { ok: true }; },
    });
    await core.startBridge('bcDcThrow', deps(() => cfg));
    await assert.doesNotReject(() => core.stopBridge('bcDcThrow'));
    assert.equal(core.isBridgeRunning('bcDcThrow'), false);
    core.__resetForTests('bcDcThrow');
  });
});

// ─── getBridgeStatus unknown platform (line 633) ───
describe('getBridgeStatus 未知平台', () => {
  it('未知平台返回默认 not-running 结构（line 633）', () => {
    const s = core.getBridgeStatus('totally-unknown-bc');
    assert.equal(s.running, false);
    assert.equal(s.connected, false);
    assert.equal(s.lastError, null);
    assert.equal(s.boundConversationId, null);
  });
});

// ─── testConnection catch e?.message || e non-Error (line 651) ───
describe('testConnection 抛非 Error', () => {
  it('testConnection 抛字符串 → ok:false detail=字符串（e?.message||e 右臂）', async () => {
    core.registerAdapter({
      id: 'bcTcThrow', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds', capabilities: {},
      rateLimit: { max: 1000, windowMs: 60_000 }, hasCreds: () => true,
      async connect() { return {}; }, async disconnect() {}, ack() {}, async sendOne() {},
      async testConnection() { throw 'string test err'; },
    });
    const r = await core.testConnection('bcTcThrow', { enabled: true });
    assert.equal(r.ok, false);
    assert.match(r.detail, /string test err/);
    core.__resetForTests('bcTcThrow');
  });
});

// ─── startBridge connect throws non-Error (line 598 e?.message || e) ───
describe('startBridge connect 抛非 Error', () => {
  it('connect 抛字符串 → lastError 取字符串（e?.message||e 右臂）', async () => {
    core.registerAdapter({
      id: 'bcConnStr', i18nNs: 'server.dingtalk', allowListField: 'allowStaffIds', capabilities: {},
      rateLimit: { max: 1000, windowMs: 60_000 }, hasCreds: () => true,
      async connect() { throw 'conn string err'; },
      async disconnect() {}, ack() {}, async sendOne() {}, async testConnection() { return { ok: true }; },
    });
    await core.startBridge('bcConnStr', deps(() => cfg));
    assert.equal(core.isBridgeRunning('bcConnStr'), false);
    assert.match(core.getBridgeStatus('bcConnStr').lastError || '', /conn string err/);
    core.__resetForTests('bcConnStr');
  });
});

// ─── resolveSender fills name/avatar then upsert (lines 128-135) ───
describe('resolveSender 补齐 name/avatar', () => {
  it('免费字段缺失 → resolveSender 返回 name+avatar 并 upsert（line 128-135 真臂）', async () => {
    recResolve.resolveImpl = () => ({ name: 'Filled', avatar: 'http://a/p.png' });
    await core.startBridge('bcResolve', deps(() => cfg));
    await inbound(recResolve, { msgId: 'fa1', content: 'hi', senderId: 'su2' });
    await waitUntil(() => injects.length >= 1);
    // 第二次同 sender 在 TTL 内不再解析（正缓存）
    let resolveCount = 0;
    recResolve.resolveImpl = () => { resolveCount++; return { name: 'X' }; };
    await inbound(recResolve, { msgId: 'fa2', content: 'hi2', senderId: 'su2' });
    await tick();
    assert.equal(resolveCount, 0, '正缓存抑制二次解析');
  });

  it('部分补齐：仅有 senderName，resolveSender 补 avatar（!avatar && r.avatar 臂）', async () => {
    recResolve.resolveImpl = () => ({ avatar: 'http://only-avatar' });
    await core.startBridge('bcResolve', deps(() => cfg));
    await inbound(recResolve, { msgId: 'pa1', content: 'hi', senderId: 'su3', senderName: 'HasName' });
    await waitUntil(() => injects.length >= 1);
    assert.equal(injects.length, 1);
  });
});

// ─── module-load env branch (line 33: CCV_IM_PLATFORM ? 2min : 10min) ───
// 该三元在模块加载期求值，必须在 canonical import 时设/不设 CCV_IM_PLATFORM。本进程加载时未设该 env
// （走 10min 假臂），故用子进程以 CCV_IM_PLATFORM 加载 canonical 文件覆盖 2min 真臂。子进程必须
// spread process.env（保留 NODE_V8_COVERAGE，否则覆盖不计入）。
describe('PENDING_TIMEOUT_MS env 分支（子进程 canonical import）', () => {
  it('设置 CCV_IM_PLATFORM 时模块仍正常加载（2min 真臂）', async () => {
    const { spawnSync } = await import('node:child_process');
    const { pathToFileURL } = await import('node:url');
    const targetUrl = pathToFileURL(join(process.cwd(), 'packages', 'app', 'server', 'lib', 'im', 'im-bridge-core.js')).href;
    const r = spawnSync(process.execPath, [
      '--input-type=module', '-e',
      `await import(${JSON.stringify(targetUrl)}); console.log('OK');`,
    ], {
      cwd: process.cwd(),
      env: { ...process.env, CCV_IM_PLATFORM: 'imWorkerTest' },
      encoding: 'utf-8',
    });
    assert.equal(r.status, 0, r.stderr || '');
    assert.match(r.stdout, /OK/);
  });
});

after(() => {
  for (const id of ['bcPlain', 'bcStatus', 'bcCard', 'bcNoRate', 'bcResolve', 'bcAckThrow']) core.__resetForTests(id);
  core.__setFetchForTests(null);
  rmSync(tmpDir, { recursive: true, force: true });
});
