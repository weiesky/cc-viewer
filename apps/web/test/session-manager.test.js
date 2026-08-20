/**
 * Unit tests for src/utils/sessionManager.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInPlaceLastMsgReplace,
  getSessionStableId,
  resolveDisplaySessions,
  getSessionActivityTs,
  getLatestSessionByActivity,
  resolveHydratedPin,
  runPinHydration,
  applyBatchEntryTimestamps,
} from '../src/utils/sessionManager.js';

// ─── Test helpers ─────────────────────────────────────────────────��───────────

function makeEntry(sessionId, ts, opts = {}) {
  return {
    _sessionId: sessionId,
    timestamp: ts,
    url: opts.url || 'https://api.anthropic.com/v1/messages',
    ...opts,
  };
}

function makeSession(msgCount, opts = {}) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    const content = opts.userText && role === 'user' && i === 0
      ? opts.userText
      : `msg-${i}`;
    messages.push({ role, content });
  }
  return {
    userId: opts.userId || 'user-1',
    messages,
    response: { status: 200, body: {} },
    entryTimestamp: opts.entryTimestamp || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// applyInPlaceLastMsgReplace — 信号驱动短路（消费服务端 _inPlaceReplaceDetected）
// 防 SUGGESTION MODE → 用户真实输入替换末位时 sessionMerge prefix-overlap 翻倍
// （实证 cc-viewer 自身复现：jsonl 中 _inPlaceReplaceDetected:true 与 BUG 1:1 对应）
// ─────────────────────────────────────────────────────────────────────────────

describe('applyInPlaceLastMsgReplace', () => {
  function makeMsg(role, text) {
    return { role, content: [{ type: 'text', text }], _timestamp: '2026-05-09T10:00:00Z' };
  }
  function makeSessionLocal(messages, userId = 'u1') {
    return { userId, messages, response: { status: 200, body: {} }, entryTimestamp: '2026-05-09T10:00:00Z' };
  }

  it('命中信号 → in-place 替换末位（前 N-1 引用稳定，长度不翻倍）', () => {
    const m0 = makeMsg('user', 'hi');
    const m1 = makeMsg('assistant', 'hello');
    const m2_old = makeMsg('user', '[SUGGESTION MODE: ...]');
    const session = makeSessionLocal([m0, m1, m2_old]);
    const prevSessions = [session];

    const m2_new = makeMsg('user', '继续关闭 @hunter-D');
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: { content: [] } },
      body: { messages: [m0, m1, m2_new] },  // length 3，跟 prev 一致
    };

    // 前置 invariant assert（防 fixture 漂移）：触发短路要求两边长度完全一致
    assert.equal(entry.body.messages.length, session.messages.length, 'fixture invariant: entry/session 长度必须相等');

    const result = applyInPlaceLastMsgReplace(prevSessions, entry, '2026-05-09T11:10:03Z', false);

    assert.equal(result.applied, true, '应该命中短路');
    assert.equal(result.sessions.length, 1, 'sessions 数组长度不变');
    const newLast = result.sessions[0];
    assert.equal(newLast.messages.length, 3, '末位 in-place 替换后长度仍 = 3（不翻倍）');
    assert.strictEqual(newLast.messages[0], m0, '前 N-1 条 message[0] 引用复用');
    assert.strictEqual(newLast.messages[1], m1, '前 N-1 条 message[1] 引用复用');
    assert.strictEqual(newLast.messages[2], m2_new, '末位用 entry.body.messages[N-1] 新引用');
    assert.notStrictEqual(newLast, session, 'lastSession 引用变化（让 ChatView _sessionItemCache 失效触发重渲染）');
  });

  it('未命中信号（无 _inPlaceReplaceDetected）→ applied=false 让 fallback 到 mergeMainAgentSessions', () => {
    const m0 = makeMsg('user', 'hi');
    const m1 = makeMsg('assistant', 'hello');
    const session = makeSessionLocal([m0, m1]);
    const entry = {
      _isCheckpoint: true,
      // _inPlaceReplaceDetected: undefined ← 故意不设
      timestamp: '2026-05-09T11:10:03Z',
      body: { messages: [m0, m1] },
    };

    const result = applyInPlaceLastMsgReplace([session], entry, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, false, '无信号字段时不应短路');
  });

  it('isNewSession=true → applied=false（不破坏新 session 起点语义）', () => {
    const m0 = makeMsg('user', 'fresh');
    const session = makeSessionLocal([m0]);
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      body: { messages: [m0] },
    };
    const result = applyInPlaceLastMsgReplace([session], entry, '2026-05-09T11:10:03Z', /*isNewSession*/ true);
    assert.equal(result.applied, false, 'isNewSession=true 时不应短路（让 mergeMainAgentSessions 处理新 session 起点）');
  });

  it('messages.length 不一致 → applied=false（防误吃增量 push 场景）', () => {
    const m0 = makeMsg('user', 'hi');
    const session = makeSessionLocal([m0]);
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      body: { messages: [m0, makeMsg('assistant', 'new')] },  // length 2 ≠ session.messages.length 1
    };
    const result = applyInPlaceLastMsgReplace([session], entry, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, false, '长度不一致时不应短路（普通 push 走 mergeMainAgentSessions 即可）');
  });

  it('空 prevSessions → applied=false（首条 entry 走 mergeMainAgentSessions 创建初始 session）', () => {
    const m0 = makeMsg('user', 'hi');
    const m1 = makeMsg('assistant', 'a');
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1] },
    };
    const result = applyInPlaceLastMsgReplace([], entry, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, false);
  });

  // 新增防御性 case（reviewer 采纳建议）：
  it('messages.length > currentLen → applied=false（防意外消费信号导致丢消息）', () => {
    const m0 = makeMsg('user', 'hi');
    const session = makeSessionLocal([m0]);
    const m1 = makeMsg('assistant', 'a');
    const m2 = makeMsg('user', 'q');
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1, m2] },  // length 3 > session.messages.length 1
    };
    const result = applyInPlaceLastMsgReplace([session], entry, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, false, '长度不一致（>）应 fallback 让 mergeMainAgentSessions 走增量 push');
  });

  it('entry.response 缺失（inProgress 异常）→ applied=false 防 ChatView Last Response 污染', () => {
    const m0 = makeMsg('user', 'hi');
    const m1 = makeMsg('assistant', 'a');
    const m2_old = makeMsg('user', 'old');
    const session = makeSessionLocal([m0, m1, m2_old]);
    const m2_new = makeMsg('user', 'new');
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      // response: undefined ← 故意省略
      body: { messages: [m0, m1, m2_new] },
    };
    const result = applyInPlaceLastMsgReplace([session], entry, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, false, '无 response 时不应短路（防 newLastSession.response=undefined 污染下游）');
  });

  it('messages.length < 2 → applied=false（单消息退化为完全替换不安全，让原路径处理）', () => {
    const m0_old = makeMsg('user', 'old');
    const session = makeSessionLocal([m0_old]);
    const m0_new = makeMsg('user', 'new');
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: {} },
      body: { messages: [m0_new] },  // length 1
    };
    const result = applyInPlaceLastMsgReplace([session], entry, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, false, 'N=1 时不应走 in-place 短路（前 N-1 退化为空 = 完全替换，不符合 helper 语义）');
  });

  // 新增（review R3 任务 2 缺口）：_inPlaceReplaceDetected:true 但 _isCheckpoint 缺失/false
  it('_inPlaceReplaceDetected=true 但 _isCheckpoint 缺失 → applied=false（双信号必须齐发）', () => {
    const m0 = makeMsg('user', 'hi');
    const m1 = makeMsg('assistant', 'old');
    const session = makeSessionLocal([m0, m1]);
    const m1_new = makeMsg('assistant', 'new');
    const entry = {
      _inPlaceReplaceDetected: true,
      // _isCheckpoint: undefined ← 故意省略，模拟服务端协议变更或漏写
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1_new] },
    };
    const result = applyInPlaceLastMsgReplace([session], entry, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, false, '双信号未齐发不应短路（防服务端协议变更下 in-place 误触发污染下游）');
  });

  // 新增（D 块）：fallback 计数器机制 — 信号到达但守卫拒绝时计数应增加
  it('fallback 计数器：信号到达但守卫拒绝时累加分类计数', () => {
    // 重置计数防本次 case 之前累积干扰
    applyInPlaceLastMsgReplace.fallbackCount = Object.create(null);
    applyInPlaceLastMsgReplace.appliedCount = 0;

    const m0 = makeMsg('user', 'hi');
    const session = makeSessionLocal([m0]);

    // 触发 length-mismatch 路径
    const entry1 = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: {} },
      body: { messages: [m0, makeMsg('assistant', 'a'), makeMsg('user', 'b')] },
    };
    applyInPlaceLastMsgReplace([session], entry1, '2026-05-09T11:10:03Z', false);
    assert.equal(applyInPlaceLastMsgReplace.fallbackCount['length-mismatch'], 1, 'length-mismatch 应计数');

    // 触发 response-missing 路径
    const session2 = makeSessionLocal([m0, makeMsg('assistant', 'a'), makeMsg('user', 'b')]);
    const entry2 = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      // response 缺失
      body: { messages: [m0, makeMsg('assistant', 'a'), makeMsg('user', 'c')] },
    };
    applyInPlaceLastMsgReplace([session2], entry2, '2026-05-09T11:10:03Z', false);
    assert.equal(applyInPlaceLastMsgReplace.fallbackCount['response-missing'], 1, 'response-missing 应计数');

    // 触发 messages-too-short 路径
    const entry3 = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: {} },
      body: { messages: [m0] },
    };
    applyInPlaceLastMsgReplace([session], entry3, '2026-05-09T11:10:03Z', false);
    assert.equal(applyInPlaceLastMsgReplace.fallbackCount['messages-too-short'], 1, 'messages-too-short 应计数');

    // 无信号路径不计数（防 SSE 高频流量淹没）
    const entry4 = {
      timestamp: '2026-05-09T11:10:03Z',
      body: { messages: [m0] },
    };
    applyInPlaceLastMsgReplace([session], entry4, '2026-05-09T11:10:03Z', false);
    assert.equal(applyInPlaceLastMsgReplace.fallbackCount['no-signal'], undefined, '无信号路径不应计入 fallbackCount');

    // applied 路径累加 appliedCount
    const session3 = makeSessionLocal([m0, makeMsg('assistant', 'old')]);
    const entry5 = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: '2026-05-09T11:10:03Z',
      response: { status: 200, body: {} },
      body: { messages: [m0, makeMsg('assistant', 'new')] },
    };
    const result = applyInPlaceLastMsgReplace([session3], entry5, '2026-05-09T11:10:03Z', false);
    assert.equal(result.applied, true);
    assert.equal(applyInPlaceLastMsgReplace.appliedCount, 1, 'applied 路径应累加 appliedCount');
  });
});

