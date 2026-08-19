/**
 * 完成序倒置（completion-order inversion）端到端测试
 *
 * 背景（mainAgent 整段重复 bug 根因，详见 docs/WIRE_FORMAT.md §3.7）：
 * interceptor 在请求发起时冻结 entry 形态（delta/checkpoint/信号），但 completed entry
 * 按响应完成顺序落盘。burst 下慢请求 A 的条目落在快请求 B 之后 → 文件序倒置 →
 * 服务端 watcher 增量重建器把 stale delta 拼到新 checkpoint 之后（length ≠ _totalMessageCount）
 * → 客户端 reconstructor 把这条"已是全量"的脏条目再当 delta 整段拼接 → 对话整段翻倍。
 *
 * 防线（本测试逐条验证）：
 *   Fix 1: entry._seq/_seqEpoch 单调序号，reconstructor 乱序守卫（_staleReorder）
 *   Fix 2: 增量 reconstructor _totalMessageCount 完整性校验（slice 修复 / _reconstructBroken，带基线门控）
 *   Fix 3: sessionMerge 等长 anchor-miss 分支内容感知（近似拷贝→替换而非整段 append）
 *   Fix 4: merge 入口跳过 _staleReorder/_reconstructBroken 条目
 *
 * 链路完全模拟生产：file entries → server watcher reconstructor（log-watcher._readDelta）
 * → JSON 序列化广播 → 客户端 _sseReconstructor → merge 入口守卫 →
 * applyInPlaceLastMsgReplace / mergeMainAgentSessions。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createIncrementalReconstructor, reconstructEntries } from '../packages/app/server/lib/delta-reconstructor.js';
import { streamReconstructedEntries } from '../packages/app/server/lib/log-stream.js';
import { mergeMainAgentSessions, messageFingerprint, isMergeBlockedEntry, shouldDegradeBrokenMerge } from '../apps/web/src/utils/sessionMerge.js';
import { applyInPlaceLastMsgReplace } from '../apps/web/src/utils/sessionManager.js';

// ============================================================================
// 构造器
// ============================================================================

function mkMsg(i, role) {
  return { role, content: `msg-${i}-${role}-content-padding-${'x'.repeat(16)}-${i}` };
}

/** 生成 n 条 user/assistant 交替消息 */
function conv(n, startAt = 1) {
  const out = [];
  for (let i = startAt; i < startAt + n; i++) {
    out.push(mkMsg(i, i % 2 === 1 ? 'user' : 'assistant'));
  }
  return out;
}

let _tsCounter = 0;
function nextTs() {
  _tsCounter++;
  return new Date(1700000000000 + _tsCounter * 1000).toISOString();
}

function baseEntry() {
  return {
    timestamp: nextTs(),
    url: 'https://api.anthropic.com/v1/messages',
    mainAgent: true,
    body: {
      model: 'claude-opus-4-6',
      metadata: { user_id: 'user_test_account_session_1' },
      messages: [],
    },
    response: {
      status: 200,
      body: { content: [{ type: 'text', text: 'resp' }], usage: { input_tokens: 1, output_tokens: 1 } },
    },
  };
}

function checkpointEntry({ msgs, seq, epoch = 'ep1', signal = false }) {
  const e = baseEntry();
  e._deltaFormat = 1;
  e._isCheckpoint = true;
  e._totalMessageCount = msgs.length;
  e._conversationId = 'mainAgent';
  if (signal) e._inPlaceReplaceDetected = true;
  if (seq != null) { e._seq = seq; e._seqEpoch = epoch; }
  e.body.messages = msgs.map(m => ({ ...m }));
  return e;
}

function deltaEntry({ slice, total, seq, epoch = 'ep1' }) {
  const e = baseEntry();
  e._deltaFormat = 1;
  e._isCheckpoint = false;
  e._totalMessageCount = total;
  e._conversationId = 'mainAgent';
  if (seq != null) { e._seq = seq; e._seqEpoch = epoch; }
  e.body.messages = slice.map(m => ({ ...m }));
  return e;
}

