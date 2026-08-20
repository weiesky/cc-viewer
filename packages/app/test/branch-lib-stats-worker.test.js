// 分支覆盖测试: server/lib/stats-worker.js (wire-v2, stats schema v9)
//
// stats-worker.js 在生产中作为 Worker thread 运行,唯一入口是 parentPort?.on('message')。
// 既有 test/stats-worker.test.js 走真实 Worker thread —— 但 worker 子线程的 *分支* 覆盖
// 数据无法可靠合并回主进程(line 99% 而 branch 仅 ~66%,artifact)。
//
// 本文件改为【主进程内】驱动:用一个 module loader 把 node:worker_threads 重定向到 shim,
// 使 parentPort 在主线程非 null,从而 import 期注册的 message 处理器可在进程内直接触发,
// 分支覆盖得以真实计入。所有 I/O 用私有 tmpdir 隔离,不依赖共享端口/目录。
//
// v2 起 fixture 为手写 journal/conv 行(与 test/stats-worker.test.js 的 V2Writer
// round-trip 钉互补)。
import { register } from 'node:module';

// ── 安装 worker_threads shim loader(必须在 import 目标模块之前) ──
const shimSrc = `
  import { EventEmitter } from 'node:events';
  const port = new EventEmitter();
  port.postMessage = (m) => { (globalThis.__SW_MSGS ||= []).push(m); };
  export const parentPort = port;
  export const Worker = class {};
  export const isMainThread = true;
  export const workerData = null;
  globalThis.__SW_PORT = port;
`;
const shimUrl = 'data:text/javascript,' + encodeURIComponent(shimSrc);
const resolverSrc = `
  export async function resolve(spec, ctx, next) {
    if (spec === 'node:worker_threads' || spec === 'worker_threads') {
      return { url: ${JSON.stringify(shimUrl)}, shortCircuit: true };
    }
    return next(spec, ctx);
  }
`;
register('data:text/javascript,' + encodeURIComponent(resolverSrc));

import { describe, it, before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeFileSync, mkdirSync, rmSync, readFileSync, existsSync, appendFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 进程级私有 TMPDIR:避免与并行测试争用共享临时目录。
const PRIVATE_TMP = join(tmpdir(), `ccv-branch-sw-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
mkdirSync(PRIVATE_TMP, { recursive: true });
process.env.TMPDIR = PRIVATE_TMP;

// 触发 import 期 parentPort?.on 注册;目标模块无导出,仅为副作用加载。
before(async () => {
  globalThis.__SW_MSGS = [];
  await import('../server/lib/stats-worker.js');
  assert.ok(globalThis.__SW_PORT, 'shim parentPort 应已就绪');
});

let workRoot;
beforeEach(() => {
  workRoot = join(PRIVATE_TMP, `t-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workRoot, { recursive: true });
});
afterEach(() => {
  rmSync(workRoot, { recursive: true, force: true });
});

/** 同步触发 message 处理器并返回该次调用产生的消息列表(处理器内全部同步执行)。 */
function dispatch(msg) {
  globalThis.__SW_MSGS = [];
  globalThis.__SW_PORT.emit('message', msg);
  return globalThis.__SW_MSGS;
}

function readStats(logDir, projectName) {
  return JSON.parse(readFileSync(join(logDir, projectName, `${projectName}.json`), 'utf-8'));
}

// ─── v2 session fixture(与 test/stats-worker.test.js 同款,手写行) ───

function makeSession(projectDir, sid, { requests = [], convEvents = [], rawJournalLines = null } = {}) {
  const dir = join(projectDir, 'sessions', sid);
  mkdirSync(join(dir, 'conversations', 'main'), { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: sid, pid: 1, startTs: '2026-07-14T00:00:00.000Z' }));
  let lines;
  if (rawJournalLines) {
    lines = rawJournalLines;
  } else {
    lines = [JSON.stringify({ ph: 'meta', wireFormat: 2 })];
    for (const r of requests) {
      const { _done, ...req } = r;
      lines.push(JSON.stringify({ ph: 'req', ...req }));
      if (_done) lines.push(JSON.stringify({ ph: 'done', seq: r.seq, ts: r.ts, status: 'ok', ...(_done === true ? {} : _done) }));
    }
  }
  writeFileSync(join(dir, 'journal.jsonl'), lines.join('\n') + '\n');
  const byEpoch = new Map();
  for (const ev of convEvents) {
    const e = ev.epoch || 0;
    if (!byEpoch.has(e)) byEpoch.set(e, []);
    const { epoch, ...rest } = ev;
    byEpoch.get(e).push(JSON.stringify(rest));
  }
  for (const [e, evLines] of byEpoch) {
    writeFileSync(join(dir, 'conversations', 'main', `e${e}.jsonl`), evLines.join('\n') + '\n');
  }
  return dir;
}

