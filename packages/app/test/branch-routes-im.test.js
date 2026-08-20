// Branch coverage for server/routes/im.js — fills the per-handler arms that the existing
// test/api-im.test.js + test/im-routes-gap.test.js leave open (single-run branch was 69%):
//   - L32  platformOf: URL that does NOT match IM_RE → return null → 404 (distinct from "matches but unknown descriptor")
//   - L61  readBody: body length > MAX_POST_BODY → req.destroy()
//   - L102 imStatus admin (isLocal) + isWorker:true → pid = process.pid arm
//   - notFound/loopbackOnly arms for every loopback-only handler (test/process/senders/append-system GET+POST/skills/toggle/import)
//   - L127 imConfigPost: incoming[allowField] not an array → `: []` arm
//   - L146/204/243/267 `|| e`: thrown value without `.message`
//   - L160 imTestPost: empty body → `: {}` arm ; malformed JSON → catch (fall back to stored)
//   - L190 imProcessPost: malformed JSON → catch → action undefined → 400
//   - L216 imLogs: a real .jsonl present → latest set (non-null arm)
//   - L306/308 imSkillsToggle: error without .code/.message → 500 + default code/message
//
// Style mirrors test/api-im.test.js (direct route.handler calls + fake req/res + deps doubles,
// no real server / worker spawned). Isolated private CCV_LOG_DIR set BEFORE the findcc-loading import.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import './_shims/register.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Private temp LOG_DIR — must be set before any import that pulls findcc.js (→ LOG_DIR).
const tmpDir = mkdtempSync(join(tmpdir(), 'ccv-branch-im-'));
process.env.CCV_LOG_DIR = tmpDir;
process.env.CLAUDE_CONFIG_DIR = tmpDir;
process.env.CCV_WORKSPACE_MODE = '1';
process.env.CCV_CLI_MODE = '0';

// Place a real worker .jsonl so imLogs(discord) resolves a non-null `latest` (L216).
mkdirSync(join(tmpDir, 'IM_discord'), { recursive: true });
writeFileSync(join(tmpDir, 'IM_discord', 'IM_discord_2026-01-01.jsonl'), '{}\n');

/** fake req honoring readBody's data/end contract. */
const fakeReq = (bodyStr) => ({
  on(ev, cb) { if (ev === 'data' && bodyStr) cb(Buffer.from(bodyStr)); if (ev === 'end') cb(); return this; },
});

/** Direct route.handler call; collects status/payload, resolves on res.end. */
function call(route, { pathname, searchParams, body, isLocal = true, deps, req }) {
  let status = 0, payload = '';
  let resolveEnd; const done = new Promise((r) => { resolveEnd = r; });
  const res = { writeHead(s) { status = s; }, end(b) { payload = b || ''; resolveEnd(); } };
  const r = req || fakeReq(body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body)));
  route.handler(r, res, { pathname, searchParams }, isLocal, deps);
  return done.then(() => ({ status, payload, json: () => JSON.parse(payload) }));
}