function asInProgress(entry) {
  return { ...JSON.parse(JSON.stringify(entry)), inProgress: true, requestId: 'req_x' };
}

const deepCopy = (o) => JSON.parse(JSON.stringify(o));

// ============================================================================
// 管线模拟
// ============================================================================

/** 服务端 watcher：按文件序逐条 reconstruct 后 JSON 序列化广播（log-watcher.js _readDelta） */
function serverBroadcast(fileEntries) {
  const recon = createIncrementalReconstructor();
  const out = [];
  for (const raw of fileEntries) {
    const parsed = deepCopy(raw);
    recon.reconstruct(parsed);
    out.push(deepCopy(parsed)); // sendToClients 是 JSON.stringify，引用解耦
  }
  return out;
}

/** 客户端 SSE merge 入口（镜像 AppBase.jsx _flushPendingEntries 的 merge 块，守卫谓词与生产共用） */
function clientMergeSse(sessions, entry) {
  if (!(entry.mainAgent && entry.body && Array.isArray(entry.body.messages))) return sessions;
  if (entry.teammate) return sessions;
  if (isMergeBlockedEntry(entry)) return sessions;
  const ts = entry.timestamp;
  const r = applyInPlaceLastMsgReplace(sessions, entry, ts, false);
  if (r.applied) return r.sessions;
  return mergeMainAgentSessions(sessions, entry, { skipTransientFilter: true });
}

/** 客户端全链路：_sseReconstructor → merge（AppBase.jsx:1549-1659） */
function runClientPipeline(broadcasts, sessions = []) {
  const recon = createIncrementalReconstructor();
  for (const raw of broadcasts) {
    const entry = recon.reconstruct(deepCopy(raw));
    sessions = clientMergeSse(sessions, entry);
  }
  return sessions;
}

/** 批量（强刷）路径：客户端 reconstructEntries → 批量 merge（含 inProgress/守卫，镜像 _processOneEntry） */
function runBatchPipeline(fileEntries) {
  const entries = reconstructEntries(fileEntries.map(deepCopy));
  let sessions = [];
  for (const entry of entries) {
    // KEEP IN SYNC (AppBase.jsx _processOneEntry): the batch gate plus the
    // broken-carrier degradation exception; a degraded carrier is stamped
    // _partialData so the merge create branches propagate it.
    if (isMergeBlockedEntry(entry, { batch: true }) && !shouldDegradeBrokenMerge(entry, sessions)) continue;
    if (!(entry.mainAgent && entry.body && Array.isArray(entry.body.messages))) continue;
    if (shouldDegradeBrokenMerge(entry, sessions)) entry._partialData = true;
    sessions = mergeMainAgentSessions(sessions, entry);
  }
  return sessions;
}

function fps(msgs) { return msgs.map(messageFingerprint); }

function assertNoDuplication(sessions, expectedLen, label) {
  assert.equal(sessions.length, 1, `${label}: 应只有 1 个 session，实际 ${sessions.length}`);
  const f = fps(sessions[0].messages);
  const uniq = new Set(f);
  assert.equal(uniq.size, f.length, `${label}: 消息出现重复（共 ${f.length} 条，唯一 ${uniq.size} 条）`);
  if (expectedLen != null) {
    assert.equal(f.length, expectedLen, `${label}: 消息数应为 ${expectedLen}，实际 ${f.length}`);
  }
}

// ============================================================================
// 场景数据：N=6 基线 + A/B 倒置对
// ============================================================================

/** 构造倒置场景：cp(6 条) → A(seq2 慢) / B(seq3 快，先落盘)。
 *  m7 为 A 发起时的末位（SUGGESTION MODE 占位），m7p 为 B 的原地替换真值。 */