function mainReq(seq, msgTo, { model = 'm', epoch = 0, usage = null, kind = 'main' } = {}) {
  return {
    seq, rid: `r${seq}`, ts: `2026-07-14T00:00:0${Math.min(seq, 9)}.000Z`, kind,
    conv: 'main', epoch, url: 'https://api.anthropic.com/v1/messages', method: 'POST',
    model, msgFrom: 0, msgTo,
    _done: usage ? { usage, dur: 10 } : true,
  };
}

// ─── journal 解析: model 与 usage 字段分支 ───

describe('stats-worker 分支: journal 解析 model 与 usage', () => {
  it('req 计 model、done 累加各 usage 字段;缺省字段取 0 分支', () => {
    const projectName = 'p-basic';
    makeSession(join(workRoot, projectName), 'sid-1', {
      requests: [
        mainReq(1, 1, { model: 'mA', usage: { in: 100, out: 50, cr: 30, cw: 10 } }),
        mainReq(2, 3, { model: 'mA', usage: { out: 5, cw: 7 } }), // 无 in/cr → 0 分支
        mainReq(3, 3, { model: 'mB' }),                            // done 无 usage → 跳过累加
        mainReq(4, 3, { model: 'mB', usage: null }),
      ],
    });
    const msgs = dispatch({ type: 'init', logDir: workRoot, projectName });
    assert.ok(msgs.some(m => m.type === 'init-done'));
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.summary.requestCount, 4);
    assert.equal(stats.summary.input_tokens, 100);
    assert.equal(stats.summary.output_tokens, 55);
    assert.equal(stats.summary.cache_read_input_tokens, 30);
    assert.equal(stats.summary.cache_creation_input_tokens, 17);
    assert.equal(stats.models['mA'], 2);
    assert.equal(stats.models['mB'], 2);
  });

  it('req 无 model → 计 requestCount 但不进 models;其 done usage 仍进 totals', () => {
    const projectName = 'p-no-model';
    makeSession(join(workRoot, projectName), 'sid-1', {
      requests: [
        { seq: 1, rid: 'r1', ts: 't', kind: 'heartbeat', url: 'u', method: 'POST', _done: { usage: { in: 9, out: 9 } } },
        mainReq(2, 1, { model: 'ok', usage: { in: 1, out: 1 } }),
      ],
    });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.summary.requestCount, 2);
    assert.equal(stats.summary.input_tokens, 10, '无 model 的 usage 计入 totals');
    assert.equal(stats.models['ok'].valueOf(), 1);
    assert.equal(Object.keys(stats.models).length, 1);
  });

  it('重复 req seq 忽略、重复 done 折叠(§14)、孤儿 done(无 req)只进 totals', () => {
    const projectName = 'p-dedup';
    makeSession(join(workRoot, projectName), 'sid-1', {
      rawJournalLines: [
        JSON.stringify({ ph: 'meta', wireFormat: 2 }),
        JSON.stringify({ ph: 'req', seq: 1, kind: 'main', conv: 'main', epoch: 0, url: 'u', model: 'mA', msgTo: 1 }),
        JSON.stringify({ ph: 'req', seq: 1, kind: 'main', conv: 'main', epoch: 0, url: 'u', model: 'mA', msgTo: 1 }), // dup req
        JSON.stringify({ ph: 'done', seq: 1, status: 'ok', usage: { in: 5, out: 5 } }),
        JSON.stringify({ ph: 'done', seq: 1, status: 'ok', usage: { in: 500, out: 500 } }), // dup done → folded
        JSON.stringify({ ph: 'done', seq: 99, status: 'ok', usage: { in: 3, out: 3 } }),    // orphan done
      ],
    });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.summary.requestCount, 1);
    assert.equal(stats.summary.input_tokens, 8, '5 (folded) + 3 (orphan totals-only)');
    assert.equal(stats.files['sessions/sid-1'].models['mA'].input_tokens, 5, '孤儿 done 不进 per-model');
  });

  it('空 journal / 坏行容忍(readJsonlTolerant)', () => {
    const projectName = 'p-tolerant';
    const dir = makeSession(join(workRoot, projectName), 'sid-1', {
      requests: [mainReq(1, 1, { model: 'ok', usage: { in: 1, out: 1 } })],
    });
    appendFileSync(join(dir, 'journal.jsonl'), '{broken\n');
    makeSession(join(workRoot, projectName), 'sid-2', { rawJournalLines: [''] });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.summary.requestCount, 1);
    // sid-2 (empty journal, no main, no leader) is DISCARDABLE (2026-07-16):
    // probe/torn orphans never count toward stats.
    assert.equal(stats.summary.fileCount, 1);
    assert.equal(stats.files['sessions/sid-2'], undefined, 'discardable session skipped');
  });
});

