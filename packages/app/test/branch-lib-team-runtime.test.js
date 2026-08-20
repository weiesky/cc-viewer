import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let mod;
let sandbox;

before(async () => {
  // 动态 import 目标模块（项目惯例：配合 _shims/register.mjs）
  mod = await import('../server/lib/team-runtime.js');
  sandbox = mkdtempSync(join(tmpdir(), 'ccv-branch-team-rt-'));
});

after(() => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

describe('team-runtime 分支补齐', () => {

  // --- isValidTeamName: typeof name !== 'string' 这一臂（line 31） ---
  it('B1: name 为非字符串(number) → error invalid_name', async () => {
    const res = await mod.checkTeamRuntime(12345, null, sandbox);
    assert.equal(res.state, 'error');
    assert.equal(res.error, 'invalid_name');
  });

  it('B1b: name 为对象/布尔 → error invalid_name', async () => {
    assert.equal((await mod.checkTeamRuntime({}, null, sandbox)).state, 'error');
    assert.equal((await mod.checkTeamRuntime(true, null, sandbox)).state, 'error');
  });

  // --- isValidTeamName: name.length > 255 这一臂（line 32 第二臂） ---
  it('B2: name 超长(>255) → error invalid_name', async () => {
    const res = await mod.checkTeamRuntime('x'.repeat(256), null, sandbox);
    assert.equal(res.state, 'error');
    assert.equal(res.error, 'invalid_name');
  });

  // --- inbox 遍历：非 .json 文件被跳过（line 88 的 true 臂 continue） ---
  it('B3: inbox 含非 .json 文件 → 被跳过，仅 .json 计入', async () => {
    const dir = join(sandbox, 'mixed-inbox');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    // 非 json 文件（应被 endsWith('.json') 过滤掉）
    writeFileSync(join(inbox, 'notes.txt'), 'ignore me');
    writeFileSync(join(inbox, 'README.md'), '# nope');
    // 一个有效 json，近期写入
    const jf = join(inbox, 'worker.json');
    writeFileSync(jf, '[]');
    const recent = (Date.now() - 30_000) / 1000;
    utimesSync(jf, recent, recent);

    const res = await mod.checkTeamRuntime('mixed-inbox', null, sandbox);
    assert.equal(res.state, 'possiblyAlive');
    // 只有 1 个 json 计入，非 json 被跳过
    assert.equal(res.inboxCount, 1);
  });

  it('B3b: inbox 内全是非 .json 文件 → 无活动 → residue', async () => {
    const dir = join(sandbox, 'only-nonjson');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    writeFileSync(join(inbox, 'a.txt'), 'x');
    writeFileSync(join(inbox, 'b.log'), 'y');
    const res = await mod.checkTeamRuntime('only-nonjson', null, sandbox);
    assert.equal(res.state, 'residue');
    assert.equal(res.lastInboxMtime, 0);
    assert.equal(res.inboxCount, 0);
  });

  // --- inbox 遍历：entry 是 .json 但不是文件(是目录) → 跳过（line 91 的 true 臂） ---
  it('B4: inbox 内有名为 *.json 的子目录 → !isFile 跳过', async () => {
    const dir = join(sandbox, 'json-dir-entry');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    // 一个看起来像 json 但其实是目录的 entry
    mkdirSync(join(inbox, 'fake.json'), { recursive: true });
    // 一个真正的近期 json
    const jf = join(inbox, 'real.json');
    writeFileSync(jf, '[]');
    const recent = (Date.now() - 20_000) / 1000;
    utimesSync(jf, recent, recent);

    const res = await mod.checkTeamRuntime('json-dir-entry', null, sandbox);
    assert.equal(res.state, 'possiblyAlive');
    // 目录形 .json 不计入，只有 real.json
    assert.equal(res.inboxCount, 1);
  });

  it('B4b: inbox 内仅有名为 *.json 的子目录(无真实文件) → residue', async () => {
    const dir = join(sandbox, 'json-dir-only');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    mkdirSync(join(inbox, 'phantom.json'), { recursive: true });
    const res = await mod.checkTeamRuntime('json-dir-only', null, sandbox);
    assert.equal(res.state, 'residue');
    assert.equal(res.lastInboxMtime, 0);
    assert.equal(res.inboxCount, 0);
  });

  // --- checkTeamsRuntime: t 为 falsy / t.name 非字符串 → continue（line 115 两臂） ---
  it('B5: checkTeamsRuntime 跳过 falsy 项与 name 非字符串项', async () => {
    const dir = join(sandbox, 'good-team');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    const jf = join(inbox, 'w.json');
    writeFileSync(jf, '[]');
    const recent = (Date.now() - 10_000) / 1000;
    utimesSync(jf, recent, recent);

    const res = await mod.checkTeamsRuntime([
      null,                       // falsy → skip
      undefined,                  // falsy → skip
      0,                          // falsy → skip
      { name: 42 },               // name 非字符串 → skip
      { name: null },             // name 非字符串 → skip
      {},                         // 无 name → skip
      { name: 'good-team' },      // 有效
    ], sandbox);
    assert.equal(Object.keys(res).length, 1);
    assert.equal(res['good-team'].state, 'possiblyAlive');
  });

  // --- checkTeamsRuntime: 非数组输入 → 返回空对象（line 113） ---
  it('B6: checkTeamsRuntime 输入非数组 → {}', async () => {
    assert.deepEqual(await mod.checkTeamsRuntime(null, sandbox), {});
    assert.deepEqual(await mod.checkTeamsRuntime('nope', sandbox), {});
    assert.deepEqual(await mod.checkTeamsRuntime({ teams: [] }, sandbox), {});
    assert.deepEqual(await mod.checkTeamsRuntime(undefined, sandbox), {});
  });

  // --- checkTeamsRuntime: endTime == null 时不解析（line 118 false 臂） ---
  it('B7: endTime 缺省/为 null → 不做 reuse 检测', async () => {
    const dir = join(sandbox, 'no-endtime');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    const jf = join(inbox, 'w.json');
    writeFileSync(jf, '[]');
    const recent = (Date.now() - 5_000) / 1000;
    utimesSync(jf, recent, recent);

    // 一项不带 endTime，一项 endTime: null
    const res = await mod.checkTeamsRuntime([
      { name: 'no-endtime' },
      { name: 'no-endtime', endTime: null },
    ], sandbox);
    assert.equal(res['no-endtime'].state, 'possiblyAlive');
  });

  // --- checkTeamsRuntime: endTime 是数字 → 直接用（line 119 true 臂） ---
  it('B8: endTime 数字型透传触发 reused', async () => {
    const dir = join(sandbox, 'num-endtime');
    mkdirSync(dir, { recursive: true });
    const longAgo = Date.now() - 60 * 60_000;
    const res = await mod.checkTeamsRuntime([
      { name: 'num-endtime', endTime: longAgo },
    ], sandbox);
    assert.equal(res['num-endtime'].state, 'reused');
  });

  // --- checkTeamsRuntime: endTime 字符串解析失败(NaN) → null（line 120 false 臂） ---
  it('B9: endTime 字符串无法解析(NaN) → 当作未提供', async () => {
    const dir = join(sandbox, 'nan-endtime');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    const jf = join(inbox, 'w.json');
    writeFileSync(jf, '[]');
    const recent = (Date.now() - 5_000) / 1000;
    utimesSync(jf, recent, recent);
    const res = await mod.checkTeamsRuntime([
      { name: 'nan-endtime', endTime: 'garbage-not-a-date' },
    ], sandbox);
    assert.equal(res['nan-endtime'].state, 'possiblyAlive');
  });

  // --- checkTeamRuntime: endTimeMs 为 0/NaN/非有限 → 跳过 reuse（line 72 各臂） ---
  it('B10: endTimeMs 为 0 → 跳过 reuse 检测(走 inbox 逻辑)', async () => {
    const dir = join(sandbox, 'zero-endtime');
    mkdirSync(dir, { recursive: true });
    // endTimeMs=0 是 falsy，跳过 reuse；无 inbox → residue
    const res = await mod.checkTeamRuntime('zero-endtime', 0, sandbox);
    assert.equal(res.state, 'residue');
  });

  it('B10b: endTimeMs 为 Infinity → Number.isFinite=false 跳过 reuse', async () => {
    const dir = join(sandbox, 'inf-endtime');
    mkdirSync(dir, { recursive: true });
    const res = await mod.checkTeamRuntime('inf-endtime', Infinity, sandbox);
    assert.equal(res.state, 'residue');
  });

  // --- checkTeamRuntime: endTime 有效但 birthMs 未达 reuse 阈值 → 继续 inbox 逻辑 ---
  it('B11: endTime 在很近的未来 → birthMs < endTime+5min → 非 reused', async () => {
    const dir = join(sandbox, 'future-endtime');
    const inbox = join(dir, 'inboxes');
    mkdirSync(inbox, { recursive: true });
    const jf = join(inbox, 'w.json');
    writeFileSync(jf, '[]');
    const recent = (Date.now() - 5_000) / 1000;
    utimesSync(jf, recent, recent);
    // endTime 设为现在 → birthMs(≈now) < now + 5min，不触发 reused
    const res = await mod.checkTeamRuntime('future-endtime', Date.now(), sandbox);
    assert.equal(res.state, 'possiblyAlive');
  });

  // --- buildTeamStatusResponse: body 为 null / 无 teams（line 138 ?? 与可选链） ---
  it('B12: buildTeamStatusResponse body 为 null/undefined → statuses:{}', async () => {
    assert.deepEqual(await mod.buildTeamStatusResponse(null, sandbox), { statuses: {} });
    assert.deepEqual(await mod.buildTeamStatusResponse(undefined, sandbox), { statuses: {} });
  });

  // --- checkTeamRuntime: 不传 baseDir → 走默认 ~/.claude/teams（line 49 右臂默认值） ---
  it('B13: 省略 baseDir → 使用默认根目录, 不存在的 team → dead', async () => {
    // 用绝不会存在的随机名，默认根目录下查不到 → dead；无任何写副作用
    const ghost = 'ccv-branch-ghost-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const res = await mod.checkTeamRuntime(ghost, null);
    assert.equal(res.state, 'dead');
  });

  // --- buildTeamStatusResponse: 省略 baseDir 也走默认根目录 ---
  it('B14: buildTeamStatusResponse 省略 baseDir → 默认根目录, 幽灵 team → dead', async () => {
    const ghost = 'ccv-branch-ghost2-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const res = await mod.buildTeamStatusResponse({ teams: [{ name: ghost }] });
    assert.equal(res.statuses[ghost].state, 'dead');
    assert.equal(res.warnings, undefined);
  });

  // --- checkTeamRuntime: lstatSync 抛非 ENOENT 错误 → catch 第 64 行 error: err.message ---
  // baseDir 指向一个普通文件, 则 teamDir = file/name 会让 lstatSync 抛 ENOTDIR(非 ENOENT),
  // 命中 line 63 的 ENOENT 判定 false 臂 + line 64 的 err.message 分支
  it('B15c: lstat 抛 ENOTDIR(非 ENOENT) → state error 带 message', async () => {
    const filePath = join(sandbox, 'plain-file-as-base');
    writeFileSync(filePath, 'x');
    const res = await mod.checkTeamRuntime('whatever', null, filePath);
    assert.equal(res.state, 'error');
    assert.ok(typeof res.error === 'string' && res.error.length > 0);
    assert.match(res.error, /ENOTDIR|not a directory/i);
  });

  // --- checkTeamsRuntime: 内层 checkTeamRuntime 抛错 → 进入 catch（line 124-126） ---
  // baseDir 传非字符串(number) → checkTeamRuntime 第 50 行 join(root,name) 在 try 之外抛 TypeError,
  // 被 checkTeamsRuntime 的 try/catch 捕获 → out[name] = {state:'error', error: err.message}
  it('B16: checkTeamsRuntime 捕获内层抛错 → error 项(err.message)', async () => {
    const res = await mod.checkTeamsRuntime([{ name: 'will-throw' }], 12345);
    assert.equal(res['will-throw'].state, 'error');
    assert.ok(typeof res['will-throw'].error === 'string' && res['will-throw'].error.length > 0);
    // err.message 应包含 path/string 字样（join 的 TypeError）
    assert.match(res['will-throw'].error, /string/i);
  });

  // --- isValidTeamName: 各早退臂逐一命中（即便其他文件已覆盖, 本文件内自洽） ---
  it('B15: isValidTeamName 各非法形态 → error', async () => {
    // line 33: 路径分隔符 / 反斜杠 / null 字节
    assert.equal((await mod.checkTeamRuntime('a/b', null, sandbox)).error, 'invalid_name');
    assert.equal((await mod.checkTeamRuntime('a\\b', null, sandbox)).error, 'invalid_name');
    assert.equal((await mod.checkTeamRuntime('a\0b', null, sandbox)).error, 'invalid_name');
    // line 34: . 与 ..
    assert.equal((await mod.checkTeamRuntime('.', null, sandbox)).error, 'invalid_name');
    assert.equal((await mod.checkTeamRuntime('..', null, sandbox)).error, 'invalid_name');
    // line 35: 跨段跳跃 ../ （注：/.. 形态因含 / 已被 line 33 提前拦截, 单独不可达）
    assert.equal((await mod.checkTeamRuntime('../outside', null, sandbox)).error, 'invalid_name');
  });
});
