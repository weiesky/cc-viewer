/**
 * assignMessageTimestamps 纯函数单测
 *
 * 验证：
 *   1. 历史 message（i < prevCount）继承 _timestamp 和 _generatedTs
 *   2. 新增 message（i >= prevCount）赋 currentTs；assistant 角色额外赋 _generatedTs = prevMainAgentTs
 *   3. isNewSession 命中：所有 message 走"新增"分支（不继承）
 *   4. 边界场景：null/undefined input、empty arrays、mixed roles
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assignMessageTimestamps, resolveBubbleProducerTs } from '../src/utils/sessionManager.js';

function userMsg(text) {
  return { role: 'user', content: [{ type: 'text', text }] };
}
function asstMsg(text) {
  return { role: 'assistant', content: [{ type: 'text', text }] };
}

describe('assignMessageTimestamps', () => {
  it('首次 entry：prevMainAgentTs=null → assistant msg 仅赋 _timestamp 不赋 _generatedTs', () => {
    const messages = [userMsg('hi')];
    assignMessageTimestamps(messages, [], false, 0, 'T1', null);
    assert.equal(messages[0]._timestamp, 'T1');
    assert.equal(messages[0]._generatedTs, undefined);
  });

  it('第二次 entry：append 1 user msg → 拿 currentTs，无 _generatedTs', () => {
    const prev = [userMsg('hi')];
    prev[0]._timestamp = 'T1';
    const messages = [prev[0], userMsg('continue')];
    assignMessageTimestamps(messages, prev, false, 1, 'T2', 'T1');
    assert.equal(messages[0]._timestamp, 'T1', '历史 user msg 继承 prev _timestamp');
    assert.equal(messages[1]._timestamp, 'T2', '新 user msg 赋 currentTs');
    assert.equal(messages[1]._generatedTs, undefined, '新 user msg 不赋 _generatedTs');
  });

  it('第二次 entry：append 1 assistant msg → 拿 prevMainAgentTs 作 _generatedTs', () => {
    const prev = [userMsg('hi')];
    prev[0]._timestamp = 'T1';
    const messages = [prev[0], asstMsg('hello back')];
    assignMessageTimestamps(messages, prev, false, 1, 'T2', 'T1');
    assert.equal(messages[1]._timestamp, 'T2', '新 assistant msg 赋 currentTs');
    assert.equal(messages[1]._generatedTs, 'T1', '新 assistant msg 赋 prevMainAgentTs 作生成时 ts');
  });

  it('历史 assistant msg 继承 _generatedTs（不重复赋值）', () => {
    const prev = [userMsg('hi'), asstMsg('hello')];
    prev[0]._timestamp = 'T1';
    prev[1]._timestamp = 'T2';
    prev[1]._generatedTs = 'T1';
    const messages = [prev[0], prev[1], userMsg('q2')];
    assignMessageTimestamps(messages, prev, false, 2, 'T3', 'T2');
    assert.equal(messages[1]._timestamp, 'T2', '历史 assistant 保留 _timestamp');
    assert.equal(messages[1]._generatedTs, 'T1', '历史 assistant 保留 _generatedTs（不被改）');
    assert.equal(messages[2]._timestamp, 'T3');
    assert.equal(messages[2]._generatedTs, undefined, '新 user msg 无 _generatedTs');
  });

  it('isNewSession=true：所有 messages 走"新增"分支，不继承 prev', () => {
    const prev = [userMsg('old'), asstMsg('old-resp')];
    prev[0]._timestamp = 'T_old1';
    prev[1]._timestamp = 'T_old2';
    prev[1]._generatedTs = 'T_old1';
    const messages = [userMsg('new convo')];
    assignMessageTimestamps(messages, prev, true, 2, 'T_new', null);
    // 注意 prevCount=2 但 isNewSession=true，强制走 currentTs
    assert.equal(messages[0]._timestamp, 'T_new');
    assert.equal(messages[0]._generatedTs, undefined);
  });

  it('checkpoint 路径：messages 含历史 + 新增，新增 assistant 拿 prevMainAgentTs', () => {
    // 模拟 L223 checkpoint 场景：body.messages 全量 + 新增末尾 assistant turn
    const prev = [userMsg('q1'), asstMsg('a1')];
    prev[0]._timestamp = 'T1';
    prev[1]._timestamp = 'T2';
    prev[1]._generatedTs = 'T1';
    const messages = [
      prev[0], prev[1],
      userMsg('q2'),         // 新增 user
      asstMsg('a2-pending'),  // 新增 assistant —— 应拿 prevMainAgentTs (T2)
    ];
    assignMessageTimestamps(messages, prev, false, 2, 'T3', 'T2');
    assert.equal(messages[2]._timestamp, 'T3');
    assert.equal(messages[2]._generatedTs, undefined);
    assert.equal(messages[3]._timestamp, 'T3');
    assert.equal(messages[3]._generatedTs, 'T2', '新 assistant 拿 prevMainAgentTs');
  });

  it('多个连续新增 assistant msg：每个都拿同一 prevMainAgentTs', () => {
    // 罕见但可能：CLI 一次 entry 包含多个 assistant turn（连续 thinking + tool_use 块）
    const prev = [userMsg('q')];
    prev[0]._timestamp = 'T1';
    const messages = [
      prev[0],
      asstMsg('a-part1'),
      asstMsg('a-part2'),
    ];
    assignMessageTimestamps(messages, prev, false, 1, 'T2', 'T1');
    assert.equal(messages[1]._generatedTs, 'T1');
    assert.equal(messages[2]._generatedTs, 'T1', '所有新 assistant 共享 prevMainAgentTs');
  });

  it('messages 已有 _timestamp（混合输入：部分来自旧版本）→ 不覆盖', () => {
    const prev = [];
    const m = userMsg('preset');
    m._timestamp = 'T_preset';
    const messages = [m];
    assignMessageTimestamps(messages, prev, false, 0, 'T_now', null);
    assert.equal(messages[0]._timestamp, 'T_preset', '已有 _timestamp 不覆盖');
  });

  it('已有 _timestamp 但缺 _generatedTs 的 assistant msg：补 _generatedTs', () => {
    const prev = [];
    const m = asstMsg('legacy');
    m._timestamp = 'T_legacy';
    // 没有 _generatedTs
    const messages = [m];
    assignMessageTimestamps(messages, prev, false, 0, 'T_now', 'T_prev');
    assert.equal(messages[0]._timestamp, 'T_legacy', '已有 _timestamp 不覆盖');
    assert.equal(messages[0]._generatedTs, 'T_prev', '补 _generatedTs');
  });

  it('null/undefined input 安全', () => {
    assert.equal(assignMessageTimestamps(null, [], false, 0, 'T', 'T0'), null);
    assert.equal(assignMessageTimestamps(undefined, [], false, 0, 'T', 'T0'), undefined);
    const messages = [userMsg('a')];
    assignMessageTimestamps(messages, null, false, 0, 'T', 'T0');
    assert.equal(messages[0]._timestamp, 'T');
  });

  it('空 messages 数组：no-op，不抛错', () => {
    const messages = [];
    const result = assignMessageTimestamps(messages, [], false, 0, 'T', 'T0');
    assert.deepEqual(result, []);
  });

  it('真实场景：模拟 L137 → L223 → L341 序列', () => {
    // L137: msgs=[..., user_q1, asst_bash_response]; total=485
    // L223: msgs=[..., user_q1, asst_bash, user_tr_q2, asst_NEW_pending]; total=487, ckpt=true
    //   → 新增 user_tr_q2 (msg[485]) + asst_NEW (msg[486])
    //   → asst_NEW 应拿 L137 的 ts (因为它是 L137 之后被生成的吗？不，是 L223 自己产出的)
    //   → 实际上 assistant msg 总是上一次 entry 的产物
    // 简化模拟：
    const T_L137 = '2026-05-09T04:53:03.000Z';
    const T_L223 = '2026-05-09T04:53:09.039Z';
    const T_L341 = '2026-05-09T04:55:37.783Z';

    // 处理到 L137 后的 mainAgentSessions state
    const afterL137 = [userMsg('q'), asstMsg('bash response')];
    afterL137[0]._timestamp = 'T_old';
    afterL137[1]._timestamp = T_L137;
    afterL137[1]._generatedTs = 'T_prev';

    // L223 来了，新增 2 条（tool_result + 新 user prompt）
    const afterL223Messages = [
      ...afterL137,
      userMsg('tool_result for bash'),  // user 角色 → ts=L223
      userMsg('new user prompt'),        // user 角色 → ts=L223
    ];
    assignMessageTimestamps(afterL223Messages, afterL137, false, 2, T_L223, T_L137);
    assert.equal(afterL223Messages[2]._timestamp, T_L223, 'tool_result user msg ts=L223');
    assert.equal(afterL223Messages[3]._timestamp, T_L223, '新 user prompt ts=L223');
    assert.equal(afterL223Messages[2]._generatedTs, undefined, 'user msg 无 _generatedTs');

    // L341 来了，新增 2 条（L223 的 assistant 响应 + tool_results）
    const afterL341Messages = [
      ...afterL223Messages,
      asstMsg('L223 response'),  // ← 这是 L223 生成的，应拿 T_L223 作 _generatedTs
      userMsg('tool_results from agents'),
    ];
    assignMessageTimestamps(afterL341Messages, afterL223Messages, false, 4, T_L341, T_L223);
    assert.equal(afterL341Messages[4]._timestamp, T_L341, 'assistant ts=L341 (carrier)');
    assert.equal(afterL341Messages[4]._generatedTs, T_L223, '✓ assistant _generatedTs=L223 (生成时)');
    assert.equal(afterL341Messages[5]._timestamp, T_L341);
    assert.equal(afterL341Messages[5]._generatedTs, undefined);
  });
});

/**
 * Offline 批量路径（_processEntries）的 slimmed-entry 回归测试。
 *
 * 这里复现 AppBase.jsx:_processEntries 的双层循环逻辑（push 平行数组 + inner loop 写位）
 * 在 entries 含 _slimmed=true（body.messages=[] 仅 _messageCount 占位）时是否正确。
 *
 * 错题集（2026-05-09 时间戳错位 bug）根因：
 *   早版本在 push 阶段 `isAsst = messages[j] && messages[j].role === 'assistant'`，
 *   slimmed iter 的 messages[j] 是 undefined 让 isAsst=false → 永远 push null →
 *   后续 unslimmed checkpoint 的 inner loop 无法补 _generatedTs → bubble 错位渲染。
 *   修法：push 阶段无条件记录 prevMainAgentTs，inner loop 用 m.role gate 写入。
 *
 * 这些 case 直接模拟双层循环（不经 React class），失败即说明 _processEntries 的
 * push 时 gate / write 时 gate 平衡又退化回 bug。
 */
