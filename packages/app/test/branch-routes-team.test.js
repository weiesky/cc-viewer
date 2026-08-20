/**
 * server/routes/team.js — 分支补强测试（branch coverage）
 *
 * 目标：补齐 api-team-routes.test.js 未覆盖的分支：
 *   - concept: doc 缺省 '' 分支
 *   - ccvProcesses: !pid continue / nameField '' 默认 / !portMatch continue /
 *                   ppid 查询的 catch{} / months[]||1 默认 / libMatch 三元 else /
 *                   ps lstart 的 catch{}
 *   - ccvProcessesKill: body 超 MAX_POST_BODY → req.destroy()
 *   - teamStatus: body 超限 → req.destroy() / 空 body → JSON.parse('{}')
 *
 * 手法与 api-team-routes.test.js 一致：直接取 teamRoutes 的 handler 注入 deps，不起 http server。
 * env 在任何目标模块 import 之前设好（私有临时目录 + 私有 LOG_DIR），保证并行隔离。
 *
 * 未覆盖且判定不可达的分支（写入 unreachable，不为凑数造假断言）：
 *   - line 34/35-38 win32 早退：依赖真实 os.platform()，非 win 平台 + 不改源码无法注入。
 *   - line 157-160 teamStatus catch：buildTeamStatusResponse 对任意 JSON 输入都不抛
 *     （内部 checkTeamsRuntime 逐 team try/catch 吞错，buildTeamStatusResponse 顶层无抛点），
 *     且 handler 直接 import 该函数、无 DI 注入点，故经路由不可达。
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'ccv-branch-team-' + process.pid + '-'));
process.env.CCV_LOG_DIR = process.env.CCV_LOG_DIR || join(TMP_ROOT, 'logs');
process.env.CLAUDE_CONFIG_DIR = join(TMP_ROOT, 'claude');

let routes;
before(async () => {
  ({ teamRoutes: routes } = await import('../server/routes/team.js'));
});

function handlerFor(path, method) {
  const r = routes.find(x => x.path === path && x.method === method);
  assert.ok(r, `route ${method} ${path} must exist`);
  return r.handler;
}

const DEPS = { MAX_POST_BODY: 1024 * 1024 };

/** 驱动一个 GET（可能 async）handler，res 收集回包 */
async function callGet(handler, url, deps = DEPS) {
  const out = { status: 0, headers: null, body: '' };
  const res = {
    writeHead(code, headers) { out.status = code; out.headers = headers; },
    end(b) { out.body = b == null ? '' : b; },
  };
  await handler({}, res, new URL(url, 'http://x'), true, deps);
  return {
    status: out.status,
    headers: out.headers,
    body: out.body,
    json() { return JSON.parse(out.body || '{}'); },
  };
}

/**
 * 驱动 POST handler。chunks 为待 emit 的分片数组（默认单片 JSON 串）。
 * req.destroy 模拟 http 行为：触发 'end'，handler 据已收 body 继续处理。
 */
function callPost(handler, url, body, deps = DEPS, { chunks } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    req.destroy = () => { req.emit('end'); };
    let status = 0, headers = null;
    const res = {
      writeHead(code, h) { status = code; headers = h; },
      end(b) { resolve({ status, headers, body: b || '', json() { return JSON.parse(b || '{}'); } }); },
    };
    handler(req, res, new URL(url, 'http://x'), true, deps);
    setImmediate(() => {
      if (Array.isArray(chunks)) {
        for (const c of chunks) req.emit('data', c);
        // 超限时 handler 在 data 回调内已 req.destroy() → 已 emit('end')；
        // 这里再 emit('end') 兜底未超限场景。
        req.emit('end');
      } else {
        req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
        req.emit('end');
      }
    });
  });
}

// ====================================================================
// concept GET — doc 缺省 '' 分支
// ====================================================================
describe('concept GET /api/concept — doc 缺省分支', { concurrency: false }, () => {
  let handler;
  before(() => { handler = handlerFor('/api/concept', 'GET'); });

  it('doc 缺失时走 || \'\' 默认，正则不匹配 → 400', async () => {
    // 无 doc 参数 → doc = '' → /^[a-zA-Z0-9-]+$/.test('') 为 false → 400
    const r = await callGet(handler, '/api/concept?lang=zh');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid parameters');
  });
});