// ─── getSessionStableId ──────────────────────────────────────────────────────

// 构造一个带 messages[0]._timestamp 的热 session
function pinnedSession(startTs, msgCount = 2) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m${i}`, _timestamp: i === 0 ? startTs : `${startTs}#${i}` });
  }
  // entryTimestamp 故意设成「漂移后的最新 ts」，确保 stable id 不取它
  return { userId: 'u1', messages, response: { status: 200, body: {} }, entryTimestamp: `${startTs}#drifted` };
}

describe('getSessionStableId', () => {
  it('session 取 messages[0]._timestamp（而非漂移的 entryTimestamp）', () => {
    const s = pinnedSession('2025-01-01T00:00:00Z');
    assert.equal(getSessionStableId(s), '2025-01-01T00:00:00Z');
  });

  it('null / 空 session 返回 null', () => {
    assert.equal(getSessionStableId(null), null);
    assert.equal(getSessionStableId({ messages: [] }), null);
  });
});

// ─── resolveDisplaySessions ──────────────────────────────────────────────────

describe('resolveDisplaySessions', () => {
  const s0 = pinnedSession('2025-01-01T00:00:00Z');
  const s1 = pinnedSession('2025-01-01T01:00:00Z');
  const s2 = pinnedSession('2025-01-01T02:00:00Z');
  const sessions = [s0, s1, s2];

  it('本地日志模式（第三参数 false）→ 原样返回，无上界', () => {
    const r = resolveDisplaySessions(sessions, '2025-01-01T00:00:00Z', false);
    assert.equal(r.sessions, sessions);
    assert.equal(r.upperBoundTs, null);
  });

  it('无 pin → 原样返回', () => {
    const r = resolveDisplaySessions(sessions, null, true);
    assert.equal(r.sessions, sessions);
    assert.equal(r.upperBoundTs, null);
  });

  it('pin == 最新会话 → 原样返回（与今天行为一致，不切片）', () => {
    const r = resolveDisplaySessions(sessions, '2025-01-01T02:00:00Z', true);
    assert.equal(r.sessions, sessions);
    assert.equal(r.upperBoundTs, null);
  });

  it('pin 在中段 → 切到以 pin 会话结尾，上界 = 下一会话起点', () => {
    const r = resolveDisplaySessions(sessions, '2025-01-01T01:00:00Z', true);
    assert.deepEqual(r.sessions, [s0, s1]);
    assert.equal(r.sessions.length, 2);
    assert.equal(r.upperBoundTs, '2025-01-01T02:00:00Z');
  });

  it('mid-list pin that IS the latest-by-activity → sliced but NO upper bound (it is the current session)', () => {
    // Multi-terminal case: the pinned session sits mid-list by insertion order
    // but carries the newest activity. A non-null bound would suppress the live
    // streaming overlay and truncate trailing sub-agents on the current session.
    const mid = pinnedSession('2025-01-01T01:00:00Z');
    mid.entryTimestamp = '2025-01-01T09:00:00Z'; // newest activity
    const tail = pinnedSession('2025-01-01T02:00:00Z');
    tail.entryTimestamp = '2025-01-01T03:00:00Z';
    const list = [s0, mid, tail];
    const r = resolveDisplaySessions(list, '2025-01-01T01:00:00Z', true);
    assert.deepEqual(r.sessions, [s0, mid], 'still sliced to end at the pin');
    assert.equal(r.upperBoundTs, null, 'no strictly-newer session to bound against');
  });

  it('pin 是首个会话且有更晚会话 → 仅含该会话，上界 = 第二个会话起点', () => {
    const r = resolveDisplaySessions(sessions, '2025-01-01T00:00:00Z', true);
    assert.deepEqual(r.sessions, [s0]);
    assert.equal(r.upperBoundTs, '2025-01-01T01:00:00Z');
  });

  it('pin 已失效（不在列表）→ 回退原样（展示最新）', () => {
    const r = resolveDisplaySessions(sessions, '1999-01-01T00:00:00Z', true);
    assert.equal(r.sessions, sessions);
    assert.equal(r.upperBoundTs, null);
  });

  it('空列表 → 原样返回', () => {
    const r = resolveDisplaySessions([], '2025-01-01T00:00:00Z', true);
    assert.deepEqual(r.sessions, []);
    assert.equal(r.upperBoundTs, null);
  });
});

