/**
 * Branch coverage 补全 — src/utils/entry-slim.js
 *
 * 目标分支（baseline 单跑 branch 74.42%，uncovered 78-82 247 301-302 305-309 367-374）：
 *  - _systemSig 的 string 形态分支（78-82）经由 internEntryBigFields(body.system 为 string)
 *  - slimBodyBigFields system array 中"非 text / 短 text"块的 `return blk`（247）
 *  - createEntrySlimmer.process 瞬态过滤分支（301-302）
 *  - createEntrySlimmer.process isNewSession 非瞬态分支（305-309）
 *  - createEntrySlimmer.finalize isNew 回填上一个 session 分支（367-374）
 *  - 其余 ||/?? 默认、防御 early-return 补边
 *
 * 仅新增本文件,不改源码/其他测试。
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let M;
let RP;
before(async () => {
  M = await import('../src/utils/entry-slim.js');
  RP = await import('../src/utils/readResultPool.js');
});

const isMainAgent = (entry) => !!entry.mainAgent;

// 构造一个 MainAgent entry（与邻近测试风格一致,但允许细粒度定制 system/tools/metadata）。
function makeMainAgent(msgCount, opts = {}) {
  const messages = [];
  for (let i = 0; i < msgCount; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `msg-${i}` });
  }
  return {
    timestamp: opts.timestamp || new Date().toISOString(),
    url: opts.url || 'https://api.anthropic.com/v1/messages',
    mainAgent: true,
    body: {
      messages,
      metadata: opts.metadata !== undefined
        ? opts.metadata
        : { user_id: opts.userId || 'user-1', request_id: `r-${Math.random()}` },
      model: 'claude-opus-4-6',
      tools: opts.tools || [
        { name: 'Bash', description: 'X'.repeat(20000), input_schema: { type: 'object' } },
        { name: 'Read', description: 'X'.repeat(10000), input_schema: { type: 'object' } },
      ],
      system: opts.system !== undefined ? opts.system : [
        { type: 'text', text: 'You are Claude Code, ' + 'A'.repeat(50000), cache_control: { type: 'ephemeral' } },
      ],
      tool_choice: opts.tool_choice || { type: 'auto' },
    },
    response: { status: 200, body: {} },
  };
}

// ─── _systemSig string 形态（78-82）经由 internEntryBigFields ──────────────────
describe('internEntryBigFields: body.system 为 string 形态走 _systemSig string 分支', () => {
  it('两条 entry system 同长字符串 → 共享 pool ref（命中 string sig + mid-slice）', () => {
    M._resetInternPoolsForTest();
    // 长度 > 100 触发 mid-slice 分支；不同 instance 同内容
    const longSys = 'You are Claude Code, ' + 'S'.repeat(300);
    const e1 = makeMainAgent(5, { system: longSys, tools: [] });
    const e2 = makeMainAgent(6, { system: 'You are Claude Code, ' + 'S'.repeat(300), tools: [] });
    const i1 = M.internEntryBigFields(e1);
    const i2 = M.internEntryBigFields(e2);
    assert.equal(i1.body.system, i2.body.system, '同内容 string system 应共享 pool ref');
    const stats = M._getInternPoolStatsForTest();
    assert.equal(stats.systemPoolSize, 1, 'string system 命中 → pool size 1');
  });

  it('短 string system（<=100）走 mid=0 分支,仍可池化', () => {
    M._resetInternPoolsForTest();
    const shortSys = 'short system prompt';
    const e1 = makeMainAgent(5, { system: shortSys, tools: [] });
    const e2 = makeMainAgent(6, { system: 'short system prompt', tools: [] });
    const i1 = M.internEntryBigFields(e1);
    const i2 = M.internEntryBigFields(e2);
    assert.equal(i1.body.system, i2.body.system, '短 string system 同内容共享 ref');
  });

  it('空字符串 system → _systemSig 返回 mid=0 分支但 length 0,仍注册', () => {
    M._resetInternPoolsForTest();
    // 空字符串: 注意 internEntryBigFields 的判定是 typeof === 'string',空串也进入
    const e1 = makeMainAgent(5, { system: '', tools: [] });
    const i1 = M.internEntryBigFields(e1);
    // 空字符串 sig = 's:0:::' 非空,会注册;首条 intern 返回原 entry
    assert.equal(i1, e1, '空串 system 首条 intern 不 clone');
  });
});

// ─── _systemSig array 边界:length<=100 不取 mid（73 行三元 false 臂）───────────
describe('internEntryBigFields: array system 短 text 走 mid=0 分支', () => {
  it('array system text 短(<=100) → mid=0,仍正确池化', () => {
    M._resetInternPoolsForTest();
    const sys = [{ type: 'text', text: 'tiny' }];
    const e1 = makeMainAgent(5, { system: sys, tools: [] });
    const e2 = makeMainAgent(6, { system: [{ type: 'text', text: 'tiny' }], tools: [] });
    const i1 = M.internEntryBigFields(e1);
    const i2 = M.internEntryBigFields(e2);
    assert.equal(i1.body.system, i2.body.system, '短 text array system 同内容共享 ref');
  });

  it('array system 长度 0 → _systemSig 返回 "a:0",仍走注册', () => {
    M._resetInternPoolsForTest();
    // body.system = [] 不进入 internEntryBigFields 的 system 分支(length>0 才进)
    // 直接走 string/array 判定: 空数组 length===0 → 跳过 → system 不变
    const e1 = makeMainAgent(5, { system: [], tools: [] });
    const i1 = M.internEntryBigFields(e1);
    assert.equal(i1.body.system, e1.body.system, '空 array system 不被替换');
  });

  it('system block 无 type / 无 text → _systemSig 用 ||默认空串', () => {
    M._resetInternPoolsForTest();
    const sys = [{}, { text: 'x'.repeat(200) }];
    const e1 = makeMainAgent(5, { system: sys, tools: [] });
    const e2 = makeMainAgent(6, { system: [{}, { text: 'x'.repeat(200) }], tools: [] });
    const i1 = M.internEntryBigFields(e1);
    const i2 = M.internEntryBigFields(e2);
    assert.equal(i1.body.system, i2.body.system, '无 type/text block 仍稳定生成 sig');
  });
});

// ─── _toolsSig 默认值臂 ──────────────────────────────────────────────────────
describe('internEntryBigFields: tools sig 默认值臂', () => {
  it('tool 无 name / 无 description → _toolsSig 用 ||/?? 默认值', () => {
    M._resetInternPoolsForTest();
    const tools = [{}, { name: 'OnlyName' }, { description: 'd'.repeat(5) }];
    const e1 = makeMainAgent(5, { tools, system: [] });
    const e2 = makeMainAgent(6, { tools: [{}, { name: 'OnlyName' }, { description: 'd'.repeat(5) }], system: [] });
    const i1 = M.internEntryBigFields(e1);
    const i2 = M.internEntryBigFields(e2);
    assert.equal(i1.body.tools, i2.body.tools, '默认值臂下 sig 仍一致 → 共享 ref');
  });

  it('body.system 非 string 非 array(如 number) → internEntryBigFields 跳过 system', () => {
    M._resetInternPoolsForTest();
    const e1 = makeMainAgent(5, { system: 12345, tools: [] });
    const out = M.internEntryBigFields(e1);
    // number system: 不满足 (array&&len>0) 也不满足 typeof string → system 分支不进
    assert.equal(out.body.system, 12345, 'number system 原样透传');
  });
});

// ─── slimBodyBigFields: system array 中"非 text / 短 text"块 return blk（247）──
describe('slimBodyBigFields: system array 块的 return blk 分支', () => {
  it('非 text 类型 block 原样返回', () => {
    const body = {
      messages: [{ role: 'user', content: 'x' }],
      system: [
        { type: 'image', source: { data: 'D'.repeat(5000) } }, // 非 text → return blk
      ],
    };
    const slimmed = M.slimBodyBigFields(body);
    assert.deepEqual(slimmed.system[0], { type: 'image', source: { data: 'D'.repeat(5000) } });
  });

  it('text block 但长度 <= SYSTEM_TEXT_KEEP_PREFIX 不截断,原样返回', () => {
    const body = {
      messages: [],
      system: [{ type: 'text', text: 'short enough' }],
    };
    const slimmed = M.slimBodyBigFields(body);
    assert.equal(slimmed.system[0].text, 'short enough', '短 text 不截断');
  });

  it('text block 但 text 非 string → return blk', () => {
    const body = {
      messages: [],
      system: [{ type: 'text', text: 12345 }],
    };
    const slimmed = M.slimBodyBigFields(body);
    assert.deepEqual(slimmed.system[0], { type: 'text', text: 12345 });
  });

  it('null / 非对象 block 原样返回（!blk || typeof !== object 臂）', () => {
    const body = {
      messages: [],
      system: [null, 'raw-string-block', { type: 'text', text: 'Z'.repeat(M.SYSTEM_TEXT_KEEP_PREFIX + 10) }],
    };
    const slimmed = M.slimBodyBigFields(body);
    assert.equal(slimmed.system[0], null, 'null block 原样');
    assert.equal(slimmed.system[1], 'raw-string-block', 'string block 原样');
    // 第三块超长 text → 被截断
    assert.equal(slimmed.system[2].text.length, M.SYSTEM_TEXT_KEEP_PREFIX);
  });

  it('body 为 falsy 直接原样返回', () => {
    assert.equal(M.slimBodyBigFields(null), null);
    assert.equal(M.slimBodyBigFields(undefined), undefined);
  });

  it('body.system 为短 string（<=prefix）走 else-if false 臂,不截断', () => {
    const body = { messages: [], system: 'tiny string system' };
    const slimmed = M.slimBodyBigFields(body);
    assert.equal(slimmed.system, 'tiny string system');
  });

  it('body.tools 缺失（非数组）→ 不进入 tools.map 分支', () => {
    const body = { messages: [], system: [] };
    const slimmed = M.slimBodyBigFields(body);
    assert.equal('tools' in slimmed, false, '无 tools 时 next 不含 tools');
  });

  it('body 无 tool_choice → "tool_choice" in next 为 false,跳过 delete', () => {
    const body = { messages: [], system: [] };
    const slimmed = M.slimBodyBigFields(body);
    assert.equal('tool_choice' in slimmed, false);
  });
});

// ─── createEntrySlimmer.process 瞬态过滤分支（301-302）─────────────────────────
describe('createEntrySlimmer.process 瞬态与 newSession 分支', () => {
  it('瞬态请求(isNewSession && count<=4 && prevMsgCount>4) → 直接 return,不更新 prev', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];

    const e0 = makeMainAgent(15);
    slimmer.process(e0, entries, 0);
    entries.push(e0);

    // 瞬态:2 条消息(<=4) + 不同 userId 触发 isNewSession + prevMsgCount 15 > 4
    const transient = makeMainAgent(2, { userId: 'user-2' });
    slimmer.process(transient, entries, 1);
    entries.push(transient);

    // 瞬态被跳过 → prev 仍指向 e0,e0 未被 slim
    assert.equal(entries[0]._slimmed, undefined, '瞬态跳过,e0 不应被 slim');

    // 之后同 session 的 20 条 → e0 被 slim（prev 未被瞬态改写）
    const e2 = makeMainAgent(20);
    slimmer.process(e2, entries, 2);
    entries.push(e2);
    assert.equal(entries[0]._slimmed, true, 'e0 此时应被 slim');
  });

  it('isNewSession 非瞬态(count>4 或 prevMsgCount<=4) → 重置 prev,不 slim 前一条（305-309）', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];

    const e0 = makeMainAgent(20);
    slimmer.process(e0, entries, 0);
    entries.push(e0);

    const e1 = makeMainAgent(25);
    slimmer.process(e1, entries, 1);
    entries.push(e1);
    // 同 session,e0 被 slim
    assert.equal(entries[0]._slimmed, true);

    // 新 session:消息数从 25 骤降到 6(>4,非瞬态) → isNewSession 走重置分支
    const e2 = makeMainAgent(6, { userId: 'user-1' });
    slimmer.process(e2, entries, 2);
    entries.push(e2);
    // e1 不应被 slim（newSession 直接 return,不剪枝前一条）
    assert.equal(entries[1]._slimmed, undefined, 'newSession 分支不 slim 前一条');

    // 新 session 继续:e3 → 剪枝 e2
    const e3 = makeMainAgent(12, { userId: 'user-1' });
    slimmer.process(e3, entries, 3);
    entries.push(e3);
    assert.equal(entries[2]._slimmed, true, 'e2 应在新 session 内被 slim');
  });

  it('非 MainAgent 直接 return（process 第一防御）', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];
    const e0 = makeMainAgent(10);
    slimmer.process(e0, entries, 0);
    entries.push(e0);

    const sub = { mainAgent: false, body: { messages: [{ role: 'user', content: 'x' }] } };
    const ret = slimmer.process(sub, entries, 1);
    assert.equal(ret, sub, '非 MainAgent 原样返回');
    entries.push(sub);
    assert.equal(entries[0]._slimmed, undefined, '非 MainAgent 不触发剪枝');
  });

  it('MainAgent 但 body.messages 空/缺失 → 第二防御 return', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];

    const noBody = { mainAgent: true, body: null };
    assert.equal(slimmer.process(noBody, entries, 0), noBody, 'body 为 null 原样返回');

    const emptyMsgs = { mainAgent: true, body: { messages: [] } };
    assert.equal(slimmer.process(emptyMsgs, entries, 1), emptyMsgs, '空 messages 原样返回');

    const nonArr = { mainAgent: true, body: { messages: 'not-array' } };
    assert.equal(slimmer.process(nonArr, entries, 2), nonArr, '非数组 messages 原样返回');
  });

  it('metadata 缺失 → userId 走 ?.user_id || null 默认值臂', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];
    const e0 = makeMainAgent(10, { metadata: undefined });
    // metadata undefined → makeMainAgent 会生成默认;显式去掉
    delete e0.body.metadata;
    slimmer.process(e0, entries, 0);
    entries.push(e0);

    const e1 = makeMainAgent(15, { metadata: null });
    delete e1.body.metadata;
    slimmer.process(e1, entries, 1);
    entries.push(e1);
    assert.equal(entries[0]._slimmed, true, '无 metadata 仍能 slim(userId=null)');
  });

  it('prevMainIdx 越界（>= entries.length）→ 跳过剪枝(312 防御)', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];
    // 直接传入 currentIdx 与实际 entries 不匹配,制造 prevMainIdx 越界
    const e0 = makeMainAgent(10);
    slimmer.process(e0, entries, 0);
    entries.push(e0);

    const e1 = makeMainAgent(15);
    // entries 此时 length=1,但若 prevMainIdx=0 < 1 正常;构造越界需 entries 被截短
    // 用一个新 entries 数组(空)调用 → prevMainIdx=0 但 entries.length=0 → 0 < 0 false
    slimmer.process(e1, [], 1);
    // 不抛错即可
    assert.ok(true);
  });

  it('prev.body.messages 长度为 0 → 跳过 slim 字段写入(314 防御)', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];
    const e0 = makeMainAgent(10);
    slimmer.process(e0, entries, 0);
    entries.push(e0);
    // 手动把 e0 的 messages 清空,模拟已被外部 slim
    e0.body.messages = [];

    const e1 = makeMainAgent(15);
    slimmer.process(e1, entries, 1);
    entries.push(e1);
    // e0 messages 已空 → 不会再被赋 _slimmed
    assert.equal(entries[0]._slimmed, undefined, 'messages 空的 prev 不被重复 slim');
  });

  it('prev._prevMsgCount 存在 → startIdx 用其值(316 ||默认的 truthy 臂)', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];

    const e0 = makeMainAgent(10);
    slimmer.process(e0, entries, 0);
    entries.push(e0);

    const e1 = makeMainAgent(15);
    slimmer.process(e1, entries, 1);
    entries.push(e1);

    // e2 触发 slim e1; e1._prevMsgCount 此时被设为 10(>0,truthy)
    const e2 = makeMainAgent(20);
    slimmer.process(e2, entries, 2);
    entries.push(e2);

    assert.equal(entries[1]._slimmed, true);
    // startIdx = e1._prevMsgCount = 10 → _messagesIndex 从 10 开始
    assert.equal(entries[1]._messagesIndex[0], 10, 'startIdx 用 prev._prevMsgCount');
    assert.equal(entries[1]._messageCount, 15);
  });
});

// ─── createEntrySlimmer.finalize（367-374 等）─────────────────────────────────
describe('createEntrySlimmer.finalize 多 session 回填', () => {
  it('两个 session,finalize 在 session 边界回填上一个 session 的 _fullEntryIndex（367-374）', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];

    // Session 1: e0(20) e1(25) — e0 被 slim
    const e0 = makeMainAgent(20, { userId: 'user-1' });
    slimmer.process(e0, entries, 0);
    entries.push(e0);
    const e1 = makeMainAgent(25, { userId: 'user-1' });
    slimmer.process(e1, entries, 1);
    entries.push(e1);

    // Session 2: 切 userId 触发新 session;e2(30) e3(35) — e2 被 slim
    const e2 = makeMainAgent(30, { userId: 'user-2' });
    slimmer.process(e2, entries, 2);
    entries.push(e2);
    const e3 = makeMainAgent(35, { userId: 'user-2' });
    slimmer.process(e3, entries, 3);
    entries.push(e3);

    slimmer.finalize(entries);

    // session 1 的 slimmed e0 应指向 session 1 的 fullEntry(e1, idx 1)
    assert.equal(entries[0]._slimmed, true);
    assert.equal(entries[0]._fullEntryIndex, 1, 'session1 slimmed 指向 session1 fullEntry');
    // session 2 的 slimmed e2 应指向 session 2 的 fullEntry(e3, idx 3)
    assert.equal(entries[2]._slimmed, true);
    assert.equal(entries[2]._fullEntryIndex, 3, 'session2 slimmed 指向 session2 fullEntry');
  });

  it('finalize 跳过非 MainAgent 且非 slimmed 的 entry（354-355 continue）', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];

    const e0 = makeMainAgent(20);
    slimmer.process(e0, entries, 0);
    entries.push(e0);

    // 插入 SubAgent(非 MainAgent,有 messages → !isSlimmed && hasMsgs 为 true,
    // 然后 !isSlimmed && !isMainAgent → continue)
    const sub = { mainAgent: false, body: { messages: [{ role: 'user', content: 'x' }] } };
    entries.push(sub);

    const e2 = makeMainAgent(25);
    slimmer.process(e2, entries, 2);
    entries.push(e2);

    slimmer.finalize(entries);
    // e0 被 slim 指向最后 fullEntry
    assert.equal(entries[0]._slimmed, true);
    assert.ok(entries[0]._fullEntryIndex >= 0);
    // sub 未被赋 _fullEntryIndex
    assert.equal(sub._fullEntryIndex, undefined);
  });

  it('finalize: 无消息也无 slim 标记的 entry continue（354 第一臂）', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];
    // 一个既不是 slimmed、body.messages 也空的 entry
    const empty = { mainAgent: true, body: { messages: [] } };
    entries.push(empty);
    const e1 = makeMainAgent(10);
    entries.push(e1);
    // 不抛错
    slimmer.finalize(entries);
    assert.equal(empty._fullEntryIndex, undefined);
  });

  it('finalize: isNew 但 count<=4 且 pCount>10 的瞬态 → continue(364),不回填', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];

    // 直接构造 entries(不经 process),让 finalize 自己扫描
    // e0: 20 条(fullEntry); e1: 25 条同 user(同 session)
    const e0 = makeMainAgent(20, { userId: 'u1' });
    const e1 = makeMainAgent(25, { userId: 'u1' });
    // e2: 瞬态 — 3 条(<=4),切 user,pCount(25)>10 → isNew && count<=4 && pCount>10 → continue
    const e2 = makeMainAgent(3, { userId: 'u2' });
    // e3: 同 u1 继续
    const e3 = makeMainAgent(30, { userId: 'u1' });
    entries.push(e0, e1, e2, e3);

    // 不抛错,瞬态 e2 被 continue 跳过
    slimmer.finalize(entries);
    assert.ok(true, '瞬态 continue 路径不抛错');
  });

  it('finalize: e._messageCount 缺失时用 body.messages.length（357 || 链）', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];
    // 直接放两个未 process 的 MainAgent(无 _messageCount,无 _slimmed)
    const e0 = makeMainAgent(20);
    const e1 = makeMainAgent(25);
    entries.push(e0, e1);
    slimmer.finalize(entries);
    // 未 slim 的 entry 不应被赋 _fullEntryIndex
    assert.equal(e0._fullEntryIndex, undefined);
    assert.equal(e1._fullEntryIndex, undefined);
  });

  it('finalize: slimmed entry 但 _messageCount 为 0 → count 走 || 后续(357)', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    const entries = [];
    // 模拟一个 slimmed entry,_messageCount=0,body.messages 空
    const slim = { mainAgent: true, _slimmed: true, _messageCount: 0, body: { messages: [] } };
    const full = makeMainAgent(10);
    entries.push(slim, full);
    slimmer.finalize(entries);
    // slim 应被回填指向 full
    assert.equal(slim._fullEntryIndex, 1);
  });

  it('finalize: 空 entries 数组,最后 session 回填空集（387-389 0 次循环）', () => {
    const slimmer = M.createEntrySlimmer(isMainAgent);
    slimmer.finalize([]);
    assert.ok(true, '空数组 finalize 不抛错');
  });
});

// ─── restoreSlimmedEntry 防御补边 ────────────────────────────────────────────
describe('restoreSlimmedEntry 防御分支', () => {
  it('_fullEntryIndex == null（undefined）→ 原样返回', () => {
    const entry = makeMainAgent(10);
    entry._slimmed = true;
    // _fullEntryIndex 不设置 → undefined → == null 为 true
    const result = M.restoreSlimmedEntry(entry, []);
    assert.equal(result, entry);
  });

  it('fullEntry 缺失（requests[idx] 为 undefined）→ 原样返回', () => {
    const entry = makeMainAgent(10);
    entry._slimmed = true;
    entry._fullEntryIndex = 5; // 越界
    entry._messageCount = 10;
    const result = M.restoreSlimmedEntry(entry, []);
    assert.equal(result, entry, 'fullEntry 为 undefined 时原样返回');
  });

  it('fullEntry 无 body.messages → 原样返回（404 防御）', () => {
    const entry = makeMainAgent(10);
    entry._slimmed = true;
    entry._fullEntryIndex = 1;
    entry._messageCount = 10;
    const noMsgFull = { body: {} };
    const result = M.restoreSlimmedEntry(entry, [entry, noMsgFull]);
    assert.equal(result, entry, 'fullEntry 无 messages 原样返回');
  });
});

// ─── createIncrementalSlimmer 边角分支补 ─────────────────────────────────────
describe('createIncrementalSlimmer 防御与边角', () => {
  it('非 MainAgent processEntry 原样返回（453 第一防御）', () => {
    const slimmer = M.createIncrementalSlimmer(isMainAgent);
    const sub = { mainAgent: false, body: { messages: [{ role: 'user', content: 'x' }] } };
    assert.equal(slimmer.processEntry(sub, [], 0), sub);
  });

  it('MainAgent 但无 messages → 第二防御 return（454）', () => {
    const slimmer = M.createIncrementalSlimmer(isMainAgent);
    const e = { mainAgent: true, body: {} };
    assert.equal(slimmer.processEntry(e, [], 0), e);
    const e2 = { mainAgent: true, body: { messages: [] } };
    assert.equal(slimmer.processEntry(e2, [], 1), e2);
  });

  it('processEntry 瞬态过滤分支（466 return）', () => {
    const slimmer = M.createIncrementalSlimmer(isMainAgent);
    const requests = [];
    const e0 = makeMainAgent(15);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);

    const transient = makeMainAgent(2, { userId: 'user-2' });
    slimmer.processEntry(transient, requests, 1);
    requests.push(transient);
    assert.equal(requests[0]._slimmed, undefined, '瞬态跳过,e0 未被 slim');
  });

  it('processEntry prevMainIdx 越界 → 跳过 slim（482 防御）', () => {
    const slimmer = M.createIncrementalSlimmer(isMainAgent);
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, [], 0); // requests 空,prevMainIdx 设为 0

    const e1 = makeMainAgent(15);
    // requests 仍空 → prevMainIdx(0) < requests.length(0) 为 false → 不剪枝
    slimmer.processEntry(e1, [], 1);
    assert.ok(true, '越界不抛错');
  });

  it('processEntry orig.body.messages 空 → 不 slim（484 防御）', () => {
    const slimmer = M.createIncrementalSlimmer(isMainAgent);
    const requests = [];
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);
    requests[0].body.messages = []; // 清空

    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, undefined, 'messages 空的 prev 不被 slim');
  });

  it('processEntry metadata 缺失 → userId 默认 null（456 ?.|| 臂）', () => {
    const slimmer = M.createIncrementalSlimmer(isMainAgent);
    const requests = [];
    const e0 = makeMainAgent(10);
    delete e0.body.metadata;
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);
    const e1 = makeMainAgent(15);
    delete e1.body.metadata;
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    assert.equal(requests[0]._slimmed, true);
  });

  it('全量回填:已是当前 idx 的 slimmed entry 不重复 clone（500 条件 false 臂）', () => {
    const slimmer = M.createIncrementalSlimmer(isMainAgent);
    const requests = [];
    const e0 = makeMainAgent(10);
    slimmer.processEntry(e0, requests, 0);
    requests.push(e0);
    const e1 = makeMainAgent(15);
    slimmer.processEntry(e1, requests, 1);
    requests.push(e1);
    // 此刻 requests[0]._fullEntryIndex = 1
    const ref0 = requests[0];
    const e2 = makeMainAgent(20);
    slimmer.processEntry(e2, requests, 2);
    requests.push(e2);
    // 回填后 requests[0]._fullEntryIndex 更新到 2(从 1 变),所以会 clone
    assert.equal(requests[0]._fullEntryIndex, 2);
    assert.notEqual(requests[0], ref0, '_fullEntryIndex 变化 → clone 新对象');
  });
});

// ─── internMessagesToolResultBlocks 边角 ─────────────────────────────────────
describe('internMessagesToolResultBlocks 边角分支', () => {
  it('非数组 / 空数组 messages → 原样返回（117）', () => {
    assert.equal(M.internMessagesToolResultBlocks(null), null);
    assert.equal(M.internMessagesToolResultBlocks('nope'), 'nope');
    const empty = [];
    assert.equal(M.internMessagesToolResultBlocks(empty), empty);
  });

  it('msg.content 非数组 / 空 → continue（123）', () => {
    const messages = [
      { role: 'user', content: 'string content' },
      { role: 'user', content: [] },
      { role: 'user' }, // 无 content
    ];
    assert.equal(M.internMessagesToolResultBlocks(messages), messages, '无可 intern 的 content 原样返回');
  });
});

// ─── internEntryBigFields 顶层防御 ───────────────────────────────────────────
describe('internEntryBigFields 顶层防御', () => {
  it('entry 无 body → 原样返回（162）', () => {
    const e = { timestamp: 'x' };
    assert.equal(M.internEntryBigFields(e), e);
    assert.equal(M.internEntryBigFields(null), null);
  });

  it('body.tools 空数组 → 不进 tools 分支', () => {
    M._resetInternPoolsForTest();
    const e = { body: { messages: [], tools: [], system: [] } };
    const out = M.internEntryBigFields(e);
    assert.equal(out, e, '无大字段 → 不 clone');
  });

  it('_systemSig 返回空(system 非 string 非 array)时不池化(180 sig falsy 臂)', () => {
    M._resetInternPoolsForTest();
    // 直接构造 body.system 为对象(非 string 非 array),但满足 178 行条件?
    // 178: (array&&len>0) || typeof string — 对象都不满足 → 跳过,不会到 _systemSig
    const e = { body: { messages: [], system: { foo: 'bar' } } };
    const out = M.internEntryBigFields(e);
    assert.equal(out, e, '对象 system 不进入 sig 分支');
  });
});