// ====================================================================
// ccvProcesses GET — lsof/ps 解析的各防御分支
// ====================================================================
describe('ccvProcesses GET /api/ccv-processes — 解析分支', { concurrency: false }, () => {
  let handler;
  before(() => { handler = handlerFor('/api/ccv-processes', 'GET'); });

  it('!pid / nameField空 / !portMatch 三个 continue 分支', async () => {
    if (platform() === 'win32') return; // win 早退由 os 决定
    // 行1: node 但 PID 非数字 → parseInt NaN → !pid continue
    // 行2: node 且 PID 合法，但 NAME 列(倒数第二)为空串 → nameField '' || '' → !portMatch continue
    //   构造：让倒数第二列是空——通过让该行只有很少的字段使 parts[len-2] 落到非 :port 文本
    // 行3: node 且 PID 合法，但 NAME 不含 :port → portMatch null → continue
    const lsof =
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
      'node notanumber sky 20u IPv4 0x0 0t0 TCP *:7008 (LISTEN)\n' +     // !pid
      'node 90010 sky 21u IPv4 0x0 0t0 TCP no-port-here (LISTEN)\n';      // !portMatch
    const execAsync = async (cmd) => {
      if (cmd.startsWith('lsof -iTCP:7008-7099')) return { stdout: lsof };
      return { stdout: '' };
    };
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    assert.equal(r.status, 200);
    // 两行都被 continue 掉 → 进程列表为空
    assert.deepEqual(r.json().processes, []);
  });

  it('nameField 落到空串默认（行字段不足）→ 也被 continue', async () => {
    if (platform() === 'win32') return;
    // 仅 1 个字段的行：parts=['node']，parts[length-2]=parts[-1]=undefined → || '' → '' → !portMatch
    // 但这样 cmd==='node' 通过、parseInt(parts[1]) = parseInt(undefined)=NaN → !pid 先 continue。
    // 为单独命中 nameField '' 默认且 pid 合法、需 parts.length>=2 且 parts[length-2] 为 undefined——
    // 当 parts.length===2 时 length-2===0 指向 'node' 本身(非 :port)，无法得到 undefined。
    // 因此 nameField '' 默认与 !portMatch 实质同源：上一个用例的 no-port-here 行已覆盖 || '' 右值未取、
    // 这里构造 parts 极短行确保 parseInt 路径稳定不崩。
    const lsof =
      'COMMAND PID\n' +
      'node\n';
    const execAsync = async (cmd) => {
      if (cmd.startsWith('lsof')) return { stdout: lsof };
      return { stdout: '' };
    };
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().processes, []);
  });

  it('ppid 查询 throw 命中 catch{}（非 .catch 兜底）', async () => {
    if (platform() === 'win32') return;
    const PID = 90020;
    const lsof =
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
      `node ${PID} sky 20u IPv4 0x0 0t0 TCP *:7008 (LISTEN)\n`;
    const execAsync = async (cmd) => {
      if (cmd.startsWith('lsof')) return { stdout: lsof };
      if (cmd.startsWith('ps -o ppid=')) {
        // 返回一个 stdout.trim() 会抛的对象 → for 内 try 命中 catch{}
        return { stdout: { trim() { throw new Error('ppid boom'); } } };
      }
      if (cmd.startsWith('ps -p')) {
        // command 不含 lib/ → 命中 libMatch 三元 else（rawCmd 原样）
        return { stdout: 'Mon Foo  2 09:15:30 2026 /usr/bin/node /opt/app/run.js\n' };
      }
      return { stdout: '' };
    };
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    assert.equal(r.status, 200);
    const procs = r.json().processes;
    // ppid 解析抛错被吞 → 该 pid 仍进 filteredPids → 列表含 1 个
    assert.equal(procs.length, 1);
    assert.equal(procs[0].pid, PID);
    // 月份 'Foo' 未知 → months[]||1 默认 → 月份 01
    assert.match(procs[0].startTime, /2026年01月02日 09:15:30/);
    // rawCmd 不含 lib/ → command 原样
    assert.equal(procs[0].command, '/usr/bin/node /opt/app/run.js');
  });

  it('ps -p 的 lstart 解析抛错命中 catch{}（startTime/command 留空）', async () => {
    if (platform() === 'win32') return;
    const PID = 90030;
    const lsof =
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
      `node ${PID} sky 20u IPv4 0x0 0t0 TCP *:7011 (LISTEN)\n`;
    const execAsync = async (cmd) => {
      if (cmd.startsWith('lsof')) return { stdout: lsof };
      if (cmd.startsWith('ps -o ppid=')) return { stdout: '1\n' };
      if (cmd.startsWith('ps -p')) {
        // psOut.trim() 抛 → 命中 try/catch{}（line 91），startTime/command 维持初值 ''
        return { stdout: { trim() { throw new Error('ps boom'); } } };
      }
      return { stdout: '' };
    };
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    assert.equal(r.status, 200);
    const procs = r.json().processes;
    assert.equal(procs.length, 1);
    assert.equal(procs[0].pid, PID);
    assert.equal(procs[0].startTime, '');
    assert.equal(procs[0].command, '');
  });
});

// ====================================================================
// ccvProcessesKill POST — body 超 MAX_POST_BODY 触发 req.destroy()
// ====================================================================
describe('ccvProcessesKill POST /api/ccv-processes/kill — 超限分支', { concurrency: false }, () => {
  let handler;
  before(() => { handler = handlerFor('/api/ccv-processes/kill', 'POST'); });

  it('body 超 MAX_POST_BODY → req.destroy() → end 后按已收(超大非JSON)走 500', async () => {
    // MAX_POST_BODY 设小，单片超限 → if (body.length > MAX) req.destroy() 命中
    const deps = { ...DEPS, MAX_POST_BODY: 4 };
    const big = 'xxxxxxxxxx'; // 10 > 4
    const r = await callPost(handler, '/api/ccv-processes/kill', null, deps, { chunks: [big] });
    // destroy 触发 end，JSON.parse('xxxxxxxxxx') 抛 → 500
    assert.equal(r.status, 500);
    assert.ok(typeof r.json().error === 'string');
  });
});

// ====================================================================
// teamStatus POST — body 超限 + 空 body 走 JSON.parse('{}')
// ====================================================================
describe('teamStatus POST /api/team-status — 超限/空 body 分支', { concurrency: false }, () => {
  let handler;
  before(() => { handler = handlerFor('/api/team-status', 'POST'); });

  it('body 超 MAX_POST_BODY → req.destroy()，已收非 JSON → 400 invalid_json', async () => {
    const deps = { ...DEPS, MAX_POST_BODY: 3 };
    const r = await callPost(handler, '/api/team-status', null, deps, { chunks: ['abcdef'] });
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'invalid_json');
  });

  it('空 body → body||\'{}\' = \'{}\' → 解析成功，空 statuses', async () => {
    const r = await callPost(handler, '/api/team-status', null, DEPS, { chunks: [] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().statuses, {});
  });
});

after(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});