describe('server/routes/im.js 分支补齐', { concurrency: false }, () => {
  let imRoutes;
  before(async () => { ({ imRoutes } = await import('../server/routes/im.js')); });
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  // ── L32: platformOf 对不匹配 IM_RE 的 pathname 返回 null → notFound ──
  // 已有测试用 'telegram'(匹配正则但 descriptor 未知 → L33 return null)；这里给一个根本不匹配正则的 verb。
  it('GET status：pathname 不匹配 IM_RE（未知 verb）→ 404（platformOf 第一臂 return null）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/status', 'GET'));
    // predicate 用真实 status URL 选中 handler；再喂一个正则不匹配的 pathname 让 platformOf 走 !m 臂。
    const r = await call(route, { pathname: '/api/im/feishu/bogusverb', deps: { im: {} } });
    assert.equal(r.status, 404);
    assert.match(r.payload, /Unknown IM platform/);
  });

  // ── L102: imStatus admin(isLocal=true) + isWorker=true → pid = process.pid ──
  it('GET status：isWorker + 本机 admin → pid 取 process.pid，附带明文密钥', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/status', 'GET'));
    const deps = { im: { isWorker: true, getBridgeStatus: () => ({ running: true, connected: false }) } };
    const r = await call(route, { pathname: '/api/im/feishu/status', isLocal: true, deps });
    assert.equal(r.status, 200);
    assert.equal(r.json().pid, process.pid, 'worker admin 路径下 pid = 自身进程 pid');
    assert.deepEqual(r.json().connection, { running: true, connected: false });
    assert.equal(r.json().process, null, 'worker 不经 manager，processInfo 为 null');
  });

  // ── L61: readBody body 超 MAX_POST_BODY → req.destroy() ──
  it('POST config：body 超过 MAX_POST_BODY → req.destroy()（end 不触发，连接被毁）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    let destroyed = false;
    // 自定义 req：投递一个超长 chunk，end 由 destroy 抑制（真实场景 destroy 后不再 end）。
    const req = {
      on(ev, cb) {
        if (ev === 'data') cb(Buffer.from('x'.repeat(64)));
        // 只有未被 destroy 才允许 end；模拟 destroy 截断流。
        if (ev === 'end' && !destroyed) cb();
        return this;
      },
      destroy() { destroyed = true; },
    };
    let ended = false;
    const res = { writeHead() {}, end() { ended = true; } };
    route.handler(req, res, { pathname: '/api/im/feishu/config' }, true, { MAX_POST_BODY: 8, im: { isWorker: false, restartProcess: async () => {}, stopProcess: async () => {} } });
    await new Promise((r) => setImmediate(r));
    assert.equal(destroyed, true, 'body 超限必须 destroy');
    assert.equal(ended, false, 'destroy 截断流，end 不应触发');
  });

  // ── L108: imConfigPost 未知平台 → 404 ──
  it('POST config：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const r = await call(route, { pathname: '/api/im/telegram/config', body: { enabled: false }, deps: { MAX_POST_BODY: 1e6, im: { isWorker: false } } });
    assert.equal(r.status, 404);
  });

  // ── L127: imConfigPost incoming[allowField] 不是数组 → raw = [] 臂 ──
  it('POST config：enabled + allowlist 字段非数组（字符串）→ 视为空名单，打审计告警，仍 200', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const calls = [];
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async (id) => calls.push(['restart', id]), stopProcess: async () => {} } };
    const origWarn = console.warn; let warned = '';
    console.warn = (...a) => { warned += a.join(' '); };
    let r;
    try {
      // allowUserIds 给字符串而非数组 → Array.isArray false → raw=[] → list 空 → 审计告警。
      r = await call(route, { pathname: '/api/im/feishu/config', body: { enabled: true, appId: 'a', appSecret: 'b', allowUserIds: 'not-an-array' }, deps });
    } finally { console.warn = origWarn; }
    assert.equal(r.status, 200);
    assert.match(warned, /EMPTY allowlist/);
    assert.deepEqual(calls, [['restart', 'feishu']]);
  });

  // ── L146 `|| e`: restartProcess 抛非 Error（无 .message）→ console.error 记 e 本体，仍 200 ──
  it('POST config：restartProcess 抛裸字符串（无 .message）→ catch 记 e 本体，仍 200', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/config', 'POST'));
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, restartProcess: async () => { throw 'bare-string-failure'; }, stopProcess: async () => {} } };
    const origErr = console.error; let logged = '';
    console.error = (...a) => { logged += a.join(' '); };
    let r;
    try {
      r = await call(route, { pathname: '/api/im/feishu/config', body: { enabled: true, appId: 'a', appSecret: 'b', allowUserIds: ['ou_ok'] }, deps });
    } finally { console.error = origErr; }
    assert.equal(r.status, 200);
    assert.match(logged, /bare-string-failure/, '无 .message 时记日志走 || e 臂');
  });

  // ── imTestPost: notFound / loopbackOnly / L160 `: {}` / L160 catch ──
  it('POST test：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/test', 'POST'));
    const r = await call(route, { pathname: '/api/im/telegram/test', deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 404);
  });
  it('POST test：非本机调用 → 403 loopback only', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/test', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/test', isLocal: false, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 403);
    assert.match(r.payload, /Loopback only/);
  });
  // 用 discord（本文件从不写其 config）确保无 stored 凭证 → 命中 missing 守卫，不触达 testConnection。
  it('POST test：空 body → incoming={} 臂；缺凭证 → ok:false missing', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/test', 'POST'));
    // 空 body → `body ? JSON.parse : {}` 取 {} 臂；无 stored 凭证 → missing 守卫。
    const r = await call(route, { pathname: '/api/im/discord/test', body: null, deps: { MAX_POST_BODY: 1e6, im: { testConnection: async () => ({ ok: true }) } } });
    assert.equal(r.status, 200);
    assert.equal(r.json().ok, false);
    assert.match(r.json().detail, /missing/);
  });
  it('POST test：坏 JSON → catch 回退到 stored；缺凭证 → ok:false', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/test', 'POST'));
    const r = await call(route, { pathname: '/api/im/discord/test', body: '{broken', deps: { MAX_POST_BODY: 1e6, im: { testConnection: async () => ({ ok: true }) } } });
    assert.equal(r.status, 200);
    assert.equal(r.json().ok, false, '坏 JSON 回退 stored，仍无凭证 → missing');
  });

  // ── imProcessPost: notFound / loopbackOnly / L190 catch ──
  it('POST process：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/process', 'POST'));
    const r = await call(route, { pathname: '/api/im/telegram/process', deps: { MAX_POST_BODY: 1e6, im: { isWorker: false } } });
    assert.equal(r.status, 404);
  });
  it('POST process：非本机 → 403', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/process', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/process', isLocal: false, deps: { MAX_POST_BODY: 1e6, im: { isWorker: false } } });
    assert.equal(r.status, 403);
  });
  it('POST process：坏 JSON → catch（action undefined）→ 400', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/process', 'POST'));
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, startProcess: async () => {}, stopProcess: async () => {}, restartProcess: async () => {}, getProcessStatus: async () => ({}) } };
    const r = await call(route, { pathname: '/api/im/feishu/process', body: '{not-json', deps });
    assert.equal(r.status, 400);
    assert.match(r.payload, /start\|stop\|restart/);
  });
  // ── L204 `|| e`: 进程操作抛裸字符串 → 500 String(e?.message || e) 的 || e 臂 ──
  it('POST process：startProcess 抛裸字符串（无 .message）→ 500 错误体含该字符串', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/process', 'POST'));
    const deps = { MAX_POST_BODY: 1e6, im: { isWorker: false, startProcess: async () => { throw 'process-bare-boom'; }, getProcessStatus: async () => ({}) } };
    const r = await call(route, { pathname: '/api/im/feishu/process', body: { action: 'start' }, deps });
    assert.equal(r.status, 500);
    assert.equal(r.json().ok, false);
    assert.match(r.json().error, /process-bare-boom/);
  });

  // ── imLogs: notFound + L216 latest 非空臂 ──
  it('GET logs：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/logs', 'GET'));
    const r = await call(route, { pathname: '/api/im/telegram/logs', deps: { im: {} } });
    assert.equal(r.status, 404);
  });
  it('GET logs：worker 目录存在 .jsonl → latest 解析为相对路径（非 null 臂）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/logs', 'GET'));
    const r = await call(route, { pathname: '/api/im/discord/logs', deps: { im: {} } });
    assert.equal(r.status, 200);
    assert.equal(r.json().project, 'IM_discord');
    assert.equal(r.json().latest, 'IM_discord/IM_discord_2026-01-01.jsonl', 'findRecentLog 命中 → latest 设值');
  });
  it('GET logs：v2 会话选取跳过 discardable 探针（更新的探针不得抢占 latest）', async () => {
    // real v2 session (older) + quota-probe orphan (NEWER startTs): the pick
    // must land on the real session, not the probe (2026-07-16 discard gate).
    const sroot = join(tmpDir, 'IM_dingtalk', 'sessions');
    const realDir = join(sroot, '20260716000001_aaaa1111-2222-4333-8444-000000000001');
    mkdirSync(join(realDir, 'conversations', 'main'), { recursive: true });
    writeFileSync(join(realDir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'aaaa1111-2222-4333-8444-000000000001', startTs: '2026-07-16T00:00:01.000Z' }));
    writeFileSync(join(realDir, 'journal.jsonl'),
      JSON.stringify({ ph: 'meta', wireFormat: 2 }) + '\n'
      + JSON.stringify({ ph: 'req', seq: 1, rid: 'r1', kind: 'main', ts: '2026-07-16T00:00:01.000Z', url: 'u' }) + '\n');
    const probeDir = join(sroot, '20260716000002_bbbb2222-3333-4444-8555-000000000002');
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(join(probeDir, 'meta.json'), JSON.stringify({ wireFormat: 2, sessionId: 'bbbb2222-3333-4444-8555-000000000002', startTs: '2026-07-16T00:00:02.000Z' }));
    writeFileSync(join(probeDir, 'journal.jsonl'),
      JSON.stringify({ ph: 'meta', wireFormat: 2 }) + '\n'
      + JSON.stringify({ ph: 'req', seq: 1, rid: 'rq', kind: 'sub', ts: '2026-07-16T00:00:02.000Z', url: 'u' }) + '\n');

    const route = imRoutes.find((r) => r.predicate('/api/im/dingtalk/logs', 'GET'));
    const r = await call(route, { pathname: '/api/im/dingtalk/logs', deps: { im: {} } });
    assert.equal(r.status, 200);
    assert.ok(r.json().latest && r.json().latest.includes('aaaa1111'), `latest must be the real session, got ${r.json().latest}`);
  });
  it('GET logs：惰性调用 deps.ensureImWatch(platformId)（登记日志目录监听）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/logs', 'GET'));
    const calls = [];
    const r = await call(route, { pathname: '/api/im/discord/logs', deps: { im: {}, ensureImWatch: (id) => calls.push(id) } });
    assert.equal(r.status, 200);
    assert.deepEqual(calls, ['discord'], 'imLogs 应惰性登记该平台的日志目录监听');
  });
  it('GET logs：deps.ensureImWatch 缺失时（worker/旧 deps）optional-chaining 不抛、仍正常返回', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/discord/logs', 'GET'));
    const r = await call(route, { pathname: '/api/im/discord/logs', deps: { im: {} } });
    assert.equal(r.status, 200); // 无 ensureImWatch 字段也不影响主流程
  });

  // ── imSenders: notFound + loopbackOnly ──
  it('GET senders：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/senders', 'GET'));
    const r = await call(route, { pathname: '/api/im/telegram/senders', deps: { im: {} } });
    assert.equal(r.status, 404);
  });
  it('GET senders：非本机 → 403', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/senders', 'GET'));
    const r = await call(route, { pathname: '/api/im/feishu/senders', isLocal: false, deps: { im: {} } });
    assert.equal(r.status, 403);
  });

  // ── imAppendSystemGet: notFound + loopbackOnly + L243 `|| e` ──
  it('GET append-system：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/append-system', 'GET'));
    const r = await call(route, { pathname: '/api/im/telegram/append-system', deps: { im: {} } });
    assert.equal(r.status, 404);
  });
  it('GET append-system：非本机 → 403', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/append-system', 'GET'));
    const r = await call(route, { pathname: '/api/im/feishu/append-system', isLocal: false, deps: { im: {} } });
    assert.equal(r.status, 403);
  });
  it('GET append-system?default=1 → 返回当前语言预置（绕过磁盘文件）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/dingtalk/append-system', 'GET'));
    const r = await call(route, { pathname: '/api/im/dingtalk/append-system', searchParams: new URLSearchParams({ default: '1' }), deps: { im: {} } });
    assert.equal(r.status, 200);
    const j = r.json();
    assert.equal(j.platform, 'dingtalk');
    assert.match(j.content, /AskUserQuestion/);   // 预置正文（不读磁盘文件）
    assert.match(j.content, /IM_dingtalk\//);     // {id} 已替换
  });

  // ── imAppendSystemPost: notFound + loopbackOnly + L254 catch（坏 JSON） + L267 `|| e` ──
  it('POST append-system：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/append-system', 'POST'));
    const r = await call(route, { pathname: '/api/im/telegram/append-system', body: { content: 'x' }, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 404);
  });
  it('POST append-system：坏 JSON → 400 Invalid JSON', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/append-system', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/append-system', body: '{broken', deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 400);
    assert.match(r.payload, /Invalid JSON/);
  });
  // ── L242 catch（imAppendSystemGet）：readImAppendSystem 抛非 ENOENT → 500 String(e?.message||e) ──
  // 把 IM 目录下的 CC_APPEND_SYSTEM.md 造成「目录」：readFileSync 抛 EISDIR（非 ENOENT，不会回落 preset）→ rethrow → catch。
  it('GET append-system：CC_APPEND_SYSTEM.md 是目录 → readFileSync 抛 EISDIR → 500（catch 臂 + e.message）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/dingtalk/append-system', 'GET'));
    const { imDir } = await import('../server/lib/im/im-lock.js');
    const dir = imDir('dingtalk');
    mkdirSync(join(dir, 'CC_APPEND_SYSTEM.md'), { recursive: true }); // CC_APPEND_SYSTEM.md 当目录 → 读取必抛 EISDIR
    const r = await call(route, { pathname: '/api/im/dingtalk/append-system', isLocal: true, deps: { im: {} } });
    assert.equal(r.status, 500, '非 ENOENT 的读错误走 catch → 500');
    assert.ok(r.json().error, '错误消息透出（e.message 非空 → 走 String(e?.message||e) 左臂）');
  });
  // ── L261 catch（imAppendSystemPost）：writeImAppendSystem 抛 → 500 String(e?.message||e) ──
  // 把 IM 目录本身造成「文件」：writeImAppendSystem 内 mkdirSync(dir,{recursive:true}) 抛 EEXIST/ENOTDIR → catch。
  it('POST append-system：IM 目录是文件 → mkdirSync 抛 → 500（写失败 catch 臂）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/append-system', 'POST'));
    const { imDir } = await import('../server/lib/im/im-lock.js');
    const dir = imDir('feishu');
    writeFileSync(dir, 'iam-a-file-not-a-dir'); // IM_feishu 占成文件 → mkdirSync(recursive) 抛
    const r = await call(route, { pathname: '/api/im/feishu/append-system', body: { content: 'hello' }, isLocal: true, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 500, '写盘失败走 catch → 500');
    assert.ok(r.json().error, '错误消息透出');
  });

  // ── imSkills: notFound + loopbackOnly ──
  it('GET skills：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills', 'GET'));
    const r = await call(route, { pathname: '/api/im/telegram/skills', deps: { im: {} } });
    assert.equal(r.status, 404);
  });
  it('GET skills：非本机 → 403', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills', 'GET'));
    const r = await call(route, { pathname: '/api/im/feishu/skills', isLocal: false, deps: { im: {} } });
    assert.equal(r.status, 403);
  });

  // ── imSkillsToggle: notFound + loopbackOnly + L299 catch（坏 JSON） + L306/308 默认 status/code/message ──
  it('POST skills/toggle：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/toggle', 'POST'));
    const r = await call(route, { pathname: '/api/im/telegram/skills/toggle', body: { name: 'x', enable: true }, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 404);
  });
  it('POST skills/toggle：非本机 → 403', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/toggle', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/skills/toggle', body: { name: 'x', enable: true }, isLocal: false, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 403);
  });
  it('POST skills/toggle：坏 JSON → 400 Invalid JSON', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/toggle', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/skills/toggle', body: '{broken', deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 400);
    assert.match(r.payload, /Invalid JSON/);
  });
  it('POST skills/toggle：moveSkill 抛未映射 code 的 fs 错误 → statusMap 默认臂 500', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/wecom/skills/toggle', 'POST'));
    // 构造 enable=true 时 moveSkill 内 mkdirSync(skills) 抛 EEXIST（code 不在 statusMap）→ statusMap[code]||500 默认臂。
    // from=skills-skip/<name> 作真实目录(存在)；skills 作普通文件 → mkdir 抛 EEXIST/ENOTDIR。
    const { imDir } = await import('../server/lib/im/im-lock.js');
    const claudeDir = join(imDir('wecom'), '.claude');
    mkdirSync(join(claudeDir, 'skills-skip', 'mkdirfail-skill'), { recursive: true });
    writeFileSync(join(claudeDir, 'skills'), 'iam-a-file-not-a-dir');
    const r = await call(route, { pathname: '/api/im/wecom/skills/toggle', body: { name: 'mkdirfail-skill', enable: true }, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 500, '未映射的 fs 错误 code → 走 statusMap[code]||500 默认 500');
    assert.ok(r.json().error, '错误消息透出');
    assert.ok(r.json().code, 'fs 错误自带 code');
  });

  // ── imSkillsImport: notFound + loopbackOnly ──
  it('POST skills/import：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/import', 'POST'));
    const r = await call(route, { pathname: '/api/im/telegram/skills/import', deps: { WINDOWS_RESERVED_NAMES: /^$/ , im: {} } });
    assert.equal(r.status, 404);
  });
  it('POST skills/import：非本机 → 403', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/import', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/skills/import', isLocal: false, deps: { WINDOWS_RESERVED_NAMES: /^$/, im: {} } });
    assert.equal(r.status, 403);
  });

  // ── imSkillsDelete: notFound + loopbackOnly + 坏 JSON + NOT_FOUND + 成功删除 ──
  it('POST skills/delete：未知平台 → 404', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/delete', 'POST'));
    const r = await call(route, { pathname: '/api/im/telegram/skills/delete', body: { name: 'x', enabled: true }, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 404);
  });
  it('POST skills/delete：非本机 → 403（不可逆删除不暴露局域网）', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/delete', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/skills/delete', body: { name: 'x', enabled: true }, isLocal: false, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 403);
  });
  it('POST skills/delete：坏 JSON → 400 Invalid JSON', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/feishu/skills/delete', 'POST'));
    const r = await call(route, { pathname: '/api/im/feishu/skills/delete', body: '{broken', deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 400);
    assert.match(r.payload, /Invalid JSON/);
  });
  it('POST skills/delete：不存在 → 404 NOT_FOUND', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/dingtalk/skills/delete', 'POST'));
    const r = await call(route, { pathname: '/api/im/dingtalk/skills/delete', body: { name: 'im-del-absent', enabled: true }, isLocal: true, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 404);
    assert.equal(r.json().code, 'NOT_FOUND');
  });
  it('POST skills/delete：删除已禁用项 → 200 + 目录被永久移除', async () => {
    const route = imRoutes.find((r) => r.predicate('/api/im/dingtalk/skills/delete', 'POST'));
    const { imDir } = await import('../server/lib/im/im-lock.js');
    const dir = join(imDir('dingtalk'), '.claude', 'skills-skip', 'im-del-off');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\ndescription: x\n---\n');
    const r = await call(route, { pathname: '/api/im/dingtalk/skills/delete', body: { name: 'im-del-off', enabled: false }, isLocal: true, deps: { MAX_POST_BODY: 1e6, im: {} } });
    assert.equal(r.status, 200);
    assert.equal(r.json().ok, true);
    assert.equal(existsSync(dir), false);
  });
});