function simulateProcessEntries(entries, isMainAgentFn) {
  let timestamps = [];
  let generatedTimestamps = [];
  let prevMainAgentTs = null;
  let prevUserId = null;

  for (const entry of entries) {
    if (!isMainAgentFn(entry)) continue;
    if (!entry.body || !Array.isArray(entry.body.messages)) continue;

    const messages = entry.body.messages;
    const count = entry._messageCount || messages.length;
    const ts = entry.timestamp;
    const userId = entry.body.metadata?.user_id || null;
    const prevCount = timestamps.length;

    // 镜像 AppBase.jsx:_processEntries:355-368 的 isNewSession 检测 + reset
    const isNewSession = !!entry._postClearCheckpoint || (prevCount > 0 && (
      (count < prevCount * 0.5 && (prevCount - count) > 4) ||
      (prevUserId && userId && userId !== prevUserId)
    ));
    const isTransient = isNewSession && !entry._postClearCheckpoint && count <= 4 && prevCount > 4 && count < prevCount * 0.5;
    if (isNewSession && !isTransient) {
      timestamps = [];
      generatedTimestamps = [];
      prevMainAgentTs = null;
    }

    for (let j = timestamps.length; j < count; j++) {
      timestamps.push(ts);
      generatedTimestamps.push(prevMainAgentTs || null);
    }
    if (messages.length > 0) {
      for (let j = 0; j < messages.length; j++) {
        const m = messages[j];
        if (!m) continue;
        m._timestamp = timestamps[j];
        if (m.role === 'assistant' && generatedTimestamps[j]) {
          m._generatedTs = generatedTimestamps[j];
        }
      }
    }
    prevUserId = userId;
    prevMainAgentTs = ts;
  }
  return { timestamps, generatedTimestamps };
}

