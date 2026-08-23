/**
 * 分支覆盖补强：src/utils/sessionMerge.js
 * 目标：messageFingerprint 全 type 分支 + 各 ||/?? 默认 + catch；
 *       findReverseAnchor 空入参 / 空 fp 锚点 / 多块校验失败再成功 / null；
 *       mergeMainAgentSessions 各合并路径(no-op/append/rebuild/等长/前缀扩展/新会话/checkpoint/transient)。
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let mergeMainAgentSessions;
let messageFingerprint;

before(async () => {
  const mod = await import('../src/utils/sessionMerge.js');
  mergeMainAgentSessions = mod.mergeMainAgentSessions;
  messageFingerprint = mod.messageFingerprint;
});

// ─── helpers ──────────────────────────────────────────────────────────────
function strMsg(role, text, opts = {}) {
  return { role, content: text, ...opts };
}
function blockMsg(role, blocks, opts = {}) {
  return { role, content: blocks, ...opts };
}
function makeEntry(messages, opts = {}) {
  return {
    timestamp: opts.timestamp || '2026-01-01T00:00:00.000Z',
    _isCheckpoint: opts._isCheckpoint,
    body: {
      messages,
      metadata: 'noMeta' in opts ? undefined : { user_id: 'userId' in opts ? opts.userId : 'user-1' },
    },
    response: opts.response || { status: 200, body: {} },
  };
}
function makeSession(messages, opts = {}) {
  return {
    userId: 'userId' in opts ? opts.userId : 'user-1',
    messages,
    response: { status: 200, body: {} },
    entryTimestamp: opts.entryTimestamp || null,
  };
}

// ─── messageFingerprint：每个 type 分支 + 默认值两臂 + 异常 ──────────────────
describe('messageFingerprint 分支全覆盖', () => {
  it('msg 为 null / 缺 role 返回空串', () => {
    assert.equal(messageFingerprint(null), '');
    assert.equal(messageFingerprint({ content: 'x' }), '');
  });

  it('string content 走 |s| 指纹', () => {
    const fp = messageFingerprint({ role: 'user', content: 'hello' });
    assert.equal(fp, 'user|s|5|hello|hello');
  });

  it('content 非数组 / 空数组 走 |empty', () => {
    assert.equal(messageFingerprint({ role: 'user', content: 123 }), 'user|empty');
    assert.equal(messageFingerprint({ role: 'user', content: [] }), 'user|empty');
  });

  it('tool_use：id 优先', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'tool_use', id: 'tu1', name: 'Read' }])),
      'assistant|tu|tu1'
    );
  });

  it('tool_use：无 id 退化到 name', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'tool_use', name: 'Read' }])),
      'assistant|tu|Read'
    );
  });

  it('tool_use：无 id 无 name 退化到空串', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'tool_use' }])),
      'assistant|tu|'
    );
  });

  it('tool_result：有 tool_use_id', () => {
    assert.equal(
      messageFingerprint(blockMsg('user', [{ type: 'tool_result', tool_use_id: 'tr1' }])),
      'user|tr|tr1'
    );
  });

  it('tool_result：无 tool_use_id 退化空串', () => {
    assert.equal(
      messageFingerprint(blockMsg('user', [{ type: 'tool_result' }])),
      'user|tr|'
    );
  });

  it('text：有 text', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'text', text: 'abc' }])),
      'assistant|t|3|abc|abc'
    );
  });

  it('text：text 缺省退化空串(|| 右臂)', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'text' }])),
      'assistant|t|0||'
    );
  });

  it('thinking：有 thinking', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'thinking', thinking: 'mmm' }])),
      'assistant|th|3|mmm|mmm'
    );
  });

  it('thinking：thinking 缺省退化空串(|| 右臂)', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'thinking' }])),
      'assistant|th|0||'
    );
  });

  it('未知 type 走 |type', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ type: 'image' }])),
      'assistant|image'
    );
  });

  it('block 无 type 走 unknown(|| 右臂)', () => {
    assert.equal(
      messageFingerprint(blockMsg('assistant', [{ foo: 1 }])),
      'assistant|unknown'
    );
  });

  it('content getter 抛错 → catch 返回空串', () => {
    const evil = {
      role: 'user',
      get content() { throw new Error('boom'); },
    };
    assert.equal(messageFingerprint(evil), '');
  });
});

// ─── mergeMainAgentSessions 各合并路径 ───────────────────────────────────────
describe('mergeMainAgentSessions 分支', () => {
  it('prevSessions 为空 → 创建首个 session', () => {
    const msgs = [strMsg('user', 'q1')];
    const out = mergeMainAgentSessions([], makeEntry(msgs));
    assert.equal(out.length, 1);
    assert.equal(out[0].userId, 'user-1');
    assert.deepEqual(out[0].messages, msgs);
  });

  it('metadata 缺失 → userId 为 null，落到新会话分支', () => {
    const prev = [makeSession([strMsg('user', 'a'), strMsg('assistant', 'b')])];
    const out = mergeMainAgentSessions(prev, makeEntry([strMsg('user', 'x')], { noMeta: true }));
    // userId=null 与 lastSession.userId='user-1' 不等，且非 isPostClearCheckpoint → else 新会话
    assert.equal(out.length, 2);
    assert.equal(out[1].userId, null);
  });

  it('isPostClearCheckpoint 命中 → 追加新会话并补 _timestamp', () => {
    const prev = [makeSession([strMsg('user', '1'), strMsg('assistant', '2'),
      strMsg('user', '3'), strMsg('assistant', '4'), strMsg('user', '5')])];
    const clearMsg = blockMsg('user', [{ type: 'text', text: '<command-name>/clear</command-name>' }]);
    const entry = makeEntry([clearMsg], { _isCheckpoint: true, timestamp: '2026-02-02T00:00:00.000Z' });
    const out = mergeMainAgentSessions(prev, entry);
    assert.equal(out.length, 2);
    assert.equal(out[1].messages[0]._timestamp, '2026-02-02T00:00:00.000Z');
  });

  it('isPostClearCheckpoint：已有 _timestamp 不覆盖', () => {
    const prev = [makeSession([strMsg('user', '1'), strMsg('assistant', '2'),
      strMsg('user', '3'), strMsg('assistant', '4'), strMsg('user', '5')])];
    const clearMsg = blockMsg('user', [{ type: 'text', text: '<command-name>/clear</command-name>' }],
      { _timestamp: 'KEEP' });
    const entry = makeEntry([clearMsg], { _isCheckpoint: true });
    const out = mergeMainAgentSessions(prev, entry);
    assert.equal(out[1].messages[0]._timestamp, 'KEEP');
  });

  it('transient 过滤：新会话且极短 → 原样返回 prevSessions', () => {
    const longPrev = [];
    for (let i = 0; i < 10; i++) longPrev.push(strMsg('user', 'm' + i));
    const prev = [makeSession(longPrev)];
    // newMessages.length=1 < 10*0.5 且 10-1>4 → isNewConversation；且 <=4 且 prev>4 → transient
    const out = mergeMainAgentSessions(prev, makeEntry([strMsg('user', 'tiny')]));
    assert.equal(out, prev); // 引用相等：原样返回
  });

  it('skipTransientFilter=true 时跳过 transient 过滤', () => {
    const longPrev = [];
    for (let i = 0; i < 10; i++) longPrev.push(strMsg('user', 'm' + i));
    const prev = [makeSession(longPrev)];
    const out = mergeMainAgentSessions(prev, makeEntry([strMsg('user', 'tiny')]), { skipTransientFilter: true });
    // 不再 transient 返回；isNewConversation=true 但 sameUser 仍 true → 进合并；
    // newLen(1) < curLen(10) 且 anchor 未命中 → rebuild
    assert.notEqual(out, prev);
    assert.equal(out[0].messages.length, 1);
  });

  it('anchor 命中且 overlapLen<newLen → push tail(增量)，引用稳定', () => {
    const existing = [strMsg('user', 'q1'), strMsg('assistant', 'a1')];
    const session = makeSession(existing);
    const newMsgs = [strMsg('user', 'q1'), strMsg('assistant', 'a1'),
      strMsg('user', 'q2'), strMsg('assistant', 'a2')];
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs, { timestamp: '2026-03-03T00:00:00.000Z' }));
    assert.equal(out[0].messages, existing); // 引用不动
    assert.equal(out[0].messages.length, 4);
    assert.equal(out[0].messages[2]._timestamp, '2026-03-03T00:00:00.000Z');
  });

  it('anchor 命中且 overlapLen===newLen → 流式 no-op，长度不变', () => {
    const existing = [strMsg('user', 'q1'), strMsg('assistant', 'a1'), strMsg('user', 'q2')];
    const session = makeSession(existing);
    const newMsgs = [strMsg('user', 'q1'), strMsg('assistant', 'a1')];
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs));
    assert.equal(out[0].messages.length, 3);
    assert.equal(out[0].messages, existing);
  });

  it('anchor 命中：增量已有 _timestamp 不覆盖', () => {
    const existing = [strMsg('user', 'q1')];
    const session = makeSession(existing);
    const tailMsg = strMsg('assistant', 'a1', { _timestamp: 'PRE' });
    const newMsgs = [strMsg('user', 'q1'), tailMsg];
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs));
    assert.equal(out[0].messages[1]._timestamp, 'PRE');
  });

  it('anchor 未命中 + newLen<curLen → rebuild 替换引用', () => {
    const existing = [strMsg('user', 'a'), strMsg('assistant', 'b'), strMsg('user', 'c')];
    const session = makeSession(existing);
    // compact summary：newMessages[0] 与 existing 任何位置都不等价
    const newMsgs = [strMsg('user', 'SUMMARY')];
    // newLen=1 < curLen=3，但 isNewConversation 需 (3-1)>4 → false，故不会 transient，进合并
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs, { timestamp: 'T1' }));
    assert.notEqual(out[0].messages, existing); // 引用被替换
    assert.equal(out[0].messages.length, 1);
    assert.equal(out[0].messages[0]._timestamp, 'T1');
  });

  it('anchor 未命中 + newLen===curLen → 整段 append(Plan Mode)', () => {
    const existing = [strMsg('user', 'x'), strMsg('assistant', 'y')];
    const session = makeSession(existing);
    const newMsgs = [strMsg('user', 'p1'), strMsg('assistant', 'p2')];
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs, { timestamp: 'T2' }));
    assert.equal(out[0].messages.length, 4);
    assert.equal(out[0].messages[2]._timestamp, 'T2');
  });

  it('anchor 未命中 + newLen>curLen + 零公共前缀 → LCP 扩展退化为整段替换（wire 真相）', () => {
    const existing = [strMsg('user', 'x')];
    const session = makeSession(existing);
    // newMsgs[0]='DIFF' 不匹配 existing[0]，L=0 → 截断旧尾部后整段替换为 wire 内容。
    // （旧语义保留 x 再 push t1,t2，产生 [x,t1,t2] 混杂尾部——中断分叉修复后该形态
    // 与 _partialData/newLen<curLen 分支同为"整段替换"。）
    const newMsgs = [strMsg('user', 'DIFF'), strMsg('assistant', 't1'), strMsg('user', 't2')];
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs, { timestamp: 'T3' }));
    assert.equal(out[0].messages.length, 3);
    assert.equal(out[0].messages[0].content, 'DIFF');
    assert.equal(out[0].messages[1].content, 't1');
    assert.equal(out[0].messages[2]._timestamp, 'T3');
  });

  it('lastSession.messages 缺失(undefined) → 初始化为 []', () => {
    const session = { userId: 'user-1', messages: undefined, response: {}, entryTimestamp: null };
    const newMsgs = [strMsg('user', 'q1')];
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs));
    // prevMsgCount=0 → 不 transient；sameUser → 进合并；anchor 未命中(curLen=0)；
    // newLen(1) > curLen(0) → push tail
    assert.equal(out[0].messages.length, 1);
  });

  it('不同 userId 且非 checkpoint → 追加新会话(else 分支)', () => {
    const prev = [makeSession([strMsg('user', 'a'), strMsg('assistant', 'b')], { userId: 'user-1' })];
    const out = mergeMainAgentSessions(prev, makeEntry([strMsg('user', 'x')], { userId: 'user-2' }));
    assert.equal(out.length, 2);
    assert.equal(out[1].userId, 'user-2');
  });
});

// ─── findReverseAnchor 的间接分支(通过 merge 触达) ───────────────────────────
describe('findReverseAnchor 间接分支', () => {
  it('newMessages 为空数组 → anchor null，newFps 为 null 路径', () => {
    const existing = [strMsg('user', 'a'), strMsg('assistant', 'b')];
    const session = makeSession(existing);
    // newLen=0：进合并分支 newFps=null，findReverseAnchor newLen===0 返回 null；
    // 0<curLen → rebuild 成空数组
    const out = mergeMainAgentSessions([session], makeEntry([]));
    assert.equal(out[0].messages.length, 0);
  });

  it('newMessages[0] 为空 fp(empty) → 不当锚点，走 fallback', () => {
    const existing = [strMsg('user', 'a'), strMsg('assistant', 'b')];
    const session = makeSession(existing);
    // newMsgs[0] content=[] → fp 'user|empty' endsWith('|empty') → findReverseAnchor 返回 null
    const newMsgs = [blockMsg('user', []), strMsg('assistant', 'b'), strMsg('user', 'c')];
    // newLen=3 > curLen=2，anchor null → LCP：fp('user|empty') ≠ fp('a') → L=0 → 整段替换
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs));
    assert.equal(out[0].messages.length, 3);
    assert.deepEqual(out[0].messages[0].content, [], 'L=0：wire 的空块消息替换旧头部（旧语义会保留 a 产生混杂尾部）');
    assert.equal(out[0].messages[2].content, 'c');
  });

  it('多块连续校验：fp0 命中但后续块不等价 → 继续向左找/最终 null', () => {
    // existing 末尾有一个与 newMsgs[0] 同 fp 的块，但其后块不匹配 → 内层校验失败
    const existing = [
      strMsg('user', 'q1'),       // 与 newMsgs[0] 同 fp
      strMsg('assistant', 'DIFF'),// 与 newMsgs[1] 不同 fp → 校验失败
      strMsg('user', 'q1'),       // 第二个候选，再次同 fp
      strMsg('assistant', 'a1'),  // 与 newMsgs[1] 同 fp → 校验成功
    ];
    const session = makeSession(existing);
    const newMsgs = [strMsg('user', 'q1'), strMsg('assistant', 'a1'), strMsg('user', 'q2')];
    const out = mergeMainAgentSessions([session], makeEntry(newMsgs, { timestamp: 'TT' }));
    // 反向先命中 p=2(existing[2]='q1')，校验 existing[3]='a1' 等价 newMsgs[1] → anchor p=2,overlapLen=2
    // tailStart=2 < newLen=3 → push newMsgs[2]='q2'
    assert.equal(out[0].messages.length, 5);
    assert.equal(out[0].messages[4].content, 'q2');
    assert.equal(out[0].messages[4]._timestamp, 'TT');
  });
});

// ─── shouldDegradeBrokenMerge 谓词 + partial 会话降级语义 ───────────────────
// 批量路径 broken 载体的降级例外：仅当它为该 session 唯一载体（prevSessions
// 空 / epoch 变化）时放行，合并产物打 _partialData；同会话分支遇到 partial
// 基底且 anchor 未命中时整段替换，防止中段缺口导致的尾部重复。
describe('shouldDegradeBrokenMerge + partial-session merge', () => {
  let shouldDegradeBrokenMerge;
  before(async () => {
    const mod = await import('../src/utils/sessionMerge.js');
    shouldDegradeBrokenMerge = mod.shouldDegradeBrokenMerge;
  });

  const brokenEntry = (opts = {}) => {
    const e = makeEntry(opts.messages || [], opts);
    e._reconstructBroken = true; // makeEntry 不透传自定义字段，手动打标
    if (opts.seqEpoch) e._seqEpoch = opts.seqEpoch;
    return e;
  };

  it('谓词：prevSessions 空 → 放行（broken 载体为唯一会话）', () => {
    assert.equal(shouldDegradeBrokenMerge(brokenEntry(), []), true);
    assert.equal(shouldDegradeBrokenMerge(brokenEntry(), undefined), true);
  });

  it('谓词：双方 epoch 不同 → 放行（确定性会话边界）', () => {
    const prev = [makeSession([], {})];
    prev[0]._seqEpoch = 'v2:aaa';
    assert.equal(shouldDegradeBrokenMerge(brokenEntry({ seqEpoch: 'v2:bbb' }), prev), true);
  });

  it('谓词：同 epoch → 拒绝（降级会掉进同会话分支 → 错位风险）', () => {
    const prev = [makeSession([], {})];
    prev[0]._seqEpoch = 'v2:aaa';
    assert.equal(shouldDegradeBrokenMerge(brokenEntry({ seqEpoch: 'v2:aaa' }), prev), false);
  });

  it('谓词：v1 无 epoch 前序会话 → 放行（v1 会话不可能是 v2 同会话，创建分支安全）', () => {
    const prev = [makeSession([], {})]; // 无 _seqEpoch
    assert.equal(shouldDegradeBrokenMerge(brokenEntry({ seqEpoch: 'v2:bbb' }), prev), true);
    // entry 自身无 epoch：永不放行（v1 broken 载体不降级）
    assert.equal(shouldDegradeBrokenMerge(brokenEntry(), prev), false);
  });

  it('谓词：staleReorder / inProgress / 非 broken → 拒绝', () => {
    const stale = brokenEntry(); stale._staleReorder = true;
    const prog = brokenEntry(); prog.inProgress = true;
    const healthy = makeEntry([], {});
    assert.equal(shouldDegradeBrokenMerge(stale, []), false);
    assert.equal(shouldDegradeBrokenMerge(prog, []), false);
    assert.equal(shouldDegradeBrokenMerge(healthy, []), false);
  });

  it('降级合并：prevSessions 空 → 创建会话并打 _partialData，messages 为可信前缀', () => {
    const msgs = [strMsg('user', 'q1'), strMsg('assistant', 'r1'), strMsg('user', 'q2')];
    const entry = brokenEntry({ messages: msgs, seqEpoch: 'v2:x' });
    entry._partialData = true;
    const out = mergeMainAgentSessions([], entry);
    assert.equal(out.length, 1);
    assert.equal(out[0]._partialData, true);
    assert.equal(out[0].messages, msgs);
  });

  it('降级合并：epoch 变化 → 追加新会话并打 _partialData', () => {
    const prev = [makeSession([strMsg('user', 'old')], {})];
    prev[0]._seqEpoch = 'v2:aaa';
    const entry = brokenEntry({ messages: [strMsg('user', 'new1')], seqEpoch: 'v2:bbb' });
    entry._partialData = true;
    const out = mergeMainAgentSessions(prev, entry);
    assert.equal(out.length, 2);
    assert.equal(out[1]._partialData, true);
  });

  it('H1：partial 基底 + 全量条目 anchor 命中补全 → 无重复且清 _partialData', () => {
    // partial 前缀 = 真前缀（缺口在尾部）：全量条目 5 条，anchor 命中前缀 4 条
    const partial = [
      strMsg('user', 'q1'), strMsg('assistant', 'r1'),
      strMsg('user', 'q2'), strMsg('assistant', 'r2'),
    ];
    const full = [...partial, strMsg('user', 'q3'), strMsg('assistant', 'r3')];
    const session = makeSession(partial, {});
    session._partialData = true;
    const out = mergeMainAgentSessions([session], makeEntry(full, { timestamp: 'TT' }));
    assert.equal(out[0].messages.length, 6);
    assert.equal(out[0].messages[4].content, 'q3');
    assert.equal(out[0]._partialData, undefined, 'anchor 对齐成功后清除 partial 标记');
  });

  it('H1：partial 基底 + anchor 未命中（中段缺口）→ 整段替换而非前缀扩展，无尾部重复', () => {
    // partial 前缀缺中段：第 2 条被替换，后面多出的消息与新全量不一致
    const partial = [
      strMsg('user', 'q1'), strMsg('assistant', 'X'),   // 中段被改写
      strMsg('user', 'q3'), strMsg('assistant', 'r3'),
      strMsg('user', 'q4'),
    ];
    const full = [
      strMsg('user', 'q1'), strMsg('assistant', 'r2'),
      strMsg('user', 'q3'), strMsg('assistant', 'r3'),
      strMsg('user', 'q4'), strMsg('assistant', 'r4'),
    ];
    const session = makeSession(partial, {});
    session._partialData = true;
    const out = mergeMainAgentSessions([session], makeEntry(full, { timestamp: 'TT' }));
    assert.equal(out[0].messages.length, 6, '整段替换：恰好 6 条，无重复');
    assert.equal(out[0].messages[1].content, 'r2');
    assert.equal(out[0].messages[5].content, 'r4');
    assert.equal(out[0]._partialData, undefined, '替换后清除 partial 标记');
  });

  it('正常（非 partial）会话前缀命中走 anchor 扩展：push 非重叠尾段', () => {
    const existing = [strMsg('user', 'q1')];
    const full = [strMsg('user', 'q1'), strMsg('assistant', 'r1'), strMsg('user', 'q2')];
    // q1 前缀存在 → anchor 命中，tailStart=1 → push r1,q2 → 3 条
    const out = mergeMainAgentSessions([makeSession(existing, {})], makeEntry(full, { timestamp: 'TT' }));
    assert.equal(out[0].messages.length, 3);
    assert.equal(out[0]._partialData, undefined);
  });
});

// ─── 中断分叉的最深公共前缀扩展（忙时排队消息"立即追加"后的可见性修复）────────────
// 形态：客户端会话尾部是被打断的 partial assistant，下一轮 wire replay 丢弃该 partial、
// 在 curLen-1 处放的是排队的 user prompt → anchor 窗口末位失配 miss → 旧的 push-tail
// 回退会把 curLen-1 处的用户消息永久跳过（prompt 不渲染、回复变孤儿气泡）。
describe('mergeMainAgentSessions — LCP 扩展（中断分叉 / 排队消息可见性）', () => {
  it('中断后 replay 丢弃 partial（PTY/SDK 同构）：排队 user prompt 落在分叉点，partial 被截断', () => {
    const a1 = blockMsg('assistant', [{ type: 'tool_use', id: 'tu_1', name: 'Read' }]);
    const tr = blockMsg('user', [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'r' }]);
    const partial = strMsg('assistant', '被中断的流式残段');
    const session = makeSession([strMsg('user', 'q1'), a1, tr, partial], {});
    const entry = makeEntry([
      strMsg('user', 'q1'),
      blockMsg('assistant', [{ type: 'tool_use', id: 'tu_1', name: 'Read' }]),
      blockMsg('user', [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'r' }]),
      strMsg('user', '排队消息：立即追加'),
      strMsg('assistant', 'r3'),
    ], { timestamp: 'TT' });
    const out = mergeMainAgentSessions([session], entry);
    const msgs = out[0].messages;
    assert.equal(msgs.length, 5);
    assert.equal(msgs[3].content, '排队消息：立即追加', 'u2 落在分叉点（curLen-1）位置');
    assert.equal(msgs[4].content, 'r3', '其后的回复紧随其后（不再是孤儿气泡）');
    assert.ok(!msgs.some((m) => m.content === '被中断的流式残段'), 'aborted partial 被截断（对齐 wire 真相）');
  });

  it('SDK resume 形态（纯字符串序列）中断分叉 → 排队 prompt 落位', () => {
    const session = makeSession([strMsg('user', 'u1'), strMsg('assistant', 'a1'), strMsg('assistant', 'a2-partial')], {});
    const entry = makeEntry([strMsg('user', 'u1'), strMsg('assistant', 'a1'), strMsg('user', 'u2-queued'), strMsg('assistant', 'a3')], {});
    const out = mergeMainAgentSessions([session], entry);
    assert.deepEqual(out[0].messages.map((m) => m.content), ['u1', 'a1', 'u2-queued', 'a3']);
  });

  it('replay 含"重渲染的 partial"（fp 在 partial 处分叉）→ 以 wire 版本为准且 prompt 落位', () => {
    const session = makeSession([strMsg('user', 'u1'), strMsg('assistant', 'a1'), strMsg('assistant', 'partial old')], {});
    const entry = makeEntry([strMsg('user', 'u1'), strMsg('assistant', 'a1'), strMsg('assistant', 'partial new'), strMsg('user', 'u2'), strMsg('assistant', 'a3')], {});
    const out = mergeMainAgentSessions([session], entry);
    assert.deepEqual(out[0].messages.map((m) => m.content), ['u1', 'a1', 'partial new', 'u2', 'a3']);
  });

  it('连续多条排队消息：分叉点后多个 user/assistant 全部保留', () => {
    const partial = strMsg('assistant', 'partial');
    const session = makeSession([strMsg('user', 'q1'), strMsg('assistant', 'a1'), partial], {});
    const entry = makeEntry([
      strMsg('user', 'q1'), strMsg('assistant', 'a1'),
      strMsg('user', 'u2'), strMsg('assistant', 'a3'),
      strMsg('user', 'u3'), strMsg('assistant', 'a4'),
    ], {});
    const out = mergeMainAgentSessions([session], entry);
    assert.deepEqual(out[0].messages.map((m) => m.content), ['q1', 'a1', 'u2', 'a3', 'u3', 'a4']);
  });

  it('零公共前缀（L=0）→ 整段替换为 wire 真相（旧行为会产生孤儿追加）', () => {
    const session = makeSession([strMsg('user', 'x'), strMsg('assistant', 'y'), strMsg('user', 'z')], {});
    const entry = makeEntry([strMsg('user', 'a'), strMsg('assistant', 'b'), strMsg('user', 'c'), strMsg('assistant', 'd')], {});
    const out = mergeMainAgentSessions([session], entry);
    assert.deepEqual(out[0].messages.map((m) => m.content), ['a', 'b', 'c', 'd'], '整段替换，不再产生孤儿追加');
  });

  it('重复 fp 候选骗过 anchor（窗口校验失败）但前缀全等 → L===curLen 退化：末位替换+追加，引用稳定', () => {
    // existing 的第二条 'same' 是 anchor 的末位候选，但窗口校验在其后失配 → anchor null；
    // LCP 前缀全等（L=3=curLen）→ 截断为 no-op、push [new-tail, extra]——
    // 钉住"无分叉时与旧行为等价"之外的退化形态：分叉恰在末位时以 wire 末位为准。
    const existing = [strMsg('user', 'same'), strMsg('assistant', 'mid'), strMsg('user', 'same'), strMsg('assistant', 'old-tail')];
    const session = makeSession(existing);
    const ref = session.messages;
    const entry = makeEntry([strMsg('user', 'same'), strMsg('assistant', 'mid'), strMsg('user', 'same'), strMsg('assistant', 'new-tail'), strMsg('user', 'extra')], {});
    const out = mergeMainAgentSessions([session], entry);
    assert.strictEqual(out[0].messages, ref, '原地截断+push，messages 引用稳定（保 WeakMap 缓存）');
    assert.equal(out[0].messages.length, 5);
    assert.deepEqual(out[0].messages.map((m) => m.content), ['same', 'mid', 'same', 'new-tail', 'extra']);
  });
});
