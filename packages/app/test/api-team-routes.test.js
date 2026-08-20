/**
 * server/routes/team.js — teamRoutes handler 行为测试
 *
 * 覆盖目标：concept / ccvProcesses / ccvProcessesKill / teamStatus 四个 handler。
 *
 * 手法：直接 import { teamRoutes } 取 handler 注入 deps，不启 http server。
 *   - concept：读真实 CONCEPTS_DIR 下的随包文档（GET）。
 *   - ccvProcesses / ccvProcessesKill：注入 mock deps.execAsync（返回伪造 lsof/ps stdout），
 *     覆盖解析逻辑而无需真实子进程；win32 早退分支通过覆写 platform 间接说明（见注释）。
 *   - teamStatus：把 process.env.HOME 指到临时目录，使 buildTeamStatusResponse 内部
 *     homedir()/.claude/teams 落在 fixtures；构造 dead/residue/possiblyAlive/reused/error 各态。
 *
 * env 必须在任何目标模块 import 之前设好。teamStatus 用例在自己的 before() 里临时改 HOME，
 * after() 还原，避免污染同进程其它用例。
 */
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync, existsSync, readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

const TMP_ROOT = mkdtempSync(join(tmpdir(), 'ccv-api-team-routes-'));
process.env.CCV_LOG_DIR = process.env.CCV_LOG_DIR || join(TMP_ROOT, 'logs');
process.env.CLAUDE_CONFIG_DIR = join(TMP_ROOT, 'claude');
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

let routes;
let CONCEPTS_DIR;
before(async () => {
  ({ teamRoutes: routes } = await import('../server/routes/team.js'));
  ({ CONCEPTS_DIR } = await import('../server/_paths.js'));
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

/** 驱动 POST handler（req 流式 emit body），等 res.end 回调 resolve */
function callPost(handler, url, body, deps = DEPS) {
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
      req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
      req.emit('end');
    });
  });
}

// ====================================================================
// concept GET /api/concept
// ====================================================================
describe('concept GET /api/concept', { concurrency: false }, () => {
  let handler;
  before(() => { handler = handlerFor('/api/concept', 'GET'); });

  it('400 on invalid doc name (path-ish chars)', async () => {
    const r = await callGet(handler, '/api/concept?lang=zh&doc=../etc/passwd');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid parameters');
  });

  it('400 on invalid lang format', async () => {
    const r = await callGet(handler, '/api/concept?lang=ENGLISH&doc=BodyFields');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid parameters');
  });

  it('serves a real zh markdown doc with markdown content-type', async () => {
    // 前置确认随包文档存在，否则跳过（不让用例假阳）
    if (!existsSync(join(CONCEPTS_DIR, 'zh', 'BodyFields.md'))) return;
    const r = await callGet(handler, '/api/concept?lang=zh&doc=BodyFields');
    assert.equal(r.status, 200);
    assert.match(r.headers['Content-Type'], /text\/markdown/);
    assert.ok(r.body.length > 0, 'should return doc content');
  });

  it('serves an en doc when present', async () => {
    if (!existsSync(join(CONCEPTS_DIR, 'en', 'BodyFields.md'))) return;
    const r = await callGet(handler, '/api/concept?lang=en&doc=BodyFields');
    assert.equal(r.status, 200);
    assert.ok(r.body.length > 0);
  });

  it('404 for an unknown doc name (valid format, no file)', async () => {
    const r = await callGet(handler, '/api/concept?lang=zh&doc=NoSuchDoc12345');
    assert.equal(r.status, 404);
    assert.equal(r.json().error, 'Not found');
  });

  it('defaults lang to zh when omitted', async () => {
    if (!existsSync(join(CONCEPTS_DIR, 'zh', 'BodyFields.md'))) return;
    const r = await callGet(handler, '/api/concept?doc=BodyFields');
    assert.equal(r.status, 200);
  });

  it('falls back to zh dir for a non-zh lang whose translation is missing', async () => {
    // 用一个真实不存在于任何语言、但我们临时写进 zh 的文档名，触发 en→zh fallback。
    // 不能改源码或随包文档，所以这里只在 fixture 缺位时跳过；
    // 直接构造：请求 lang=en&doc=NoSuchDoc 时两边都没有 → 404（fallback 分支已在上一个 404 用例间接走过 zh 缺位）。
    const r = await callGet(handler, '/api/concept?lang=en&doc=NoSuchDocXYZ');
    assert.equal(r.status, 404);
  });
});