function buildInversionScenario({ aShape }) {
  const base = conv(6);                       // m1..m6
  const m7 = mkMsg(7, 'user');                // A 视角末位
  const m7p = { role: 'user', content: `msg-7-user-REPLACED-real-input-${'y'.repeat(16)}` };
  const cp = checkpointEntry({ msgs: base, seq: 1 });
  const full7a = [...base, m7];
  const full7b = [...base, m7p];
  let A;
  if (aShape === 'delta') {
    A = deltaEntry({ slice: [m7], total: 7, seq: 2 });
  } else if (aShape === 'checkpoint-unsignaled') {
    A = checkpointEntry({ msgs: full7a, seq: 2 }); // 定期 %10 checkpoint，无信号
  }
  const B = checkpointEntry({ msgs: full7b, seq: 3, signal: true });
  return { cp, A, B, full7b };
}

// ============================================================================
// 测试
// ============================================================================

describe('完成序倒置：SSE 实时链路', () => {
  it('B(checkpoint+信号) 先于 A(delta) 落盘 → 不得整段翻倍', () => {
    const { cp, A, B } = buildInversionScenario({ aShape: 'delta' });
    const sessions = runClientPipeline(serverBroadcast([cp, B, A]));
    assertNoDuplication(sessions, 7, 'B先A后(A=delta)');
  });

  it('A 为无信号定期 checkpoint 的倒置变体 → stale checkpoint 同样被跳过', () => {
    const { cp, A, B, full7b } = buildInversionScenario({ aShape: 'checkpoint-unsignaled' });
    const sessions = runClientPipeline(serverBroadcast([cp, B, A]));
    assertNoDuplication(sessions, 7, 'B先A后(A=checkpoint)');
    // 末位应保持 B 的替换真值（m7p），不被 stale A 回退
    const last = sessions[0].messages[6];
    assert.equal(messageFingerprint(last), messageFingerprint(full7b[6]), '末位应为 B 的替换真值');
  });

  it('双 delta 倒置：lastSeq 由 delta 推进，迟到的 A 判 stale；下一 checkpoint 自愈', () => {
    const base = conv(6);
    const m7 = mkMsg(7, 'user');
    const m8 = mkMsg(8, 'assistant');
    const cp = checkpointEntry({ msgs: base, seq: 1 });
    const A = deltaEntry({ slice: [m7], total: 7, seq: 2 });      // 慢
    const B = deltaEntry({ slice: [m8], total: 8, seq: 3 });      // 快，先落盘
    const cp2 = checkpointEntry({ msgs: [...base, m7, m8], seq: 4 }); // 后续定期 checkpoint
    const sessions = runClientPipeline(serverBroadcast([cp, B, A, cp2]));
    assertNoDuplication(sessions, 8, '双delta倒置');
  });

  it('缩短型 checkpoint（/compact）跨倒置：毒化基底冻结，下一 checkpoint 自愈', () => {
    // 旧会话 6 条 → /compact checkpoint A(seq2, 慢, 2 条 summary) 与后继 delta B(seq3, total 3, 快) 倒置。
    // 无毒化冻结时：B 触发 slice(0,3)=旧会话前 3 条（错误内容但长度自洽），后续 delta 在毒化
    // 基底上拼接长度全对 → 永不自愈，旧前缀永久残留。修复后：冻结到 cp5 全量重置。
    const oldConv = conv(6);
    const sum1 = { role: 'user', content: `compact-summary-1-${'s'.repeat(16)}` };
    const sum2 = { role: 'assistant', content: `compact-summary-2-${'s'.repeat(16)}` };
    const n1 = mkMsg(101, 'user');
    const n2 = mkMsg(102, 'assistant');
    const cp0 = checkpointEntry({ msgs: oldConv, seq: 1 });
    const A = checkpointEntry({ msgs: [sum1, sum2], seq: 2 });          // /compact，慢
    const B = deltaEntry({ slice: [n1], total: 3, seq: 3 });            // 快，先落盘
    const C = deltaEntry({ slice: [n2], total: 4, seq: 4 });
    const cp5 = checkpointEntry({ msgs: [sum1, sum2, n1, n2], seq: 5 }); // 定期 checkpoint
    const sessions = runClientPipeline(serverBroadcast([cp0, B, A, C, cp5]));
    const last = sessions[sessions.length - 1];
    const f = fps(last.messages);
    assert.equal(new Set(f).size, f.length, '不得有重复消息');
    assert.equal(f.length, 4, `终态应为 compact 后真值 4 条，实际 ${f.length}`);
    assert.ok(!f.some(fp => fp.includes('msg-1-') || fp.includes('msg-2-')), '旧会话前缀不得残留');
  });

  it('连续两条脏广播 → 不得堆叠多份拷贝', () => {
    const base = conv(6);
    const m7 = mkMsg(7, 'user');
    const m8 = mkMsg(8, 'assistant');
    const cp = checkpointEntry({ msgs: base, seq: 1 });
    const A1 = deltaEntry({ slice: [m7], total: 7, seq: 2 });
    const A2 = deltaEntry({ slice: [m8], total: 8, seq: 3 });
    const B = checkpointEntry({ msgs: [...base, m7, m8], seq: 4 }); // 快，先落盘
    // 文件序：cp, B, A1, A2 —— 修复前 A1/A2 连环把全量再拼两次（≥3 份拷贝）
    const sessions = runClientPipeline(serverBroadcast([cp, B, A1, A2]));
    assertNoDuplication(sessions, 8, '连环脏广播');
  });
});

