import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getExternalSession,
  writeSessionSkeleton,
  markSessionEnded,
  _resetForTest,
} from '../lib/external-session-writer.js';

describe('external-session-writer', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ext-writer-'));
    delete process.env.CCV_EXTERNAL_SESSION;
    _resetForTest();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test('env 缺失时全链路返回 null/false', () => {
    assert.equal(getExternalSession(), null);
    assert.equal(writeSessionSkeleton(), false);
    assert.equal(markSessionEnded(), false);
  });

  test('env 非法 JSON 降级', () => {
    process.env.CCV_EXTERNAL_SESSION = '{not valid json';
    assert.equal(getExternalSession(), null);
    assert.equal(writeSessionSkeleton(), false);
  });

  test('env 是数组而非对象时拒绝', () => {
    process.env.CCV_EXTERNAL_SESSION = '["sessionDir"]';
    assert.equal(getExternalSession(), null);
  });

  test('sessionDir 非绝对路径被拒绝', () => {
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({
      sessionDir: 'relative/path',
      sessionId: 's1',
    });
    assert.equal(getExternalSession(), null);
  });

  test('sessionId 缺失被拒绝', () => {
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({ sessionDir: tmpDir });
    assert.equal(getExternalSession(), null);
  });

  test('正常解析字段', () => {
    const sessionDir = join(tmpDir, 'sessions/s1');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({
      sessionDir,
      sessionId: 's1',
      role: 'worker',
      title: 'hello world',
      parentSessionId: null,
      meta: [{ label: 'X', value: 'Y', type: 'text' }],
    });
    const p = getExternalSession();
    assert.equal(p.sessionDir, sessionDir);
    assert.equal(p.sessionId, 's1');
    assert.equal(p.role, 'worker');
    assert.equal(p.title, 'hello world');
    assert.equal(p.parentSessionId, null);
    assert.equal(p.logFile, join(sessionDir, 'log.jsonl'));
    assert.equal(p.sessionJsonPath, join(sessionDir, 'session.json'));
    assert.deepEqual(p.meta, [{ label: 'X', value: 'Y', type: 'text' }]);
  });

  test('非法 meta 降级为空数组', () => {
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({
      sessionDir: tmpDir,
      sessionId: 's1',
      meta: 'not an array',
    });
    const p = getExternalSession();
    assert.deepEqual(p.meta, []);
  });

  test('writeSessionSkeleton 创建多级目录和 session.json', () => {
    const sessionDir = join(tmpDir, 'a/b/c');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({
      sessionDir,
      sessionId: 's1',
      role: 'worker',
      title: 'attempt 1',
    });
    assert.equal(writeSessionSkeleton(), true);
    assert.equal(existsSync(sessionDir), true);
    const data = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8'));
    assert.equal(data.sessionId, 's1');
    assert.equal(data.role, 'worker');
    assert.equal(data.title, 'attempt 1');
    assert.equal(data.logFile, 'log.jsonl');
    assert.equal(data.endedAt, null);
    assert.match(data.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('writeSessionSkeleton 在 session.json 已存在时保留（resume 幂等）', () => {
    const sessionDir = join(tmpDir, 's1');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({ sessionDir, sessionId: 's1', title: 'v1' });
    writeSessionSkeleton();
    const first = readFileSync(join(sessionDir, 'session.json'), 'utf-8');

    _resetForTest();
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({ sessionDir, sessionId: 's1', title: 'v2' });
    writeSessionSkeleton();
    const second = readFileSync(join(sessionDir, 'session.json'), 'utf-8');
    assert.equal(first, second, 'session.json should not be overwritten');
  });

  test('markSessionEnded 补 endedAt 和 updatedAt', () => {
    const sessionDir = join(tmpDir, 's1');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({ sessionDir, sessionId: 's1' });
    writeSessionSkeleton();
    assert.equal(markSessionEnded(), true);
    const data = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8'));
    assert.notEqual(data.endedAt, null);
    assert.match(data.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(data.updatedAt, data.endedAt);
  });

  test('markSessionEnded 幂等：重复调用保留首次 endedAt', () => {
    const sessionDir = join(tmpDir, 's1');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({ sessionDir, sessionId: 's1' });
    writeSessionSkeleton();
    markSessionEnded();
    const first = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8')).endedAt;
    markSessionEnded();
    const second = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8')).endedAt;
    assert.equal(first, second);
  });

  test('markSessionEnded 在 session.json 缺失时安全返回 false', () => {
    const sessionDir = join(tmpDir, 'nonexistent');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({ sessionDir, sessionId: 's1' });
    assert.equal(markSessionEnded(), false);
  });
});
