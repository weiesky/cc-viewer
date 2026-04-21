import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTeamStatusResponse } from '../lib/team-runtime.js';

// 这套测试不起 HTTP server，直接调 buildTeamStatusResponse
// （就是 server.js 里 /api/team-status 背后唯一的业务逻辑）

let sandbox;

before(() => { sandbox = mkdtempSync(join(tmpdir(), 'ccv-endpoint-')); });
after(() => { if (sandbox) rmSync(sandbox, { recursive: true, force: true }); });

function setupTeam(name) {
  const dir = join(sandbox, name);
  mkdirSync(join(dir, 'inboxes'), { recursive: true });
  const f = join(dir, 'inboxes', 'w.json');
  writeFileSync(f, '[]');
  const mtimeS = (Date.now() - 60_000) / 1000;
  utimesSync(f, mtimeS, mtimeS);
  return dir;
}

describe('buildTeamStatusResponse (POST /api/team-status 业务逻辑)', () => {

  it('T1: happy path — 批量查询多个 team 返回 shape 正确', async () => {
    setupTeam('alive-team');
    const body = { teams: [
      { name: 'alive-team' },
      { name: 'ghost-team' },
    ] };
    const res = await buildTeamStatusResponse(body, sandbox);
    assert.ok(res.statuses);
    assert.equal(res.statuses['alive-team'].state, 'possiblyAlive');
    assert.equal(res.statuses['ghost-team'].state, 'dead');
  });

  it('T2: 缺 teams 字段 → statuses: {}', async () => {
    const res = await buildTeamStatusResponse({}, sandbox);
    assert.deepEqual(res, { statuses: {} });
  });

  it('T3: teams 非数组 → statuses: {}', async () => {
    const res = await buildTeamStatusResponse({ teams: 'not-array' }, sandbox);
    assert.deepEqual(res, { statuses: {} });
  });

  it('T4: 过滤掉非法 name（路径分隔符、 .、 .. 等）', async () => {
    const res = await buildTeamStatusResponse({ teams: [
      { name: '../etc/passwd' },
      { name: 'a/b' },
      { name: 'a\\b' },
      { name: 'a\0b' },
      { name: '..' },
      { name: '.' },
    ] }, sandbox);
    assert.deepEqual(res, { statuses: {} }, 'all unsafe names filtered');
  });

  it('T5: 过滤掉空/超长 name', async () => {
    const long = 'x'.repeat(300);
    const res = await buildTeamStatusResponse({ teams: [
      { name: '' },
      { name: long },
      { /* no name */ },
      null,
    ] }, sandbox);
    assert.deepEqual(res, { statuses: {} });
  });

  it('T6: 超过 100 个请求被截断 + warnings 字段', async () => {
    setupTeam('batch-first');
    const teams = [{ name: 'batch-first' }];
    for (let i = 0; i < 200; i++) teams.push({ name: `batch-extra-${i}` });
    const res = await buildTeamStatusResponse({ teams }, sandbox);
    // 应最多返回 100 个 key
    assert.ok(Object.keys(res.statuses).length <= 100);
    // 第一个在前 100 里，应被处理
    assert.equal(res.statuses['batch-first'].state, 'possiblyAlive');
    // m1: 截断时应带 warnings
    assert.ok(Array.isArray(res.warnings) && res.warnings.length > 0, 'should include warnings');
    assert.ok(res.warnings.some(w => w.includes('truncated')));
  });

  it('T6b: 未截断时不带 warnings 字段', async () => {
    const res = await buildTeamStatusResponse({ teams: [{ name: 'whatever' }] }, sandbox);
    assert.equal(res.warnings, undefined);
  });

  it('T8: endTime 是无效字符串 (NaN) 时当作未提供处理', async () => {
    setupTeam('bad-endtime');
    const res = await buildTeamStatusResponse({ teams: [
      { name: 'bad-endtime', endTime: 'definitely-not-a-date' },
    ] }, sandbox);
    // 应 fallback 到不做 reuse 检测，返回 possiblyAlive 而非 error
    assert.equal(res.statuses['bad-endtime'].state, 'possiblyAlive');
  });

  it('T7: endTime 透传，birthtime > endTime+5min 触发 reused', async () => {
    setupTeam('reuse-check');
    const longAgo = Date.now() - 60 * 60_000;
    const res = await buildTeamStatusResponse({ teams: [
      { name: 'reuse-check', endTime: longAgo },
    ] }, sandbox);
    assert.equal(res.statuses['reuse-check'].state, 'reused');
  });
});