describe('reconstructor 守卫细节', () => {
  it('placeholder + completed 同 _seq 对：completed 不被幂等规则误吞', () => {
    const base = conv(6);
    const cp = checkpointEntry({ msgs: base, seq: 1 });
    const m7 = mkMsg(7, 'user');
    const d = deltaEntry({ slice: [m7], total: 7, seq: 2 });
    const fileEntries = [asInProgress(cp), cp, asInProgress(d), d];
    const recon = createIncrementalReconstructor();
    let lastEntry = null;
    for (const raw of fileEntries) {
      lastEntry = recon.reconstruct(deepCopy(raw));
    }
    assert.ok(!lastEntry._staleReorder, 'completed delta 不应被同 seq 误判 stale');
    assert.equal(lastEntry.body.messages.length, 7, 'completed delta 应重建为 7 条全量');
  });

  it('同条 completed 重发（轮转 race）：幂等且 body.messages 回写全量', () => {
    const base = conv(6);
    const cp = checkpointEntry({ msgs: base, seq: 1 });
    const m7 = mkMsg(7, 'user');
    const d = deltaEntry({ slice: [m7], total: 7, seq: 2 });
    const recon = createIncrementalReconstructor();
    recon.reconstruct(deepCopy(cp));
    const first = recon.reconstruct(deepCopy(d));
    assert.equal(first.body.messages.length, 7);
    const replay = recon.reconstruct(deepCopy(d)); // 同 seq 重发
    assert.equal(replay.body.messages.length, 7, '重发条目应回写全量而非裸 delta');
    const f = fps(replay.body.messages);
    assert.equal(new Set(f).size, 7, '重发不得重复累积');
  });

  it('冷启动（无基线）收 delta 流：不标 broken，行为与现状一致', () => {
    // server 重启 / 客户端 reconstructor 重建后，从对话中段开始收 delta
    const m7 = mkMsg(7, 'user');
    const recon = createIncrementalReconstructor();
    const d = recon.reconstruct(deepCopy(deltaEntry({ slice: [m7], total: 7, seq: 12 })));
    assert.ok(!d._reconstructBroken, '冷启动 delta 不应标 broken');
    assert.ok(!d._staleReorder, '冷启动 delta 不应标 stale');
    assert.equal(d.body.messages.length, 1, '冷启动维持现状透传');
  });

  it('epoch 变化（进程重启 seq 归零）：接受条目并重置基线', () => {
    const base = conv(6);
    const recon = createIncrementalReconstructor();
    recon.reconstruct(deepCopy(checkpointEntry({ msgs: base, seq: 100, epoch: 'ep1' })));
    // 进程重启：epoch 变化、seq 归 1、首条必 checkpoint
    const m7 = mkMsg(7, 'user');
    const cp2 = recon.reconstruct(deepCopy(checkpointEntry({ msgs: [...base, m7], seq: 1, epoch: 'ep2' })));
    assert.ok(!cp2._staleReorder, '新 epoch 的 checkpoint 不应判 stale');
    const d = recon.reconstruct(deepCopy(deltaEntry({ slice: [mkMsg(8, 'assistant')], total: 8, seq: 2, epoch: 'ep2' })));
    assert.equal(d.body.messages.length, 8, '新 epoch 基线生效');
  });

  it('stale 就地补偿内容 = 累积真值前缀（非裸 delta 切片、非错位前缀）', () => {
    // 突变缺口：此前仅断言长度，_markStaleEntry 跳过 slice 回填也能全绿。
    // 这里逐条 deep-equal 锁内容：stale 条目的 messages 必须等于 accumulated.slice(0, total)。
    const base = conv(8);
    const recon = createIncrementalReconstructor();
    recon.reconstruct(deepCopy(checkpointEntry({ msgs: base, seq: 5 })));
    // 迟到的慢请求：seq 2 < lastSeq 5 → stale；total 7 ≤ accumulated 8 → 就地补偿
    const stale = recon.reconstruct(deepCopy(deltaEntry({ slice: [mkMsg(7, 'user')], total: 7, seq: 2 })));
    assert.ok(stale._staleReorder, '乱序条目应标 stale');
    assert.deepEqual(stale.body.messages, base.slice(0, 7),
      '就地补偿内容必须 = 累积真值的前 total 条，不能是裸 delta 切片');
  });

  it('基线已建立后的不足长 delta（真断裂快 delta）：标 _reconstructBroken', () => {
    // 与冷启动测试（不标 broken）配对，锁 baselineSeen 门的两端：
    // 无基线 → 透传；有基线 → 长度不足即真断裂，必须冻结防错位拼接。
    const base = conv(6);
    const recon = createIncrementalReconstructor();
    recon.reconstruct(deepCopy(checkpointEntry({ msgs: base, seq: 1 })));
    // accumulated=6+1=7 < total=9：声称 9 条但累积只够 7 → 断裂
    const d = recon.reconstruct(deepCopy(deltaEntry({ slice: [mkMsg(7, 'user')], total: 9, seq: 2 })));
    assert.ok(d._reconstructBroken, '基线存在且重建长度不足 → 必须标 _reconstructBroken');
    assert.ok(isMergeBlockedEntry(d), 'broken 条目必须被 merge 入口阻断');
  });

  it('teammate 条目（mainAgent:true 双标）不得污染 accumulated', () => {
    const base = conv(6);
    const recon = createIncrementalReconstructor();
    recon.reconstruct(deepCopy(checkpointEntry({ msgs: base, seq: 1 })));
    // 子进程 teammate：mainAgent:true + teammate 字段 + 自己进程的 seq 空间
    const tm = checkpointEntry({ msgs: conv(3, 100), seq: 1, epoch: 'tm-ep' });
    tm.teammate = 'worker-1';
    recon.reconstruct(deepCopy(tm));
    const d = recon.reconstruct(deepCopy(deltaEntry({ slice: [mkMsg(7, 'user')], total: 7, seq: 2 })));
    assert.equal(d.body.messages.length, 7, 'teammate 条目不应重置/污染 lead 的 accumulated');
    const f = fps(d.body.messages);
    assert.ok(!f.some(fp => fp.includes('msg-100')), 'lead 重建结果不得混入 teammate 消息');
  });
});

