/**
 * branch coverage 补强：src/utils/sessionManager.js
 *
 * 专攻 single-run 口径下未覆盖的分支：
 *   - _bumpFb trace 路径（__CCV_SESSIONMERGE_TRACE__=true）的 console.warn + 内嵌三元（326-334）
 *   - applyInPlaceLastMsgReplace 末位 _timestamp 赋值分支 / appliedCount cap 分支
 *
 * 规则：仅用 _shims/register.mjs + 动态 import 加载目标模块（Vite 风格无扩展名 import）。
 * mock 的 console.warn / globalThis flag 在 after() 还原。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';

let SM;
before(async () => {
  SM = await import('../src/utils/sessionManager.js');
});

// ─── applyInPlaceLastMsgReplace 末位 _timestamp / appliedCount 分支 ──────────

describe('applyInPlaceLastMsgReplace 末位时间戳 & 计数 cap 分支', () => {
  function makeMsg(role, text, ts) {
    const m = { role, content: [{ type: 'text', text }] };
    if (ts) m._timestamp = ts;
    return m;
  }
  function makeSessionLocal(messages) {
    return { userId: 'u1', messages, response: { status: 200, body: {} }, entryTimestamp: 'T0' };
  }

  it('末位 newLastMsg 无 _timestamp → 赋 timestamp 参数（覆盖 if (...!_timestamp) true 臂）', () => {
    const m0 = makeMsg('user', 'hi', 'TA');
    const m1_old = makeMsg('assistant', 'old', 'TB');
    const session = makeSessionLocal([m0, m1_old]);
    const m1_new = makeMsg('assistant', 'new'); // 故意不带 _timestamp
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: 'T-new',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1_new] },
    };
    const result = SM.applyInPlaceLastMsgReplace([session], entry, 'T-new', false);
    assert.equal(result.applied, true);
    assert.equal(result.sessions[0].messages[1]._timestamp, 'T-new', '末位 msg 无 _timestamp → 赋传入 timestamp');
  });

  it('末位 newLastMsg 已有 _timestamp → 不覆盖（覆盖 if (...!_timestamp) false 臂）', () => {
    const m0 = makeMsg('user', 'hi', 'TA');
    const m1_old = makeMsg('assistant', 'old', 'TB');
    const session = makeSessionLocal([m0, m1_old]);
    const m1_new = makeMsg('assistant', 'new', 'TEXISTING'); // 已带 _timestamp
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: 'T-new',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1_new] },
    };
    const result = SM.applyInPlaceLastMsgReplace([session], entry, 'T-new', false);
    assert.equal(result.applied, true);
    assert.equal(result.sessions[0].messages[1]._timestamp, 'TEXISTING', '已有 _timestamp 不被覆盖');
  });

  it('appliedCount 已达 cap(9999) → 不再自增（覆盖 if (appliedCount < 9999) false 臂）', () => {
    const saved = SM.applyInPlaceLastMsgReplace.appliedCount;
    try {
      SM.applyInPlaceLastMsgReplace.appliedCount = 9999;
      const m0 = makeMsg('user', 'hi', 'TA');
      const m1_old = makeMsg('assistant', 'old', 'TB');
      const session = makeSessionLocal([m0, m1_old]);
      const m1_new = makeMsg('assistant', 'new', 'TC');
      const entry = {
        _isCheckpoint: true,
        _inPlaceReplaceDetected: true,
        timestamp: 'T-new',
        response: { status: 200, body: {} },
        body: { messages: [m0, m1_new] },
      };
      const result = SM.applyInPlaceLastMsgReplace([session], entry, 'T-new', false);
      assert.equal(result.applied, true);
      assert.equal(SM.applyInPlaceLastMsgReplace.appliedCount, 9999, 'cap 命中后计数不再增长');
    } finally {
      SM.applyInPlaceLastMsgReplace.appliedCount = saved;
    }
  });

  it('fallbackCount 某 reason 已达 cap(9999) → 不再自增（覆盖 if (cur < 9999) false 臂）', () => {
    const savedFb = SM.applyInPlaceLastMsgReplace.fallbackCount;
    try {
      const fb = Object.create(null);
      fb['length-mismatch'] = 9999;
      SM.applyInPlaceLastMsgReplace.fallbackCount = fb;
      const m0 = makeMsg('user', 'hi', 'TA');
      const session = makeSessionLocal([m0]);
      // 触发 length-mismatch（messages 长度 != session.messages 长度）
      const entry = {
        _isCheckpoint: true,
        _inPlaceReplaceDetected: true,
        timestamp: 'T-new',
        response: { status: 200, body: {} },
        body: { messages: [m0, makeMsg('assistant', 'a', 'TB'), makeMsg('user', 'b', 'TC')] },
      };
      const result = SM.applyInPlaceLastMsgReplace([session], entry, 'T-new', false);
      assert.equal(result.applied, false);
      assert.equal(fb['length-mismatch'], 9999, 'cap 命中后 fallback 计数不再增长');
    } finally {
      SM.applyInPlaceLastMsgReplace.fallbackCount = savedFb;
    }
  });
});

// ─── _bumpFb trace 路径（__CCV_SESSIONMERGE_TRACE__=true）────────────────────

describe('applyInPlaceLastMsgReplace trace 路径（console.warn + 内嵌三元）', () => {
  let savedWarn;
  let savedFlag;
  let warnCalls;

  before(() => {
    savedWarn = console.warn;
    savedFlag = globalThis.__CCV_SESSIONMERGE_TRACE__;
    warnCalls = [];
    // eslint-disable-next-line no-console
    console.warn = (...args) => { warnCalls.push(args); };
    globalThis.__CCV_SESSIONMERGE_TRACE__ = true;
  });

  after(() => {
    // eslint-disable-next-line no-console
    console.warn = savedWarn;
    if (savedFlag === undefined) {
      delete globalThis.__CCV_SESSIONMERGE_TRACE__;
    } else {
      globalThis.__CCV_SESSIONMERGE_TRACE__ = savedFlag;
    }
  });

  function makeMsg(role, text, ts) {
    const m = { role, content: [{ type: 'text', text }] };
    if (ts) m._timestamp = ts;
    return m;
  }
  function makeSessionLocal(messages) {
    return { userId: 'u1', messages, response: { status: 200, body: {} }, entryTimestamp: 'T0' };
  }

  it('trace ON + 守卫拒绝（length-mismatch）→ console.warn 被调用，含 body.messages 数组臂', () => {
    warnCalls.length = 0;
    const m0 = makeMsg('user', 'hi', 'TA');
    const session = makeSessionLocal([m0]);
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: 'TS-trace',
      response: { status: 200, body: {} },
      // body.messages 是数组 → 覆盖 msgLen 三元的 true 臂；长度 2 != 1 触发 length-mismatch
      body: { messages: [m0, makeMsg('assistant', 'a', 'TB')] },
    };
    const result = SM.applyInPlaceLastMsgReplace([session], entry, 'TS-trace', false);
    assert.equal(result.applied, false);
    assert.equal(warnCalls.length, 1, 'trace ON 时 fallback 应触发 console.warn');
    const [msg, payload] = warnCalls[0];
    assert.match(msg, /length-mismatch/, 'warn 消息含 reason');
    assert.equal(payload.ts, 'TS-trace');
    assert.equal(payload.hasSignal, true);
    assert.equal(payload.isCheckpoint, true);
    assert.equal(payload.msgLen, 2, 'body.messages 为数组 → msgLen 三元 true 臂取 .length');
    assert.equal(payload.lastSessionLen, 1, 'prevSessions 末 session messages 为数组 → lastSessionLen 取长度');
  });

  it('trace ON + body.messages 非数组 → msgLen 三元 false 臂取 null', () => {
    warnCalls.length = 0;
    const m0 = makeMsg('user', 'hi', 'TA');
    const m1 = makeMsg('assistant', 'old', 'TB');
    const session = makeSessionLocal([m0, m1]);
    // body.messages 非数组（但仍命中信号），守卫在 messages-too-short 处拒绝
    // 注意：entry.body.messages 用于 helper 内 messages 计算时 Array.isArray 判定，
    // 这里给个非数组让主逻辑得到 messages=null → messages-too-short
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: 'TS-trace2',
      response: { status: 200, body: {} },
      body: { messages: 'not-an-array' },
    };
    const result = SM.applyInPlaceLastMsgReplace([session], entry, 'TS-trace2', false);
    assert.equal(result.applied, false);
    assert.equal(warnCalls.length, 1);
    const payload = warnCalls[0][1];
    assert.equal(payload.msgLen, null, 'body.messages 非数组 → msgLen 三元 false 臂为 null');
    assert.equal(payload.lastSessionLen, 2);
  });

  it('trace ON + prevSessions 为空 → lastSessionLen 三元 false 臂取 null', () => {
    warnCalls.length = 0;
    const m0 = makeMsg('user', 'hi', 'TA');
    const m1 = makeMsg('assistant', 'a', 'TB');
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: 'TS-trace3',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1] },
    };
    // prevSessions=[] → no-prev-sessions fallback；lastSessionLen 三元短路为 null
    const result = SM.applyInPlaceLastMsgReplace([], entry, 'TS-trace3', false);
    assert.equal(result.applied, false);
    assert.equal(warnCalls.length, 1);
    const [msg, payload] = warnCalls[0];
    assert.match(msg, /no-prev-sessions/);
    assert.equal(payload.lastSessionLen, null, 'prevSessions 空 → lastSessionLen null');
    assert.equal(payload.msgLen, 2);
  });

  it('trace ON + last session messages 非数组 → lastSessionLen 三元 false 臂取 null', () => {
    warnCalls.length = 0;
    const m0 = makeMsg('user', 'hi', 'TA');
    const m1 = makeMsg('assistant', 'a', 'TB');
    // 末 session.messages 非数组 → no-last-session-messages fallback
    const badSession = { userId: 'u', messages: null, response: {}, entryTimestamp: 'T0' };
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: 'TS-trace4',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1] },
    };
    const result = SM.applyInPlaceLastMsgReplace([badSession], entry, 'TS-trace4', false);
    assert.equal(result.applied, false);
    assert.equal(warnCalls.length, 1);
    const [msg, payload] = warnCalls[0];
    assert.match(msg, /no-last-session-messages/);
    assert.equal(payload.lastSessionLen, null, '末 session messages 非数组 → lastSessionLen null');
  });

  it('trace ON + isNewSession 拒绝 → new-session reason 也触发 warn', () => {
    warnCalls.length = 0;
    const m0 = makeMsg('user', 'hi', 'TA');
    const m1 = makeMsg('assistant', 'a', 'TB');
    const session = makeSessionLocal([m0, m1]);
    const entry = {
      _isCheckpoint: true,
      _inPlaceReplaceDetected: true,
      timestamp: 'TS-trace5',
      response: { status: 200, body: {} },
      body: { messages: [m0, m1] },
    };
    const result = SM.applyInPlaceLastMsgReplace([session], entry, 'TS-trace5', /*isNewSession*/ true);
    assert.equal(result.applied, false);
    assert.equal(warnCalls.length, 1);
    assert.match(warnCalls[0][0], /new-session/);
  });
});