describe('_processEntries slimmed-entry regression (offline batch path)', () => {
  const isMain = e => e.mainAgent === true;

  it('slim entry 占位后 unslimmed checkpoint 能 backfill 范围内 assistant msg 的 _generatedTs', () => {
    // 复现实战 trace：L367 (slim) + L369 (slim) + L487 (checkpoint with full 6 msgs)
    // L367 加 2 条（msg[2]=user, msg[3]=asst from prev）→ slimmed
    // L369 加 2 条（msg[4]=asst from L367, msg[5]=user）→ slimmed
    // L487 是 checkpoint 含全量 6 条 msgs
    // 期望：L487 的 inner loop 写位时，msg[4] 拿到 _generatedTs=L367.ts
    const T1 = '2026-05-09T06:17:11.741Z';
    const T2 = '2026-05-09T06:17:57.709Z';
    const T3 = '2026-05-09T06:21:40.847Z';

    // L367 slim: messages=[] 但 _messageCount=4 占位
    const e1 = { mainAgent: true, timestamp: T1, _messageCount: 4, body: { messages: [] }, _slimmed: true };
    // L369 slim: messages=[] 但 _messageCount=6
    const e2 = { mainAgent: true, timestamp: T2, _messageCount: 6, body: { messages: [] }, _slimmed: true };
    // L487 checkpoint: 全 6 条
    const e3 = { mainAgent: true, timestamp: T3, body: {
      messages: [
        userMsg('q0'),
        asstMsg('a0'),
        userMsg('q1'),
        asstMsg('L367-bash-response'),  // ← msg[3], 应拿 _generatedTs=T1（L367 自己 ts）
        asstMsg('L369-text-response'),  // ← msg[4], 应拿 _generatedTs=T2（L369 自己 ts）
        userMsg('next-prompt'),
      ]
    }, _isCheckpoint: true };

    simulateProcessEntries([e1, e2, e3], isMain);

    // msg[3] 是 L367 iter 推入位（由 e1 slim iter 加的位置），prevMainAgentTs at that time = null
    //   → generatedTimestamps[3]=null, _generatedTs 不写。但 msg[3]._timestamp 是 T1。
    //   等等：L367 slim 的 _messageCount=4，所以 iter 推 j=0..3，prevMainAgentTs 起始 null
    //   → generatedTimestamps[0..3]=[null,null,null,null]
    //   inner loop messages.length=0，不写位
    //   完事后 prevMainAgentTs=T1
    // L369 slim: _messageCount=6，j=4,5 → push T2,T2; gen[4,5]=T1 (after L367)
    //   inner loop messages.length=0，不写位
    //   prevMainAgentTs=T2
    // L487 ckpt: count=6（messages.length=6），j 不再扩展（已 6）
    //   inner loop j=0..5：msgs[3].role=asst gen[3]=null → _generatedTs 不写
    //                       msgs[4].role=asst gen[4]=T1 → _generatedTs=T1
    //   等等，gen[4]=T1 还是 T2？L369 iter 时 prevMainAgentTs=T1，所以 push T1 到 gen[4]
    //   但语义上 msg[4] 是 L369 的响应，应该 _generatedTs=T2（L369 自己 ts）
    //   错了：msg[4] 是 L369 iter 加的位置，那时 prevMainAgentTs 是 L367.ts=T1
    //   所以 gen[4]=T1。msg[4]._generatedTs=T1。
    //   但实际语义：msg[4] 是 L369 的 response 还是 L369 之前的 assistant？
    //   delta storage：L369 entry 的 body.messages 末尾几条是「自上次 entry 以来新增的」。
    //   即 L369 加的 2 条 = [L367 的 response (asst), 新 user msg]。所以 msg[4]=L367 response
    //   不对，等等：mainAgent_count 顺序 L367(4) → L369(6) → L487(6)。
    //   L367 entry 的 body.messages 含 4 条 = [..., last user prompt for L367 (msg[3])]
    //   L367 的 response 是 in `entry.response`，未必在 body.messages 里
    //   下次 L369 来时 body.messages 含 6 = 前 4 + L367 response asst + 1 new
    //   msg[4] = L367 response, msg[5] = new user
    //   所以 msg[4] _generatedTs 应该 = T1（L367 ts），由 L369 iter 的 prevMainAgentTs 提供
    //   但 msg[4] 是 L369 iter 推入位，prevMainAgentTs at that time = T1 ✓
    // L487 来时 msg[5]=L369 response，msg[6 if any] = ...
    // 这里我设 e3 的 messages 模拟简化版：msg[3]=L367 response, msg[4]=L369 response
    // 我应让 e1 _msgCount=4 (前 3 条历史 + msg[3] = L367 response... 等等)
    // 简化：e1 _msgCount=4, msg[3] 是 L367 来时 body 末位（user prompt for L367）
    //       e2 _msgCount=6, msg[4]=L367 response (asst), msg[5]=new user (for L369)
    //       e3 ckpt _msgCount=6, msg[5] 是... 等等 e3 也 6 条
    // 这模拟有点乱。重新设计简洁版：
    // 简单 case：3 条 entries 各加 1 条 msg
    const T_a = '01:00:00';
    const T_b = '02:00:00';
    const T_c = '03:00:00';
    const ea = { mainAgent: true, timestamp: T_a, _messageCount: 1, body: { messages: [] }, _slimmed: true };
    const eb = { mainAgent: true, timestamp: T_b, _messageCount: 2, body: { messages: [] }, _slimmed: true };
    const ec = { mainAgent: true, timestamp: T_c, body: {
      messages: [
        userMsg('q'),                    // msg[0] - L_a iter 推
        asstMsg('a-from-L_a'),           // msg[1] - L_b iter 推（这是 L_a 的 response）
        asstMsg('a-from-L_b'),           // msg[2] - L_c iter 推（这是 L_b 的 response）
      ]
    } };

    simulateProcessEntries([ea, eb, ec], isMain);
    // ea: count=1 → push j=0: ts=T_a, gen[0]=null (prevMainAgent=null)
    //     prevMainAgent=T_a
    // eb: count=2 → push j=1: ts=T_b, gen[1]=T_a
    //     prevMainAgent=T_b
    // ec: messages.length=3, count=3 → push j=2: ts=T_c, gen[2]=T_b
    //     inner loop:
    //       msgs[0].role=user → _ts=T_a, gen=null skip
    //       msgs[1].role=asst gen[1]=T_a → _ts=T_b, _generatedTs=T_a ✓
    //       msgs[2].role=asst gen[2]=T_b → _ts=T_c, _generatedTs=T_b ✓
    //     prevMainAgent=T_c
    assert.equal(ec.body.messages[0]._timestamp, T_a);
    assert.equal(ec.body.messages[0]._generatedTs, undefined, 'user msg 不应有 _generatedTs');
    assert.equal(ec.body.messages[1]._timestamp, T_b, 'msg[1] _timestamp = 携带 entry T_b');
    assert.equal(ec.body.messages[1]._generatedTs, T_a, '✓ msg[1] _generatedTs = T_a (L_a 生成时)');
    assert.equal(ec.body.messages[2]._timestamp, T_c, 'msg[2] _timestamp = T_c');
    assert.equal(ec.body.messages[2]._generatedTs, T_b, '✓ msg[2] _generatedTs = T_b (L_b 生成时)');
  });

  it('连续多个 slimmed entry → 最终 unslimmed checkpoint 一次性 backfill 全部 _generatedTs', () => {
    // 链条：5 个 entry，前 4 个 slim（每个加 2 条），第 5 个是 ckpt（完整 11 条）
    const T = ['10:00', '10:01', '10:02', '10:03', '10:04'];
    const slim = (i, msgCount) => ({
      mainAgent: true, timestamp: T[i], _messageCount: msgCount,
      body: { messages: [] }, _slimmed: true,
    });
    const e0 = slim(0, 1);
    const e1 = slim(1, 3);
    const e2 = slim(2, 5);
    const e3 = slim(3, 7);
    const e4 = { mainAgent: true, timestamp: T[4], _isCheckpoint: true, body: {
      messages: [
        userMsg('q0'),
        userMsg('q1'),
        asstMsg('a-from-e0'),       // msg[2] _generatedTs = T[0]
        userMsg('q2'),
        asstMsg('a-from-e1'),       // msg[4] _generatedTs = T[1]
        userMsg('q3'),
        asstMsg('a-from-e2'),       // msg[6] _generatedTs = T[2]
        userMsg('q4'),
        asstMsg('a-from-e3'),       // msg[8] _generatedTs = T[3]
        userMsg('q5'),
        userMsg('q6'),
      ]
    } };

    simulateProcessEntries([e0, e1, e2, e3, e4], isMain);
    const m = e4.body.messages;
    assert.equal(m[2]._generatedTs, T[0], 'msg[2] from e0 → T[0]');
    assert.equal(m[4]._generatedTs, T[1], 'msg[4] from e1 → T[1]');
    assert.equal(m[6]._generatedTs, T[2], 'msg[6] from e2 → T[2]');
    assert.equal(m[8]._generatedTs, T[3], 'msg[8] from e3 → T[3]');
    // user msgs 都不应有 _generatedTs
    for (const idx of [0, 1, 3, 5, 7, 9, 10]) {
      assert.equal(m[idx]._generatedTs, undefined, `msg[${idx}] (user) 不应有 _generatedTs`);
    }
  });

  it('实战 trace 反 regression：L367 (Bash) + L369 (long markdown) + L487 ckpt', () => {
    // 严格复现 2026-05-09 06:17 - 06:21 时间窗 trace。
    // 数据流（cc-viewer 视角）：
    //   - L367 entry body.messages 末尾新增 2 条 = [L365 response (asst), tool_result (user)]
    //     L367 的 response 在 entry.response 里，下次 entry 才会进 body.messages
    //   - L369 entry body 末尾新增 2 条 = [L367 response (asst, Bash), tool_result/new prompt (user)]
    //     msg[509] 是 L369 iter 推入位 → prevMainAgentTs at that moment = T_367 → _generatedTs=T_367
    //   - L487 ckpt body 末尾新增 2 条 = [L369 response (asst, 长 markdown), new prompt (user)]
    //     msg[511] 是 L487 iter 推入位 → prevMainAgentTs = T_369 → _generatedTs=T_369
    const T_367 = '2026-05-09T06:17:11.741Z';
    const T_369 = '2026-05-09T06:17:57.709Z';
    const T_487 = '2026-05-09T06:21:40.847Z';

    const history = [];
    for (let i = 0; i < 507; i++) {
      history.push(i % 2 === 0 ? userMsg(`u${i}`) : asstMsg(`a${i}`));
    }
    const L487 = { mainAgent: true, timestamp: T_487, _isCheckpoint: true, body: {
      messages: [
        ...history,
        asstMsg('L365 response'),         // msg[507] – L367 iter 推入
        userMsg('tool_result for L365'),  // msg[508] – L367 iter 推入
        asstMsg('L367 response: Bash'),   // msg[509] – L369 iter 推入 → _generatedTs=T_367
        userMsg('tool_result for Bash'),  // msg[510] – L369 iter 推入
        asstMsg('L369 long markdown'),    // msg[511] – L487 iter 推入 → _generatedTs=T_369
        userMsg('next-prompt for L487'),  // msg[512] – L487 iter 推入
      ]
    } };
    const L367 = { mainAgent: true, timestamp: T_367, _messageCount: 509, _slimmed: true, body: { messages: [] } };
    const L369 = { mainAgent: true, timestamp: T_369, _messageCount: 511, _slimmed: true, body: { messages: [] } };

    simulateProcessEntries([L367, L369, L487], isMain);
    const m = L487.body.messages;

    assert.equal(m[507]._timestamp, T_367, 'msg[507] _timestamp = T_367 (L367 iter carrier)');
    assert.equal(m[507]._generatedTs, undefined,
      'msg[507] 是 L367 iter 首推位，prevMainAgent=null (本测试窗口内 L367 是首条)');

    assert.equal(m[509]._timestamp, T_369, 'msg[509] _timestamp = T_369 (L369 iter carrier)');
    assert.equal(m[509]._generatedTs, T_367,
      '✓ msg[509] _generatedTs = T_367 (是 L367 的 Bash response, 由 L369 iter 推入时 prev=T_367)');

    assert.equal(m[511].role, 'assistant',
      'precondition: msg[511] 必须是 assistant（L369 长 markdown response）');
    assert.equal(m[511]._timestamp, T_487, 'msg[511] _timestamp = T_487 (L487 iter carrier)');
    assert.equal(m[511]._generatedTs, T_369,
      '✓ msg[511] _generatedTs = T_369 (是 L369 的 long markdown response, 由 L487 iter 推入时 prev=T_369)');

    // 旧 fix bug regress signal：msg[511] _generatedTs=undefined 会让 ChatMessage fallback
    // 到 _timestamp=T_487，导致 bubble 渲染 14:21:40 而不是 14:17:57（截图复现）。
    // 修后：m[511]._generatedTs=T_369 → ChatMessage displayTs=T_369 → bubble 14:17:57。
    assert.notEqual(m[511]._generatedTs, undefined,
      'regress 哨兵：msg[511] 必须有 _generatedTs，否则 bubble 错位回 14:21:40');
  });

  it('isNewSession reset：长 session 后 count 骤降触发 reset，新 entry 走全新 timestamps 链', () => {
    // 模拟 /clear 之类的 session boundary：第一次 entry 长 session，第二次骤降至 1 条
    // _processEntries 应检测 (count < prevCount * 0.5) && (prevCount - count > 4) →
    // 视为 isNewSession，reset 三个累积变量。
    const T_old = '09:00:00';
    const T_new = '10:00:00';
    const old = { mainAgent: true, timestamp: T_old, _isCheckpoint: true, body: {
      messages: Array.from({ length: 20 }, (_, i) =>
        i % 2 === 0 ? userMsg(`u${i}`) : asstMsg(`a${i}`)
      )
    } };
    // 新 session 起点：5 条 messages（< 20*0.5=10 且 20-5=15>4）
    const fresh = { mainAgent: true, timestamp: T_new, _isCheckpoint: true, body: {
      messages: [
        userMsg('new q1'),
        asstMsg('new a1'),  // ← 这条是新 session 第一条 asst，prevMainAgentTs=null（reset 后），不应有 _generatedTs
        userMsg('new q2'),
        asstMsg('new a2'),  // ← 这条 prev=T_new (本 entry 自己) 不算 cross-session
        userMsg('new q3'),
      ]
    } };
    simulateProcessEntries([old, fresh], isMain);
    const m = fresh.body.messages;
    assert.equal(m[0]._timestamp, T_new, 'fresh msg[0] 拿 T_new');
    assert.equal(m[1]._timestamp, T_new);
    assert.equal(m[1]._generatedTs, undefined,
      '✓ session reset 后第一条 assistant prevMainAgent=null，不应有 _generatedTs（防跨 session 串场）');
    // 注：实战里 fresh 自己也是 mainAgent entry，处理完后 prevMainAgentTs=T_new；
    //     fresh 本身的 messages 在同 iter 内推入，所以所有 fresh msg 推时 prevMainAgent 都是 reset 后的 null。
    //     m[3] 的 _generatedTs 也应是 undefined 而非 T_old（错的）也非 T_new（自己）
    assert.equal(m[3]._generatedTs, undefined, 'reset 后同 entry 内 asst msg 不应继承 T_old 也不会自指');
  });
});