describe('双层重建 load-bearing 不变量（server 打标 → client 二次重建）', () => {
  it('client 中途接入缺 seq 高水位：server-stale 条目即便 client 判 ok 仍被 merge 阻断', () => {
    // 双层重建的安全性依赖两条独立机制（缺一即翻车，详见 WIRE_FORMAT.md §3.7）：
    // (1) server 就地补偿后 _totalMessageCount === messages.length → client 二次重建
    //     走隐式 checkpoint 分支（不二次拼接）；
    // (2) client 永不清除 server 广播来的 _staleReorder → 即便 client 自己的 seqState
    //     缺高水位判 'ok'（中途接入场景），isMergeBlockedEntry 仍兜底阻断。
    // 本测试钉死机制 (2)：把它从"恰好成立"变成"断言成立"。
    const base = conv(8);
    // 服务端视角：cp(seq5, 8条) 已落，迟到 stale delta(seq2, total7) 就地补偿 + 打标
    const serverRecon = createIncrementalReconstructor();
    serverRecon.reconstruct(deepCopy(checkpointEntry({ msgs: base, seq: 5 })));
    const staleSrv = serverRecon.reconstruct(
      deepCopy(deltaEntry({ slice: [mkMsg(7, 'user')], total: 7, seq: 2 })));
    assert.ok(staleSrv._staleReorder, '前置：server 已标 stale');
    assert.equal(staleSrv.body.messages.length, 7,
      '前置：已就地补偿为全量 → total===length，client 将按隐式 checkpoint 处理');

    // 客户端视角：SSE 中途接入（fresh reconstructor，seqState 无高水位），
    // stale 广播是它收到的第一条 → 自己的 _seqGuardCheck 判 'ok' 而非 stale
    const clientRecon = createIncrementalReconstructor();
    const cEntry = clientRecon.reconstruct(deepCopy(staleSrv));
    assert.ok(cEntry._staleReorder,
      'client 二次重建不得清除 server 设的 _staleReorder（load-bearing 不变量）');
    assert.ok(isMergeBlockedEntry(cEntry),
      'client 独立判 ok 的 server-stale 条目必须仍被 merge 阻断');
    let sessions = clientMergeSse([], cEntry);
    assert.equal(sessions.length, 0, 'stale 内容不得进入 sessions');

    // 后续正常 checkpoint 到达：client 收敛到真值，无重复
    const cp2 = clientRecon.reconstruct(
      deepCopy(checkpointEntry({ msgs: [...base, mkMsg(9, 'user')], seq: 6 })));
    sessions = clientMergeSse(sessions, cp2);
    assertNoDuplication(sessions, 9, '中途接入后收敛');
  });
});