// ─── 用户文本提取与系统文本过滤(经 conv 事件驱动) ───

describe('stats-worker 分支: 用户文本提取与系统文本过滤', () => {
  function runWithUserMsgs(projectName, messagesList) {
    const projectDir = join(workRoot, projectName);
    makeSession(projectDir, 'sid-1', {
      requests: messagesList.map((_, i) => mainReq(i + 1, i + 1)),
      convEvents: messagesList.map((messages, i) => ({ seq: i + 1, t: 'append', msgs: messages })),
    });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    return Object.values(stats.files)[0].preview;
  }

  it('string content:剥离系统标签后保留用户文本,纯标签条目被跳过', () => {
    const preview = runWithUserMsgs('sx-string', [
      [{ role: 'user', content: '<system-reminder>secret</system-reminder>hello world' }],
      [{ role: 'user', content: '<system-reminder>only system</system-reminder>' }],
    ]);
    assert.deepEqual(preview, ['hello world']);
  });

  it('isSystemText:空文本/纯空白/尖括号开头/各系统前缀均判为系统文本', () => {
    const preview = runWithUserMsgs('sx-systext', [
      [{ role: 'user', content: '' }],
      [{ role: 'user', content: '    ' }],
      [{ role: 'user', content: '<foo bar>payload</foo>' }],
      [{ role: 'user', content: '<bar>tagged</bar>' }],
      [{ role: 'user', content: 'Your response was cut off because it exceeded the output token limit now' }],
      [{ role: 'user', content: 'Base directory for this skill: /tmp' }],
      [{ role: 'user', content: 'genuine user text' }],
    ]);
    assert.deepEqual(preview, ['genuine user text']);
  });

  it('包含 plan 的文本不被系统文本过滤,但 Implement-the-following-plan 开头被显式跳过', () => {
    const preview = runWithUserMsgs('sx-plan', [
      [{ role: 'user', content: 'Please do this. Implement the following plan: step1' }],
      [{ role: 'user', content: 'Implement the following plan: do everything' }],
    ]);
    assert.deepEqual(preview, ['Please do this. Implement the following plan: step1']);
  });

  it('array content:跳过非 text 块、系统文本块、command-message 块、缺 text 字段块', () => {
    const preview = runWithUserMsgs('sx-array', [
      [{ role: 'user', content: [
        { type: 'tool_result', content: 'ignored' },
        { type: 'text', text: '   ' },
        { type: 'text', text: '<system-reminder>sys</system-reminder>' },
        { type: 'text' },
        { type: 'text', text: 'real array text' },
      ] }],
      [{ role: 'user', content: [
        { type: 'text', text: 'cmd wrapper <command-message>/foo</command-message> tail' },
        { type: 'text', text: 'argument text' },
      ] }],
      [{ role: 'user', content: [
        { type: 'text', text: '<system-reminder>all</system-reminder>' },
      ] }], // userParts 为空 → 不 push
    ]);
    assert.deepEqual(preview, ['real array text', 'argument text']);
  });

  it('非 user 角色消息被跳过;跨会话队友通知 chrome 被剥离(正文回收)、裸协议 JSON 被过滤', () => {
    const preview = runWithUserMsgs('sx-roles', [
      [{ role: 'assistant', content: 'assistant text' }],
      // v1 起的既有语义:前缀行剥掉后,消息正文作为用户文本回收
      [{ role: 'user', content: 'Another Claude session sent a message: hi' }],
      [{ role: 'user', content: '{"type":"idle_notification","x":1}' }],
      [{ role: 'user', content: 'kept' }],
    ]);
    assert.deepEqual(preview, ['hi', 'kept']);
  });

  it('preview 换行折叠 + 100 字符截断 + 去重', () => {
    const long = 'a'.repeat(150);
    const preview = runWithUserMsgs('sx-flat', [
      [{ role: 'user', content: `line1\nline2` }],
      [{ role: 'user', content: `line1\nline2` }], // duplicate
      [{ role: 'user', content: long }],
    ]);
    assert.deepEqual(preview, ['line1 line2', 'a'.repeat(100)]);
  });
});

// ─── isSuggestionMode 分支(经 conv 事件驱动) ───