/**
 * resolveBubbleProducerTs 纯函数单测
 * 用途：双向映射 msg ↔ request 的 lookup key
 *   - "查看请求"按钮 (ChatView.jsx:1228 reqIdx 计算)
 *   - 网络报文→对话反向跳转 (ChatView.jsx:1791 tsItemMap 注册)
 *
 * 语义：assistant msg 用 _generatedTs（producer 的 request ts），其他 role 用 _timestamp。
 */
describe('resolveBubbleProducerTs', () => {
  it('assistant msg 有 _generatedTs → 返回 _generatedTs', () => {
    const m = { role: 'assistant', _timestamp: 'T_carrier', _generatedTs: 'T_gen' };
    assert.equal(resolveBubbleProducerTs(m), 'T_gen');
  });

  it('assistant msg 无 _generatedTs → fallback 到 _timestamp（兼容首条 entry / 旧 cache）', () => {
    const m = { role: 'assistant', _timestamp: 'T_carrier' };
    assert.equal(resolveBubbleProducerTs(m), 'T_carrier');
  });

  it('user msg → 返回 _timestamp（即使有 _generatedTs 也忽略）', () => {
    // user msg 不应有 _generatedTs，即使被错误注入也不能用它（user 的 carrier ts = request 自身 ts，已经对）
    const m = { role: 'user', _timestamp: 'T_carrier', _generatedTs: 'T_should_ignore' };
    assert.equal(resolveBubbleProducerTs(m), 'T_carrier');
  });

  it('null / undefined / 空对象 → 返回 null', () => {
    assert.equal(resolveBubbleProducerTs(null), null);
    assert.equal(resolveBubbleProducerTs(undefined), null);
    assert.equal(resolveBubbleProducerTs({}), null);
  });

  it('msg 缺所有 ts 字段 → 返回 null（不是 undefined）', () => {
    assert.equal(resolveBubbleProducerTs({ role: 'assistant' }), null);
    assert.equal(resolveBubbleProducerTs({ role: 'user' }), null);
  });
});