// ─── getSessionActivityTs ────────────────────────────────────────────────────

function hotSession(startTs, activityTs, opts = {}) {
  const s = makeSession(opts.msgCount || 4, { userId: opts.userId || 'user-1', entryTimestamp: activityTs });
  s.messages[0]._timestamp = startTs;
  return s;
}

describe('getSessionActivityTs', () => {
  it('hot session → entryTimestamp (drifts to newest merged entry by design)', () => {
    const s = hotSession('2026-07-01T00:00:00.000Z', '2026-07-01T05:00:00.000Z');
    assert.equal(getSessionActivityTs(s), '2026-07-01T05:00:00.000Z');
  });

  it('hot session without entryTimestamp → last message _timestamp', () => {
    const s = makeSession(3, { entryTimestamp: null });
    s.messages[2]._timestamp = '2026-07-01T02:00:00.000Z';
    assert.equal(getSessionActivityTs(s), '2026-07-01T02:00:00.000Z');
  });

  it('hot without entryTimestamp and without message ts → stable id fallback', () => {
    const s = makeSession(2, { entryTimestamp: null });
    s.messages[0]._timestamp = '2026-07-01T01:00:00.000Z'; // stable id, last msg unstamped
    assert.equal(getSessionActivityTs(s), '2026-07-01T01:00:00.000Z');
  });

  it('null session → null', () => {
    assert.equal(getSessionActivityTs(null), null);
  });
});