describe('完成序倒置：批量（强刷）链路', () => {
  it('文件序倒置 + 脏条目为末条无后续 checkpoint：无残留重复', () => {
    const { cp, A, B } = buildInversionScenario({ aShape: 'delta' });
    const sessions = runBatchPipeline([cp, B, A]); // A 为文件末条
    assertNoDuplication(sessions, 7, '批量倒置末条');
  });

  it('后续 checkpoint 补偿成功的 stale 条目清除标记 → 批量 merge 正常消费', () => {
    // 构造走 _compensateBrokenEntries 路径的 stale：A 声称的 total(8) 大于其到达时
    // accumulated(7)，就地补偿不可行 → 由后续 cp2 回填真值前缀并清标记。
    // （就地补偿路径故意保留标记：毒化场景下就地内容可能错位，不能放行 merge。）
    const base = conv(6);
    const m7p = { role: 'user', content: `msg-7-user-REPLACED-real-input-${'y'.repeat(16)}` };
    const x8 = mkMsg(8, 'assistant');
    const x9 = mkMsg(9, 'user');
    const cp = checkpointEntry({ msgs: base, seq: 1 });
    const A = deltaEntry({ slice: [m7p, x8], total: 8, seq: 2 });  // 慢
    const B = checkpointEntry({ msgs: [...base, m7p], seq: 3 });    // 快，先落盘（7 条）
    const cp2 = checkpointEntry({ msgs: [...base, m7p, x8, x9], seq: 4 }); // 后续可补偿（9 条）
    const entries = reconstructEntries([cp, B, A, cp2].map(deepCopy));
    const staleA = entries.find(e => e._seq === 2);
    assert.ok(staleA, '应包含 A');
    assert.ok(!staleA._staleReorder && !staleA._reconstructBroken, '补偿成功应清除标记');
    assert.equal(staleA.body.messages.length, 8, '补偿内容应为真值前缀（8 条）');
    let sessions = [];
    for (const entry of entries) {
      if (isMergeBlockedEntry(entry, { batch: true })) continue;
      if (!(entry.mainAgent && entry.body && Array.isArray(entry.body.messages))) continue;
      sessions = mergeMainAgentSessions(sessions, entry);
    }
    assertNoDuplication(sessions, 9, '补偿后批量消费');
  });

  it('旧日志（无 _seq）顺序流：行为与现状一致', () => {
    const base = conv(6);
    const m7 = mkMsg(7, 'user');
    const m8 = mkMsg(8, 'assistant');
    const cp = checkpointEntry({ msgs: base });
    const d1 = deltaEntry({ slice: [m7], total: 7 });
    const d2 = deltaEntry({ slice: [m8], total: 8 });
    delete cp._seq; delete cp._seqEpoch;
    delete d1._seq; delete d1._seqEpoch;
    delete d2._seq; delete d2._seqEpoch;
    const sessions = runBatchPipeline([cp, d1, d2]);
    assertNoDuplication(sessions, 8, '旧日志顺序流');
    const sse = runClientPipeline(serverBroadcast([cp, d1, d2]));
    assertNoDuplication(sse, 8, '旧日志顺序流(SSE)');
  });

  it('旧日志（无 _seq）倒置流：Fix 2/3 兜底不翻倍', () => {
    const { cp, A, B } = buildInversionScenario({ aShape: 'delta' });
    for (const e of [cp, A, B]) { delete e._seq; delete e._seqEpoch; }
    const sessions = runClientPipeline(serverBroadcast([cp, B, A]));
    // 无 seq 时允许末位短暂陈旧（A 的 m7 覆盖 m7p），但绝不允许整段翻倍
    assert.equal(sessions.length, 1);
    const f = fps(sessions[0].messages);
    assert.equal(new Set(f).size, f.length, '旧日志倒置不得出现重复消息');
    assert.ok(f.length <= 8, `旧日志倒置消息数不应膨胀（实际 ${f.length}）`);
  });
});