describe('stats-worker 分支: isSuggestionMode', () => {
  function runSession(projectName, { requests, convEvents }) {
    makeSession(join(workRoot, projectName), 'sid-1', { requests, convEvents });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    return readStats(workRoot, projectName);
  }

  it('array/string content 的 SUGGESTION MODE 事件 → 不计 turn、不进 preview', () => {
    const stats = runSession('sg-basic', {
      requests: [mainReq(1, 1), mainReq(2, 2), mainReq(3, 3)],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [{ role: 'user', content: 'real' }] },
        { seq: 2, t: 'append', msgs: [{ role: 'user', content: [{ type: 'text', text: '[SUGGESTION MODE: x]' }] }] },
        { seq: 3, t: 'append', msgs: [{ role: 'user', content: '[SUGGESTION MODE: y]' }] },
      ],
    });
    assert.equal(stats.summary.turnCount, 1);
    assert.deepEqual(Object.values(stats.files)[0].preview, ['real']);
  });

  it('末条非 user / content 非数组非字符串 / text 块缺字段 → 非 suggestion,正常统计', () => {
    const stats = runSession('sg-edges', {
      requests: [mainReq(1, 1), mainReq(2, 2), mainReq(3, 3)],
      convEvents: [
        { seq: 1, t: 'snapshot', msgs: [{ role: 'user', content: 'u1' }, { role: 'assistant', content: 'a' }] },
        { seq: 2, t: 'append', msgs: [{ role: 'user', content: 42 }] },
        { seq: 3, t: 'append', msgs: [{ role: 'user', content: [{ type: 'text' }] }] },
      ],
    });
    assert.equal(stats.summary.turnCount, 3);
  });

  it('msgs 为空数组的事件被整体跳过(!length 分支)', () => {
    const stats = runSession('sg-empty', {
      requests: [mainReq(1, 1)],
      convEvents: [{ seq: 1, t: 'snapshot', msgs: [] }],
    });
    assert.deepEqual(Object.values(stats.files)[0].preview, []);
  });
});

// ─── 轮次/会话统计分支 ───

describe('stats-worker 分支: 轮次与会话统计', () => {
  it('msgTo 增长计 turn;不增长不计;非 main kind 与缺 msgTo 不参与', () => {
    const projectName = 'tc-growth';
    makeSession(join(workRoot, projectName), 'sid-1', {
      rawJournalLines: [
        JSON.stringify({ ph: 'meta', wireFormat: 2 }),
        JSON.stringify({ ph: 'req', seq: 1, kind: 'main', conv: 'main', epoch: 0, url: 'u', model: 'm', msgTo: 1 }),
        JSON.stringify({ ph: 'req', seq: 2, kind: 'main', conv: 'main', epoch: 0, url: 'u', model: 'm', msgTo: 3 }),
        JSON.stringify({ ph: 'req', seq: 3, kind: 'main', conv: 'main', epoch: 0, url: 'u', model: 'm', msgTo: 3 }), // no growth
        JSON.stringify({ ph: 'req', seq: 4, kind: 'sub', conv: 'sub-x', epoch: 0, url: 'u', model: 'm', msgTo: 99 }), // not main
        JSON.stringify({ ph: 'req', seq: 5, kind: 'main', conv: 'main', epoch: 0, url: 'u', model: 'm' }),            // no msgTo
      ],
    });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.summary.turnCount, 2);
    assert.equal(stats.summary.sessionCount, 1);
  });

  it('/clear 级缩减(len < max*0.5 且 gap>4)重置追踪;epoch 去重计 sessionCount', () => {
    const projectName = 'tc-shrink';
    makeSession(join(workRoot, projectName), 'sid-1', {
      requests: [
        mainReq(1, 12),
        mainReq(2, 1, { epoch: 1 }),
        mainReq(3, 3, { epoch: 1 }),
        mainReq(4, 5, { epoch: 1 }),
      ],
    });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.summary.turnCount, 4);
    assert.equal(stats.summary.sessionCount, 2);
  });
});

// ─── 增量缓存与异常分支 ───