// ─── getLatestSessionByActivity ──────────────────────────────────────────────

describe('getLatestSessionByActivity', () => {
  it('Defect-1 regression: mid-list session with newer activity beats last-positioned older one', () => {
    // Interleaved multi-terminal merge order: session B was inserted last, but
    // session A received the most recent entry. "Last element" is the bug.
    const a = hotSession('2026-07-01T00:00:00.000Z', '2026-07-01T09:00:00.000Z');
    const b = hotSession('2026-07-01T01:00:00.000Z', '2026-07-01T08:00:00.000Z');
    assert.equal(getLatestSessionByActivity([a, b]), a);
  });

  it('suffix-truncated replay still resolves the true latest (not list tail)', () => {
    // Reconnect replays only the last N entries; whatever order the rebuilt list
    // has, the max-activity session must win. Simulate a 40-session interleave
    // where an early-positioned session carries the newest activity, then take a
    // suffix slice like the replay window does.
    const sessions = [];
    for (let i = 0; i < 40; i++) {
      sessions.push(hotSession(
        `2026-07-01T00:${String(i).padStart(2, '0')}:00.000Z`,
        `2026-07-01T10:${String(39 - i).padStart(2, '0')}:00.000Z`, // reverse: earliest position = newest activity
      ));
    }
    const windowed = sessions.slice(-25);
    assert.equal(getLatestSessionByActivity(windowed), windowed[0]);
  });

  it('null-activity session never hijacks the pick from a genuinely newer one', () => {
    // Regression: the old loop let a ts===null candidate always replace `best`
    // without advancing bestTs, so a timestamp-less session sitting after the
    // true latest would win — the exact wrong-anchor class this helper fixes.
    const a = hotSession('2026-07-01T00:00:00.000Z', '2026-07-01T09:00:00.000Z');
    const b = makeSession(2, { entryTimestamp: null }); // no usable ts anywhere
    const c = hotSession('2026-07-01T01:00:00.000Z', '2026-07-01T05:00:00.000Z');
    assert.equal(getLatestSessionByActivity([a, b]), a);
    assert.equal(getLatestSessionByActivity([a, b, c]), a);
  });

  it('all-null activity ts degrades to the last element (behavior preservation)', () => {
    const s1 = makeSession(2, { entryTimestamp: null });
    const s2 = makeSession(2, { entryTimestamp: null });
    assert.equal(getLatestSessionByActivity([s1, s2]), s2);
  });

  it('tie resolves to the later list position', () => {
    const ts = '2026-07-01T07:00:00.000Z';
    const s1 = hotSession('2026-07-01T00:00:00.000Z', ts);
    const s2 = hotSession('2026-07-01T01:00:00.000Z', ts);
    assert.equal(getLatestSessionByActivity([s1, s2]), s2);
  });

  it('empty / non-array → null', () => {
    assert.equal(getLatestSessionByActivity([]), null);
    assert.equal(getLatestSessionByActivity(null), null);
    assert.equal(getLatestSessionByActivity(undefined), null);
  });
});