describe('段级流式路径（streamReconstructedEntries，跨段共享 seqState）', () => {
  function writeJsonl(dir, name, entries) {
    const p = join(dir, name);
    for (const e of entries) appendFileSync(p, JSON.stringify(e) + '\n---\n');
    return p;
  }

  it('倒置的 stale checkpoint 自成段边界仍被识破（跨段 seq 守卫）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccv-reorder-'));
    try {
      const { cp, A, B } = buildInversionScenario({ aShape: 'checkpoint-unsignaled' });
      const file = writeJsonl(dir, 'a.jsonl', [cp, B, A]);
      const out = [];
      streamReconstructedEntries(file, (segment) => out.push(...segment));
      const staleA = out.find(e => e._seq === 2);
      assert.ok(staleA, '应包含 A 条目');
      assert.equal(staleA._staleReorder, true, '跨段共享 seqState 应识破 stale checkpoint');
      // 客户端批量 merge 守卫跳过后无翻倍
      let sessions = [];
      for (const entry of out) {
        if (isMergeBlockedEntry(entry, { batch: true })) continue;
        if (!(entry.mainAgent && entry.body && Array.isArray(entry.body.messages))) continue;
        sessions = mergeMainAgentSessions(sessions, entry);
      }
      assertNoDuplication(sessions, 7, '段级倒置');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('epoch 来回交替（双写进程 interleave）：不翻倍，下一 checkpoint 自愈', () => {
    // ep1 主进程 与 ep2 第二写进程（IM worker 等）交替写同一文件
    const baseA = conv(6);          // ep1 的会话
    const baseB = conv(4, 50);      // ep2 的会话
    const entries = [
      checkpointEntry({ msgs: baseA, seq: 5, epoch: 'ep1' }),
      checkpointEntry({ msgs: baseB, seq: 1, epoch: 'ep2' }),
      // 切回 ep1：delta 拼到 ep2 的 accumulated 上 → 完整性校验兜底
      deltaEntry({ slice: [mkMsg(7, 'user')], total: 7, seq: 6, epoch: 'ep1' }),
      // ep1 的下一 checkpoint 自愈
      checkpointEntry({ msgs: [...baseA, mkMsg(7, 'user'), mkMsg(8, 'assistant')], seq: 7, epoch: 'ep1' }),
    ];
    const sessions = runClientPipeline(serverBroadcast(entries));
    // 双写进程本就是异常配置，只要求：不整段翻倍 + 终态由最后的 checkpoint 决定
    const last = sessions[sessions.length - 1];
    const f = fps(last.messages);
    assert.equal(new Set(f).size, f.length, 'epoch 交替不得产生重复消息');
    assert.equal(f.length, 8, '终态应为 ep1 最后 checkpoint 的 8 条');
  });
});