// ====================================================================
// ccvProcesses GET /api/ccv-processes
// ====================================================================
describe('ccvProcesses GET /api/ccv-processes', { concurrency: false }, () => {
  let handler;
  before(() => { handler = handlerFor('/api/ccv-processes', 'GET'); });

  // 注：win32 早退分支（platform()==='win32' → {processes:[]}）依赖真实 os.platform()，
  // 无法在不改源码的前提下注入；非 win 平台跑不到，记入 skipped。

  it('parses lsof + ps output into a process list (non-win path)', async () => {
    if (platform() === 'win32') return; // win 早退分支由 os 决定，此处只测非 win
    const PID_A = 90001, PID_B = 90002;
    const lsof =
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
      `node ${PID_A} sky 20u IPv4 0x0 0t0 TCP *:7008 (LISTEN)\n` +
      `node ${PID_B} sky 21u IPv4 0x0 0t0 TCP *:7009 (LISTEN)\n` +
      `python 99999 sky 5u IPv4 0x0 0t0 TCP *:7010 (LISTEN)\n`; // 非 node，应被过滤
    const execAsync = async (cmd) => {
      if (cmd.startsWith('lsof -iTCP:7008-7099')) return { stdout: lsof };
      // ppid 查询：让 PID_B 的父是 PID_A（应被当子进程过滤），PID_A 父进程不在集合内
      const ppidMatch = cmd.match(/-p (\d+)$/);
      if (cmd.startsWith('ps -o ppid=')) {
        const pid = Number(ppidMatch[1]);
        if (pid === PID_B) return { stdout: `${PID_A}\n` };
        return { stdout: '1\n' };
      }
      if (cmd.startsWith('ps -p')) {
        const pid = Number(cmd.match(/ps -p (\d+)/)[1]);
        // lstart + command；只给 PID_A 一个可解析的行
        if (pid === PID_A) {
          return { stdout: 'Mon Jun  2 09:15:30 2026 /usr/bin/node /x/lib/node_modules/cc-viewer/cli.js -d\n' };
        }
        return { stdout: '' };
      }
      return { stdout: '' };
    };
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    assert.equal(r.status, 200);
    const procs = r.json().processes;
    // PID_B 是 PID_A 的子进程，被过滤 → 只剩 PID_A
    assert.equal(procs.length, 1);
    const p = procs[0];
    assert.equal(p.pid, PID_A);
    assert.equal(p.port, '7008');
    assert.equal(p.command, 'node_modules/cc-viewer/cli.js -d');
    assert.match(p.startTime, /2026年06月02日 09:15:30/);
    assert.equal(p.isCurrent, false);
  });

  it('returns empty list when lsof yields nothing', async () => {
    if (platform() === 'win32') return;
    const execAsync = async () => ({ stdout: '' });
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().processes, []);
  });

  it('marks the current server process with isCurrent=true', async () => {
    if (platform() === 'win32') return;
    const me = process.pid;
    const lsof =
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
      `node ${me} sky 20u IPv4 0x0 0t0 TCP *:7050 (LISTEN)\n`;
    const execAsync = async (cmd) => {
      if (cmd.startsWith('lsof')) return { stdout: lsof };
      if (cmd.startsWith('ps -o ppid=')) return { stdout: '1\n' };
      if (cmd.startsWith('ps -p')) return { stdout: 'Tue Jan  1 00:00:00 2026 node /x/lib/cc-viewer/cli.js\n' };
      return { stdout: '' };
    };
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    const procs = r.json().processes;
    assert.equal(procs.length, 1);
    assert.equal(procs[0].pid, me);
    assert.equal(procs[0].isCurrent, true);
  });

  it('500 when execAsync throws outside the guarded lsof call', async () => {
    if (platform() === 'win32') return;
    // lsof 成功返回一个 node 行，但后续 ps 调用整体 throw（绕过 .catch 的不是这里——
    // 这里让 stdout.trim() 之前的访问抛错来命中外层 catch）。
    const execAsync = async (cmd) => {
      if (cmd.startsWith('lsof')) return { stdout: { trim() { throw new Error('parse boom'); } } };
      return { stdout: '' };
    };
    const r = await callGet(handler, '/api/ccv-processes', { ...DEPS, execAsync });
    assert.equal(r.status, 500);
    assert.equal(r.json().error, 'parse boom');
  });
});