// ─── resolveHydratedPin ──────────────────────────────────────────────────────

describe('resolveHydratedPin', () => {
  it('toggle off → adopt remote string as-is', () => {
    assert.deepEqual(resolveHydratedPin('t1', 't9', false), { adopt: true, value: 't1' });
  });

  it('toggle off → adopt remote null (and normalizes non-strings)', () => {
    assert.deepEqual(resolveHydratedPin(null, 't9', false), { adopt: true, value: null });
    assert.deepEqual(resolveHydratedPin(undefined, 't9', false), { adopt: true, value: null });
    assert.deepEqual(resolveHydratedPin('', 't9', false), { adopt: true, value: null });
    assert.deepEqual(resolveHydratedPin(42, 't9', false), { adopt: true, value: null });
  });

  it('toggle on + no derived latest (sessions not loaded) → adopt remote', () => {
    assert.deepEqual(resolveHydratedPin('t1', null, true), { adopt: true, value: 't1' });
  });

  it('toggle on + remote === derived → adopt', () => {
    assert.deepEqual(resolveHydratedPin('t9', 't9', true), { adopt: true, value: 't9' });
  });

  it('toggle on + stale remote → reject, value = derived latest', () => {
    assert.deepEqual(resolveHydratedPin('t1', 't9', true), { adopt: false, value: 't9' });
  });

  it('toggle on + remote null + derived exists → reject (derive locally)', () => {
    assert.deepEqual(resolveHydratedPin(null, 't9', true), { adopt: false, value: 't9' });
  });
});