// ─── assignMessageTimestamps 守卫分支补强 ──────────────────────────────────

describe('assignMessageTimestamps 元素级守卫分支', () => {
  it('messages 含 null/undefined 元素 → continue 跳过（覆盖 if (!m) continue）', () => {
    const messages = [null, { role: 'user', content: 'a' }, undefined];
    const result = SM.assignMessageTimestamps(messages, [], false, 0, 'T1', null);
    assert.equal(result[1]._timestamp, 'T1');
    assert.equal(result[0], null);
    assert.equal(result[2], undefined);
  });

  it('i < prevCount 但 prevMessages[i] 缺失 → 走新增分支而非继承', () => {
    // prevCount=2 但 prevMessages 只有 1 个有效元素（[i] 为 null）
    const prev = [{ role: 'user', content: 'x', _timestamp: 'TP' }, null];
    const m0 = { role: 'user', content: 'a' };
    const m1 = { role: 'assistant', content: 'b' };
    const messages = [m0, m1];
    SM.assignMessageTimestamps(messages, prev, false, 2, 'TNOW', 'TPREV');
    // i=0: 继承 prev[0]._timestamp
    assert.equal(m0._timestamp, 'TP');
    // i=1: prevMessages[1]=null → 条件 false → 新增分支 → currentTs；assistant + prevMainAgentTs → _generatedTs
    assert.equal(m1._timestamp, 'TNOW');
    assert.equal(m1._generatedTs, 'TPREV');
  });

  it('i < prevCount 且 prevMessages[i] 存在但无 _timestamp → 走新增分支', () => {
    const prev = [{ role: 'user', content: 'x' }]; // 无 _timestamp
    const m0 = { role: 'user', content: 'a' };
    const messages = [m0];
    SM.assignMessageTimestamps(messages, prev, false, 1, 'TNOW', null);
    assert.equal(m0._timestamp, 'TNOW', 'prev[i] 无 _timestamp → 不继承，赋 currentTs');
  });

  it('历史继承分支：prev 有 _generatedTs → 继承（覆盖 if (prevMessages[i]._generatedTs) true 臂）', () => {
    const prev = [{ role: 'assistant', content: 'x', _timestamp: 'TP', _generatedTs: 'TG' }];
    const m0 = { role: 'assistant', content: 'a' };
    SM.assignMessageTimestamps([m0], prev, false, 1, 'TNOW', 'TPREV');
    assert.equal(m0._timestamp, 'TP');
    assert.equal(m0._generatedTs, 'TG', '继承 prev 的 _generatedTs');
  });

  it('历史继承分支：prev 无 _generatedTs → 不赋（覆盖 if (prevMessages[i]._generatedTs) false 臂）', () => {
    const prev = [{ role: 'assistant', content: 'x', _timestamp: 'TP' }]; // 无 _generatedTs
    const m0 = { role: 'assistant', content: 'a' };
    SM.assignMessageTimestamps([m0], prev, false, 1, 'TNOW', 'TPREV');
    assert.equal(m0._timestamp, 'TP');
    assert.equal(m0._generatedTs, undefined, 'prev 无 _generatedTs → 不补');
  });

  it('新增 assistant 但 prevMainAgentTs=null → 不赋 _generatedTs（覆盖 && prevMainAgentTs false 臂）', () => {
    const m0 = { role: 'assistant', content: 'a' };
    SM.assignMessageTimestamps([m0], [], false, 0, 'TNOW', null);
    assert.equal(m0._timestamp, 'TNOW');
    assert.equal(m0._generatedTs, undefined);
  });

  it('已有 _timestamp 的 assistant 但 prevMainAgentTs=null → 不补 _generatedTs（覆盖最后 elif && 末臂）', () => {
    const m0 = { role: 'assistant', content: 'a', _timestamp: 'TEXIST' };
    SM.assignMessageTimestamps([m0], [], false, 0, 'TNOW', null);
    assert.equal(m0._timestamp, 'TEXIST', '不覆盖');
    assert.equal(m0._generatedTs, undefined, 'prevMainAgentTs=null → 不补 _generatedTs');
  });

  it('已有 _timestamp 且已有 _generatedTs 的 assistant → 不重复补（覆盖 !m._generatedTs false 臂）', () => {
    const m0 = { role: 'assistant', content: 'a', _timestamp: 'TEXIST', _generatedTs: 'TGEXIST' };
    SM.assignMessageTimestamps([m0], [], false, 0, 'TNOW', 'TPREV');
    assert.equal(m0._generatedTs, 'TGEXIST', '已有 _generatedTs 不被改');
  });

  it('已有 _timestamp 的 user msg（非 assistant）→ 不进入末 elif', () => {
    const m0 = { role: 'user', content: 'a', _timestamp: 'TEXIST' };
    SM.assignMessageTimestamps([m0], [], false, 0, 'TNOW', 'TPREV');
    assert.equal(m0._timestamp, 'TEXIST');
    assert.equal(m0._generatedTs, undefined);
  });
});

// ─── resolveBubbleProducerTs 兜底分支 ──────────────────────────────────────

describe('resolveBubbleProducerTs 兜底分支', () => {
  it('assistant 无 _generatedTs 无 _timestamp → null（覆盖 || || null 末臂）', () => {
    assert.equal(SM.resolveBubbleProducerTs({ role: 'assistant' }), null);
  });
  it('assistant 有 _generatedTs → 直接返回（短路第一臂）', () => {
    assert.equal(SM.resolveBubbleProducerTs({ role: 'assistant', _generatedTs: 'TG', _timestamp: 'TT' }), 'TG');
  });
  it('非 assistant 无 _timestamp → null（覆盖 _timestamp || null 末臂）', () => {
    assert.equal(SM.resolveBubbleProducerTs({ role: 'user' }), null);
  });
});