// ============================================================================
// applyBatchEntryTimestamps — v2 synthetic entry 保护式（真实 ts 不被位置覆写）
// ============================================================================

describe('applyBatchEntryTimestamps synthetic-v2 protective branch', () => {
  // applyBatchEntryTimestamps needs the session-boundary imports, which the
  // vite shims resolve — dynamic import through the register hook.
  it('synthetic v2 entry 保留逐消息预置时间戳（不被 entry.ts 抹平）', async () => {
    await import('./_shims/register.mjs');
    const { applyBatchEntryTimestamps } = await import('../src/utils/sessionManager.js');

    const entryTs = '2026-07-30T03:43:40.000Z';
    const m0 = { role: 'user', content: 'a', _timestamp: '2026-07-30T03:43:40.000Z', _generatedTs: undefined, _entryTs: entryTs };
    const m1 = { role: 'assistant', content: 'b', _timestamp: '2026-07-30T03:43:41.000Z', _generatedTs: '2026-07-30T03:43:41.000Z', _entryTs: entryTs };
    const m2 = { role: 'user', content: 'c', _timestamp: '2026-07-30T03:43:42.000Z', _generatedTs: undefined, _entryTs: entryTs };
    const entry = { mainAgent: true, _syntheticV2: true, timestamp: entryTs, _seqEpoch: 'v2:sid:0', body: { messages: [m0, m1, m2] } };
    const st = { timestamps: [], generatedTimestamps: [], prevMainAgentTs: null, prevEpoch: null, prevUserId: null, currentSessionId: null };

    applyBatchEntryTimestamps(st, entry);

    // 逐消息真实 ts 保留（未被 entry.ts 覆盖）
    assert.equal(m0._timestamp, '2026-07-30T03:43:40.000Z');
    assert.equal(m1._timestamp, '2026-07-30T03:43:41.000Z');
    assert.equal(m2._timestamp, '2026-07-30T03:43:42.000Z');
    assert.equal(m1._generatedTs, '2026-07-30T03:43:41.000Z');
  });

  it('synthetic v2 entry 缺 _timestamp 的消息回退到位置时间戳（不产生 undefined）', async () => {
    await import('./_shims/register.mjs');
    const { applyBatchEntryTimestamps } = await import('../src/utils/sessionManager.js');

    const entryTs = '2026-07-30T03:43:40.000Z';
    const m0 = { role: 'user', content: 'a', _timestamp: entryTs, _entryTs: entryTs };
    const m1 = { role: 'assistant', content: 'b' }; // 缺 _timestamp（防御性）
    const entry = { mainAgent: true, _syntheticV2: true, timestamp: entryTs, _seqEpoch: 'v2:sid:0', body: { messages: [m0, m1] } };
    const st = { timestamps: [], generatedTimestamps: [], prevMainAgentTs: null, prevEpoch: null, prevUserId: null, currentSessionId: null };

    applyBatchEntryTimestamps(st, entry);

    assert.equal(m1._timestamp, entryTs); // 回退到 entry.ts（非 undefined）
  });

  it('synthetic v2 entry 不被 transient 守卫吞掉（legacy 长会话后紧随短 v2 会话）', async () => {
    await import('./_shims/register.mjs');
    const { applyBatchEntryTimestamps } = await import('../src/utils/sessionManager.js');

    // 前置：legacy 长会话（5 条）已累积
    const st = {
      timestamps: ['t1', 't2', 't3', 't4', 't5'],
      generatedTimestamps: [null, 't1', null, 't3', null],
      prevMainAgentTs: 't5',
      prevEpoch: null, // 首个 v2 entry 的 prevEpoch 为 null（epochChanged 恒 false）
      prevUserId: 'legacy-user',
      currentSessionId: 't1',
    };
    // 紧随其后的短 v2 合成会话（3 条，<=4）
    const entryTs = '2026-07-30T03:43:40.000Z';
    const m0 = { role: 'user', content: 'a', _timestamp: entryTs, _entryTs: entryTs };
    const m1 = { role: 'assistant', content: 'b', _timestamp: entryTs, _generatedTs: entryTs, _entryTs: entryTs };
    const m2 = { role: 'user', content: 'c', _timestamp: entryTs, _entryTs: entryTs };
    const entry = { mainAgent: true, _syntheticV2: true, timestamp: entryTs, _seqEpoch: 'v2:sid:0', body: { messages: [m0, m1, m2] } };

    applyBatchEntryTimestamps(st, entry);

    // 必须是新会话（currentSessionId 推进到 v2 entry ts，位置数组重置），不被 transient 丢弃
    assert.equal(st.currentSessionId, entryTs);
    assert.deepEqual(st.timestamps, [entryTs, entryTs, entryTs]);
  });
});