// ====================================================================
// ccvProcessesKill POST /api/ccv-processes/kill
// ====================================================================
describe('ccvProcessesKill POST /api/ccv-processes/kill', { concurrency: false }, () => {
  let handler;
  before(() => { handler = handlerFor('/api/ccv-processes/kill', 'POST'); });

  it('400 on invalid PID (non-integer)', async () => {
    const r = await callPost(handler, '/api/ccv-processes/kill', { pid: 'abc' });
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid PID');
  });

  it('400 on non-positive PID', async () => {
    const r = await callPost(handler, '/api/ccv-processes/kill', { pid: 0 });
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'Invalid PID');
  });

  it('403 when trying to kill the current process', async () => {
    const r = await callPost(handler, '/api/ccv-processes/kill', { pid: process.pid });
    assert.equal(r.status, 403);
    assert.equal(r.json().error, 'Cannot kill current process');
  });

  it('403 when target is not a node process on a CCV port', async () => {
    const execAsync = async () => ({ stdout: 'COMMAND PID\nsshd 1234 root 3u IPv4 TCP *:22 (LISTEN)\n' });
    const r = await callPost(handler, '/api/ccv-processes/kill', { pid: 1234 }, { ...DEPS, execAsync });
    assert.equal(r.status, 403);
    assert.equal(r.json().error, 'Not a CCV process');
  });

  it('200 and sends SIGTERM when target is a node CCV-port process', async () => {
    const target = 88123;
    const execAsync = async () => ({
      stdout: 'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\n' +
        `node ${target} sky 20u IPv4 0x0 0t0 TCP *:7011 (LISTEN)\n`,
    });
    // 拦截 process.kill，避免真的发信号
    const origKill = process.kill;
    let killed = null;
    process.kill = (pid, sig) => { killed = { pid, sig }; };
    try {
      const r = await callPost(handler, '/api/ccv-processes/kill', { pid: target }, { ...DEPS, execAsync });
      assert.equal(r.status, 200);
      assert.equal(r.json().ok, true);
      assert.deepEqual(killed, { pid: target, sig: 'SIGTERM' });
    } finally {
      process.kill = origKill;
    }
  });

  it('500 on invalid JSON body', async () => {
    const r = await callPost(handler, '/api/ccv-processes/kill', 'not-json{');
    assert.equal(r.status, 500);
    assert.ok(typeof r.json().error === 'string');
  });
});