// ─── runPinHydration ─────────────────────────────────────────────────────────

describe('runPinHydration', () => {
  function makeHarness({ remote, derived, effOnly = true, localPin = null, current = () => true }) {
    const calls = [];
    let resolveFetch;
    const fetchPromise = new Promise((res) => { resolveFetch = res; });
    const run = runPinHydration({
      fetchPin: () => fetchPromise,
      isCurrent: current,
      getDerived: () => derived,
      effOnly: () => effOnly,
      getLocalPin: () => localPin,
      adopt: (v) => calls.push(['adopt', v]),
      persistLocal: () => calls.push(['persist']),
      clearGate: () => calls.push(['clearGate']),
      selfHeal: () => calls.push(['selfHeal']),
    });
    return { calls, run, resolve: () => resolveFetch(remote) };
  }

  it('adopt path: remote differs from local → adopt(remote), then clearGate before selfHeal', async () => {
    const h = makeHarness({ remote: 't9', derived: 't9', localPin: 't1' });
    h.resolve();
    await h.run;
    assert.deepEqual(h.calls, [['adopt', 't9'], ['clearGate'], ['selfHeal']]);
  });

  it('adopt path: remote equals local → no adopt call (no redundant setState)', async () => {
    const h = makeHarness({ remote: 't9', derived: 't9', localPin: 't9' });
    h.resolve();
    await h.run;
    assert.deepEqual(h.calls, [['clearGate'], ['selfHeal']]);
  });

  it('gate is cleared BEFORE self-heal (inverted order would silently no-op follow-latest)', async () => {
    const h = makeHarness({ remote: 't1', derived: 't9', localPin: 't1' });
    h.resolve();
    await h.run;
    const gateIdx = h.calls.findIndex(c => c[0] === 'clearGate');
    const healIdx = h.calls.findIndex(c => c[0] === 'selfHeal');
    assert.ok(gateIdx !== -1 && healIdx !== -1 && gateIdx < healIdx,
      `clearGate must precede selfHeal, got ${JSON.stringify(h.calls)}`);
  });

  it('rejected stale remote + local already at derived → persistLocal (heals poisoned server pin)', async () => {
    const h = makeHarness({ remote: 't1', derived: 't9', localPin: 't9' });
    h.resolve();
    await h.run;
    assert.deepEqual(h.calls, [['persist'], ['clearGate'], ['selfHeal']]);
  });

  it('rejected stale remote + local NOT at derived → no persist here (selfHeal advances + persists)', async () => {
    const h = makeHarness({ remote: 't1', derived: 't9', localPin: 't5' });
    h.resolve();
    await h.run;
    assert.deepEqual(h.calls, [['clearGate'], ['selfHeal']]);
  });

  it('superseded GET is fully discarded — no adopt, no gate touch (newer round owns it)', async () => {
    const h = makeHarness({ remote: 't1', derived: 't9', localPin: 't9', current: () => false });
    h.resolve();
    await h.run;
    assert.deepEqual(h.calls, []);
  });

  it('supersession that happens between resolve and finally does not clear the newer gate', async () => {
    let currentFlag = true;
    const calls = [];
    let resolveFetch;
    const run = runPinHydration({
      fetchPin: () => new Promise((res) => { resolveFetch = res; }),
      isCurrent: () => currentFlag,
      getDerived: () => 't9',
      effOnly: () => true,
      getLocalPin: () => 't1',
      adopt: (v) => { calls.push(['adopt', v]); currentFlag = false; }, // superseded mid-flight
      persistLocal: () => calls.push(['persist']),
      clearGate: () => calls.push(['clearGate']),
      selfHeal: () => calls.push(['selfHeal']),
    });
    resolveFetch('t9');
    await run;
    assert.deepEqual(calls, [['adopt', 't9']]);
  });

  it('fetch rejection still clears the gate and self-heals', async () => {
    const calls = [];
    await runPinHydration({
      fetchPin: () => Promise.reject(new Error('network')),
      isCurrent: () => true,
      getDerived: () => 't9',
      effOnly: () => true,
      getLocalPin: () => 't1',
      adopt: () => calls.push(['adopt']),
      persistLocal: () => calls.push(['persist']),
      clearGate: () => calls.push(['clearGate']),
      selfHeal: () => calls.push(['selfHeal']),
    });
    assert.deepEqual(calls, [['clearGate'], ['selfHeal']]);
  });

  it('toggle off → adopts remote verbatim even when derived differs', async () => {
    const h = makeHarness({ remote: 't1', derived: 't9', localPin: 't9', effOnly: false });
    h.resolve();
    await h.run;
    assert.deepEqual(h.calls, [['adopt', 't1'], ['clearGate'], ['selfHeal']]);
  });
});