describe('stats-worker 分支: 增量与已有缓存', () => {
  it('已有 stats JSON 损坏 → JSON.parse catch → existing=null,全量重解', () => {
    const projectName = 'inc-corrupt';
    const projectDir = join(workRoot, projectName);
    makeSession(projectDir, 'sid-1', { requests: [mainReq(1, 1, { model: 'mA', usage: { in: 1, out: 1 } })] });
    writeFileSync(join(projectDir, `${projectName}.json`), '{corrupt');
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.models['mA'].count ?? stats.models['mA'], 1);
  });

  it('update 增量:未变化会话从缓存复用(汇总 topModels),仅重解指定 unit', () => {
    const projectName = 'inc-update';
    const projectDir = join(workRoot, projectName);
    makeSession(projectDir, 'sid-1', { requests: [mainReq(1, 1, { model: 'mA', usage: { in: 1, out: 1 } })] });
    const dir2 = makeSession(projectDir, 'sid-2', { requests: [mainReq(1, 1, { model: 'mB', usage: { in: 2, out: 2 } })] });
    dispatch({ type: 'init', logDir: workRoot, projectName });

    appendFileSync(join(dir2, 'journal.jsonl'),
      JSON.stringify({ ph: 'req', seq: 2, kind: 'main', conv: 'main', epoch: 0, url: 'u', model: 'mB', msgTo: 3 }) + '\n' +
      JSON.stringify({ ph: 'done', seq: 2, status: 'ok', usage: { in: 5, out: 5 } }) + '\n');

    const msgs = dispatch({ type: 'update', logDir: workRoot, projectName, logFile: dir2 });
    assert.ok(msgs.some(m => m.type === 'update-done' && m.logFile === 'sessions/sid-2'));
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.models['mA'], 1, '未变化 unit 缓存复用并汇总');
    assert.equal(stats.models['mB'], 2);
    assert.equal(stats.summary.input_tokens, 8);
  });

  it('update 指定的正是缓存命中 unit → 强制重解(onlyFile === unit 分支)', () => {
    const projectName = 'inc-force';
    const projectDir = join(workRoot, projectName);
    const dir1 = makeSession(projectDir, 'sid-1', { requests: [mainReq(1, 1, { model: 'mA', usage: { in: 1, out: 1 } })] });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    // journal 未变(size/mtime 同)也强制重解不炸,输出等价
    const msgs = dispatch({ type: 'update', logDir: workRoot, projectName, logFile: dir1 });
    assert.ok(msgs.some(m => m.type === 'update-done'));
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.models['mA'], 1);
  });

  it('复用的缓存 unit 无 models 字段 → 跳过汇总(models 为假分支)', () => {
    const projectName = 'inc-no-models';
    const projectDir = join(workRoot, projectName);
    makeSession(projectDir, 'sid-1', { requests: [mainReq(1, 1, { model: 'mA', usage: { in: 1, out: 1 } })] });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    // 手工阉割缓存里的 models 字段
    const statsFile = join(projectDir, `${projectName}.json`);
    const cached = JSON.parse(readFileSync(statsFile, 'utf-8'));
    delete cached.files['sessions/sid-1'].models;
    writeFileSync(statsFile, JSON.stringify(cached));
    // 再来一个新会话触发重算;旧 unit 走缓存复用(无 models → 跳过汇总)
    makeSession(projectDir, 'sid-2', { requests: [mainReq(1, 1, { model: 'mB', usage: { in: 2, out: 2 } })] });
    dispatch({ type: 'update', logDir: workRoot, projectName, logFile: join(projectDir, 'sessions', 'sid-2') });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.models['mB'], 1);
    assert.equal(stats.models['mA'], undefined);
  });

  it('无 sessions 的项目 → 直接 return 不写 stats;journal 缺失的 sid 目录被跳过', () => {
    const projectName = 'inc-none';
    const projectDir = join(workRoot, projectName);
    mkdirSync(join(projectDir, 'sessions', 'sid-empty'), { recursive: true }); // 无 journal
    dispatch({ type: 'init', logDir: workRoot, projectName });
    assert.equal(existsSync(join(projectDir, `${projectName}.json`)), false);

    makeSession(projectDir, 'sid-1', { requests: [mainReq(1, 1, { model: 'mA', usage: { in: 1, out: 1 } })] });
    dispatch({ type: 'init', logDir: workRoot, projectName });
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.summary.fileCount, 1, 'journal 缺失的 sid 不计 unit');
  });

  it('update 传 legacy basename(非 session 路径)→ 无 unit 匹配,普通增量跑完', () => {
    const projectName = 'inc-legacy';
    const projectDir = join(workRoot, projectName);
    makeSession(projectDir, 'sid-1', { requests: [mainReq(1, 1, { model: 'mA', usage: { in: 1, out: 1 } })] });
    const msgs = dispatch({ type: 'update', logDir: workRoot, projectName, logFile: '/somewhere/old.jsonl' });
    assert.ok(msgs.some(m => m.type === 'update-done' && m.logFile === 'old.jsonl'));
    const stats = readStats(workRoot, projectName);
    assert.equal(stats.models['mA'], 1);
  });
});