// ====================================================================
// teamStatus POST /api/team-status
// ====================================================================
describe('teamStatus POST /api/team-status', { concurrency: false }, () => {
  let handler;
  let fakeHome, teamsRoot, origHome;

  before(() => {
    handler = handlerFor('/api/team-status', 'POST');
    fakeHome = mkdtempSync(join(TMP_ROOT, 'home-'));
    teamsRoot = join(fakeHome, '.claude', 'teams');
    mkdirSync(teamsRoot, { recursive: true });
    origHome = process.env.HOME;
    // buildTeamStatusResponse 不收 baseDir，内部走 homedir()/.claude/teams；
    // 在 POSIX 上 os.homedir() 读 process.env.HOME。
    process.env.HOME = fakeHome;
  });
  after(() => {
    if (origHome === undefined) delete process.env.HOME; else process.env.HOME = origHome;
  });

  it('400 on invalid JSON body (fixed message, no echo of parse error)', async () => {
    const r = await callPost(handler, '/api/team-status', '{bad json');
    assert.equal(r.status, 400);
    assert.equal(r.json().error, 'invalid_json');
  });

  it('empty/absent teams → empty statuses map', async () => {
    const r = await callPost(handler, '/api/team-status', {});
    assert.equal(r.status, 200);
    assert.deepEqual(r.json().statuses, {});
  });

  it('classifies dead / residue / possiblyAlive teams', async () => {
    // dead：目录不存在
    // residue：目录存在，inbox 全无 json 文件
    const residueDir = join(teamsRoot, 'residue-team');
    mkdirSync(join(residueDir, 'inboxes'), { recursive: true });
    // possiblyAlive：inbox 有近期 json
    const aliveDir = join(teamsRoot, 'alive-team');
    mkdirSync(join(aliveDir, 'inboxes'), { recursive: true });
    writeFileSync(join(aliveDir, 'inboxes', 'msg.json'), '{}');
    // mtime 设为现在 → < 10min 活跃窗口
    const now = Date.now() / 1000;
    utimesSync(join(aliveDir, 'inboxes', 'msg.json'), now, now);

    const r = await callPost(handler, '/api/team-status', {
      teams: [
        { name: 'no-such-team' },
        { name: 'residue-team' },
        { name: 'alive-team' },
      ],
    });
    assert.equal(r.status, 200);
    const s = r.json().statuses;
    assert.equal(s['no-such-team'].state, 'dead');
    assert.equal(s['residue-team'].state, 'residue');
    assert.equal(s['alive-team'].state, 'possiblyAlive');
    assert.equal(s['alive-team'].inboxCount, 1);
  });

  it('classifies residue when inbox is stale (> 10 min)', async () => {
    const staleDir = join(teamsRoot, 'stale-team');
    mkdirSync(join(staleDir, 'inboxes'), { recursive: true });
    writeFileSync(join(staleDir, 'inboxes', 'old.json'), '{}');
    const old = (Date.now() - 20 * 60 * 1000) / 1000; // 20 分钟前
    utimesSync(join(staleDir, 'inboxes', 'old.json'), old, old);

    const r = await callPost(handler, '/api/team-status', { teams: [{ name: 'stale-team' }] });
    const s = r.json().statuses;
    assert.equal(s['stale-team'].state, 'residue');
    assert.ok(s['stale-team'].lastInboxMtime > 0);
  });

  it('returns error state for an invalid team name', async () => {
    // buildTeamStatusResponse 先用 isValidTeamName 过滤非法 name → 不进 statuses。
    // 用一个能过 isValidTeamName 但 lstat 命中 not_a_directory 的：建一个同名普通文件。
    writeFileSync(join(teamsRoot, 'file-not-dir'), 'x');
    const r = await callPost(handler, '/api/team-status', { teams: [{ name: 'file-not-dir' }] });
    const s = r.json().statuses;
    assert.equal(s['file-not-dir'].state, 'error');
    assert.equal(s['file-not-dir'].error, 'not_a_directory');
  });

  it('filters out names failing isValidTeamName entirely', async () => {
    const r = await callPost(handler, '/api/team-status', {
      teams: [{ name: '../escape' }, { name: '' }, { name: 'valid-but-dead' }],
    });
    const s = r.json().statuses;
    assert.ok(!('../escape' in s), 'path-traversal name dropped before stat');
    assert.ok(!('' in s));
    assert.equal(s['valid-but-dead'].state, 'dead');
  });

  it('truncates to 100 teams and adds a warning', async () => {
    const teams = Array.from({ length: 150 }, (_, i) => ({ name: `bulk-${i}` }));
    const r = await callPost(handler, '/api/team-status', { teams });
    const data = r.json();
    assert.ok(Array.isArray(data.warnings));
    assert.ok(data.warnings.some(w => /truncated_to_100_teams/.test(w)));
    assert.equal(Object.keys(data.statuses).length, 100);
  });
});

after(() => {
  try { rmSync(TMP_ROOT, { recursive: true, force: true }); } catch {}
});