// ─── applyBatchEntryTimestamps ───────────────────────────────────────────────

describe('applyBatchEntryTimestamps', () => {
  function freshSt() {
    return { timestamps: [], generatedTimestamps: [], currentSessionId: null, prevUserId: null, prevMainAgentTs: null };
  }

  function batchEntry(msgCount, ts, { userId = 'u1', firstText = 'hello', slimmed = false, compactFlag } = {}) {
    const messages = [];
    for (let i = 0; i < msgCount; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: i === 0 ? firstText : `m${i}` });
    }
    const e = {
      timestamp: ts,
      mainAgent: true,
      body: { messages: slimmed ? [] : messages, metadata: { user_id: userId } },
    };
    if (slimmed) { e._slimmed = true; e._messageCount = msgCount; }
    if (compactFlag !== undefined) e._compactContinuation = compactFlag;
    return e;
  }

  it('first entry seeds currentSessionId and stamps all positions with its ts', () => {
    const st = freshSt();
    const e = batchEntry(4, '2026-07-01T00:00:00.000Z');
    applyBatchEntryTimestamps(st, e);
    assert.equal(st.currentSessionId, '2026-07-01T00:00:00.000Z');
    assert.equal(st.timestamps.length, 4);
    assert.equal(e.body.messages[0]._timestamp, '2026-07-01T00:00:00.000Z');
  });

  it('same-session growth extends without resetting (positions keep first-seen ts)', () => {
    const st = freshSt();
    applyBatchEntryTimestamps(st, batchEntry(4, '2026-07-01T00:00:00.000Z'));
    const e2 = batchEntry(6, '2026-07-01T00:05:00.000Z');
    applyBatchEntryTimestamps(st, e2);
    assert.equal(st.currentSessionId, '2026-07-01T00:00:00.000Z');
    assert.equal(e2.body.messages[0]._timestamp, '2026-07-01T00:00:00.000Z');
    assert.equal(e2.body.messages[5]._timestamp, '2026-07-01T00:05:00.000Z');
  });

  it('new-terminal bigDrop (count > 4) resets: new session id = entry ts', () => {
    const st = freshSt();
    applyBatchEntryTimestamps(st, batchEntry(30, '2026-07-01T00:00:00.000Z'));
    const e2 = batchEntry(6, '2026-07-01T01:00:00.000Z', { firstText: 'new terminal prompt' });
    applyBatchEntryTimestamps(st, e2);
    assert.equal(st.currentSessionId, '2026-07-01T01:00:00.000Z');
    assert.equal(st.timestamps.length, 6);
    assert.equal(e2.body.messages[0]._timestamp, '2026-07-01T01:00:00.000Z');
  });

  it('transient short entry (<=4 msgs after long) does NOT reset', () => {
    const st = freshSt();
    applyBatchEntryTimestamps(st, batchEntry(30, '2026-07-01T00:00:00.000Z'));
    applyBatchEntryTimestamps(st, batchEntry(2, '2026-07-01T01:00:00.000Z', { firstText: 'quick q' }));
    assert.equal(st.currentSessionId, '2026-07-01T00:00:00.000Z');
    assert.equal(st.timestamps.length, 30);
  });

  it('slimmed compact continuation (_compactContinuation:true) does NOT reset and truncates accumulators', () => {
    // The P0 scenario: slim pass emptied the compact entry's messages before the
    // batch boundary check; the stamped flag must (a) prevent a session split and
    // (b) truncate positional ts so post-compact growth gets fresh timestamps.
    const st = freshSt();
    applyBatchEntryTimestamps(st, batchEntry(30, '2026-07-01T00:00:00.000Z'));
    const compact = batchEntry(10, '2026-07-01T02:00:00.000Z', { slimmed: true, compactFlag: true });
    applyBatchEntryTimestamps(st, compact);
    assert.equal(st.currentSessionId, '2026-07-01T00:00:00.000Z', 'compact must not split the session');
    assert.equal(st.timestamps.length, 10, 'accumulators truncated to compact length');
    const e3 = batchEntry(12, '2026-07-01T03:00:00.000Z');
    applyBatchEntryTimestamps(st, e3);
    assert.equal(e3.body.messages[0]._timestamp, '2026-07-01T00:00:00.000Z', 'stable id preserved');
    assert.equal(e3.body.messages[11]._timestamp, '2026-07-01T03:00:00.000Z', 'post-compact growth gets fresh ts');
  });

  it('user_id change with an established session resets (new session)', () => {
    const st = freshSt();
    applyBatchEntryTimestamps(st, batchEntry(20, '2026-07-01T00:00:00.000Z', { userId: 'u1' }));
    const e2 = batchEntry(25, '2026-07-01T01:00:00.000Z', { userId: 'u2' });
    applyBatchEntryTimestamps(st, e2);
    assert.equal(st.currentSessionId, '2026-07-01T01:00:00.000Z');
    assert.equal(e2.body.messages[0]._timestamp, '2026-07-01T01:00:00.000Z');
  });
});
