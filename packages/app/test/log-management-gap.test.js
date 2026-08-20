// log-management 覆盖补缺：补 test/log-management.test.js / delta-e2e.test.js
// 合并后仍未触达的分支。目标缺口（c8）：
//   - validateLogPath ACCESS_DENIED（symlink 逃逸到 logDir 之外）
//   - deleteLogFiles（1.7.0 软删除）：Not found / Access denied(symlink 逃逸，
//     v1 文件与 v2 会话目录两条路径) / rename 阶段抛错的 catch
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync, utimesSync, lstatSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validateLogPath, deleteLogFiles, LIVE_SESSION_MTIME_MS,
} from '../server/lib/log-management.js';

let tmpDir;
function entry(ts, url) { return JSON.stringify({ timestamp: ts, url, body: { model: 'm' } }); }
function writeLog(project, filename, lines) {
  const pd = join(tmpDir, project);
  mkdirSync(pd, { recursive: true });
  writeFileSync(join(pd, filename), lines.join('\n---\n') + '\n---\n');
  return join(pd, filename);
}

// Fixed clock: deterministic removed-<date> stamp, and far enough past any
// journal mtime that the liveness guard never trips in these fixtures.
const NOW = Date.now();
const now = () => NOW;
const stamp = (() => {
  const d = new Date(NOW);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
})();
const pidDead = () => { const e = new Error('kill ESRCH'); e.code = 'ESRCH'; throw e; };

beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'ccv-logmgmt-gap-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('validateLogPath ACCESS_DENIED', () => {
  it('throws ACCESS_DENIED when the file is a symlink escaping logDir', (t) => {
    const outside = mkdtempSync(join(tmpdir(), 'ccv-outside-'));
    const secret = join(outside, 'secret.jsonl');
    writeFileSync(secret, entry('t', 'u'));
    const pd = join(tmpDir, 'proj');
    mkdirSync(pd, { recursive: true });
    try { symlinkSync(secret, join(pd, 'link.jsonl')); }
    catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('no symlink perm'); return; } throw e; }
    assert.throws(
      () => validateLogPath(tmpDir, 'proj/link.jsonl'),
      (e) => e.code === 'ACCESS_DENIED',
    );
    rmSync(outside, { recursive: true, force: true });
  });
});

describe('deleteLogFiles error branches (soft delete, 1.7.0)', () => {
  it('reports "Not found" for a missing but well-formed log filename', () => {
    const res = deleteLogFiles(tmpDir, ['proj/ghost_20260101_000000.jsonl'], { now });
    assert.equal(res[0].error, 'Not found');
  });

  it('reports "Access denied" for a v1 symlink escaping logDir (target untouched, unmoved)', (t) => {
    const outside = mkdtempSync(join(tmpdir(), 'ccv-outside-del-'));
    const secret = join(outside, 's.jsonl');
    writeFileSync(secret, 'x');
    const pd = join(tmpDir, 'proj');
    mkdirSync(pd, { recursive: true });
    try { symlinkSync(secret, join(pd, 'l.jsonl')); }
    catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('no symlink perm'); rmSync(outside, { recursive: true, force: true }); return; } throw e; }
    const res = deleteLogFiles(tmpDir, ['proj/l.jsonl'], { now });
    assert.equal(res[0].error, 'Access denied');
    assert.equal(existsSync(secret), true, 'symlink target must NOT be deleted');
    assert.ok(lstatSync(join(pd, 'l.jsonl')).isSymbolicLink(), 'the link itself must not be moved either');
    assert.equal(existsSync(join(pd, `removed-${stamp}`)), false, 'no recycle dir created on refusal');
    rmSync(outside, { recursive: true, force: true });
  });

  it('reports "Access denied" for a v2 session dir symlinked outside logDir', (t) => {
    const outside = mkdtempSync(join(tmpdir(), 'ccv-outside-v2-'));
    const sid = 'aaaa1111-2222-4333-8444-bbbb55550009';
    const realSession = join(outside, sid);
    mkdirSync(realSession, { recursive: true });
    writeFileSync(join(realSession, 'journal.jsonl'), JSON.stringify({ ph: 'meta', wireFormat: 2 }) + '\n');
    const old = (NOW - LIVE_SESSION_MTIME_MS - 60_000) / 1000;
    utimesSync(join(realSession, 'journal.jsonl'), old, old);
    const sessionsDir = join(tmpDir, 'proj', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    try { symlinkSync(realSession, join(sessionsDir, sid)); }
    catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('no symlink perm'); rmSync(outside, { recursive: true, force: true }); return; } throw e; }
    const res = deleteLogFiles(tmpDir, [`v2:proj/${sid}`], { now, processKill: pidDead });
    assert.equal(res[0].error, 'Access denied');
    assert.equal(existsSync(join(realSession, 'journal.jsonl')), true, 'escaped target must stay put');
    rmSync(outside, { recursive: true, force: true });
  });

  it('catches a rename failure and surfaces err.message (recycle dir blocked by a file)', () => {
    // 软删除唯一的写路径是 mkdir(recycle)+rename；用同名普通文件占住回收目录，
    // mkdirSync 抛 EEXIST/ENOTDIR → catch 分支把 err.message 写进结果。
    const pd = join(tmpDir, 'proj');
    mkdirSync(pd, { recursive: true });
    writeFileSync(join(pd, 'victim_20260101_000000.jsonl'), entry('t', 'u'));
    writeFileSync(join(pd, `removed-${stamp}`), 'not a directory');
    const res = deleteLogFiles(tmpDir, ['proj/victim_20260101_000000.jsonl'], { now });
    assert.equal(res[0].ok, undefined);
    assert.ok(res[0].error, 'an error string should be reported');
    assert.equal(existsSync(join(pd, 'victim_20260101_000000.jsonl')), true, 'file untouched on failure');
  });
});