describe('sessionMerge 等长 anchor-miss 内容感知（Fix 3 单元）', () => {
  it('等长近似拷贝（末位替换、无信号）→ 替换而非整段 append', () => {
    const base = conv(6);
    const m7 = mkMsg(7, 'user');
    const m7p = { role: 'user', content: `msg-7-user-REPLACED-${'z'.repeat(16)}` };
    let sessions = mergeMainAgentSessions([], {
      timestamp: nextTs(), body: { metadata: { user_id: 'u1' }, messages: [...conv(6), m7] }, response: {},
    }, { skipTransientFilter: true });
    // 等长、末位 fp 异、无信号 —— 历史上的翻倍陷阱
    sessions = mergeMainAgentSessions(sessions, {
      timestamp: nextTs(), body: { metadata: { user_id: 'u1' }, messages: [...base, m7p] }, response: {},
    }, { skipTransientFilter: true });
    assertNoDuplication(sessions, 7, '等长近似拷贝');
    assert.equal(
      messageFingerprint(sessions[0].messages[6]),
      messageFingerprint(m7p),
      '末位应为替换后的新值'
    );
  });

  it('N=1 等长内容异：对位相等 0 < 多数阈值 1 → 保守保持 append（行为固化）', () => {
    // N=1 时 majority=1 可达，但只有内容相同才达——而内容相同的等长 entry 必被 anchor
    // 路径截胡（overlapLen=newLen no-op），等长分支只见得到内容不同的 case → 必走 append。
    // 翻倍量上限 1 条，且通常被 _inPlaceReplaceDetected 信号路径截胡；此用例固化边界行为。
    let sessions = mergeMainAgentSessions([], {
      timestamp: nextTs(), body: { metadata: { user_id: 'u1' }, messages: [mkMsg(301, 'user')] }, response: {},
    }, { skipTransientFilter: true });
    sessions = mergeMainAgentSessions(sessions, {
      timestamp: nextTs(), body: { metadata: { user_id: 'u1' }, messages: [mkMsg(302, 'user')] }, response: {},
    }, { skipTransientFilter: true });
    assert.equal(sessions[0].messages.length, 2, 'N=1 等长内容异应保守 append');
  });

  it('Plan Mode 2-msg 全新窗口（等长、内容全异）→ 仍整段 append', () => {
    const w1 = [mkMsg(201, 'assistant'), mkMsg(202, 'user')];
    const w2 = [mkMsg(203, 'assistant'), mkMsg(204, 'user')];
    let sessions = mergeMainAgentSessions([], {
      timestamp: nextTs(), body: { metadata: { user_id: 'u1' }, messages: w1 }, response: {},
    }, { skipTransientFilter: true });
    sessions = mergeMainAgentSessions(sessions, {
      timestamp: nextTs(), body: { metadata: { user_id: 'u1' }, messages: w2 }, response: {},
    }, { skipTransientFilter: true });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].messages.length, 4, 'Plan Mode 全新窗口应保持累积 append');
  });
});
