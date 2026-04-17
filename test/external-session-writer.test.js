import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createSession,
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
      role: 'agent-a',
      title: 'hello world',
    });
    const p = getExternalSession();
    assert.equal(p.sessionDir, sessionDir);
    assert.equal(p.sessionId, 's1');
    assert.equal(p.role, 'agent-a');
    assert.equal(p.title, 'hello world');
    assert.equal(p.logFile, join(sessionDir, 'log.jsonl'));
    assert.equal(p.sessionJsonPath, join(sessionDir, 'session.json'));
  });

  test('未知字段（如 parentSessionId / meta）被忽略不影响解析', () => {
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({
      sessionDir: tmpDir,
      sessionId: 's1',
      parentSessionId: 'legacy',
      meta: [{ label: 'X' }],
      extraFoo: 42,
    });
    const p = getExternalSession();
    assert.equal(p.sessionId, 's1');
    assert.equal(p.parentSessionId, undefined);
    assert.equal(p.meta, undefined);
  });

  test('writeSessionSkeleton 创建多级目录和 session.json', () => {
    const sessionDir = join(tmpDir, 'a/b/c');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({
      sessionDir,
      sessionId: 's1',
      role: 'agent-a',
      title: 'attempt 1',
    });
    assert.equal(writeSessionSkeleton(), true);
    assert.equal(existsSync(sessionDir), true);
    const data = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8'));
    assert.equal(data.sessionId, 's1');
    assert.equal(data.role, 'agent-a');
    assert.equal(data.title, 'attempt 1');
    assert.equal(data.logFile, 'log.jsonl');
    assert.equal(data.endedAt, null);
    assert.match(data.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    // v1 协议不写 parentSessionId / meta（保留给 v2）
    assert.equal('parentSessionId' in data, false);
    assert.equal('meta' in data, false);
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

  test('markSessionEnded 补 endedAt（不再写 updatedAt）', () => {
    const sessionDir = join(tmpDir, 's1');
    process.env.CCV_EXTERNAL_SESSION = JSON.stringify({ sessionDir, sessionId: 's1' });
    writeSessionSkeleton();
    assert.equal(markSessionEnded(), true);
    const data = JSON.parse(readFileSync(join(sessionDir, 'session.json'), 'utf-8'));
    assert.notEqual(data.endedAt, null);
    assert.match(data.endedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal('updatedAt' in data, false);
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

describe('createSession (programmatic writer API)', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'ccv-ext-create-')); });
  afterEach(() => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

  test('sessionDir 非绝对路径抛错', () => {
    assert.throws(() => createSession({ sessionDir: 'relative', sessionId: 's1' }),
      /sessionDir must be an absolute path/);
  });

  test('sessionId 缺失抛错', () => {
    assert.throws(() => createSession({ sessionDir: tmpDir }),
      /sessionId is required/);
  });

  test('正常创建 + 返回 helpers', () => {
    const sessionDir = join(tmpDir, 'sess-a');
    const s = createSession({ sessionDir, sessionId: 'sess-a', role: 'agent-x', title: 'probe' });
    assert.equal(s.sessionDir, sessionDir);
    assert.equal(s.logFile, join(sessionDir, 'log.jsonl'));
    assert.equal(s.sessionJsonPath, join(sessionDir, 'session.json'));
    assert.equal(typeof s.appendEntry, 'function');
    assert.equal(typeof s.markEnded, 'function');

    const skeleton = JSON.parse(readFileSync(s.sessionJsonPath, 'utf-8'));
    assert.equal(skeleton.sessionId, 'sess-a');
    assert.equal(skeleton.role, 'agent-x');
    assert.equal(skeleton.title, 'probe');
    assert.equal(skeleton.logFile, 'log.jsonl');
    assert.equal(skeleton.endedAt, null);
    assert.match(skeleton.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    // 精简后 skeleton 不再含 updatedAt
    assert.equal('updatedAt' in skeleton, false);
  });

  test('幂等：二次 createSession 保留原 startedAt', () => {
    const sessionDir = join(tmpDir, 'sess-b');
    const s1 = createSession({ sessionDir, sessionId: 'sess-b' });
    const startedAt1 = JSON.parse(readFileSync(s1.sessionJsonPath, 'utf-8')).startedAt;
    // 小等一下再重入，确保 ISO timestamp 会不同
    const s2 = createSession({ sessionDir, sessionId: 'sess-b', title: 'changed' });
    const json2 = JSON.parse(readFileSync(s2.sessionJsonPath, 'utf-8'));
    assert.equal(json2.startedAt, startedAt1, 'startedAt 不应该被二次 createSession 覆盖');
    // 并且 title 等字段也保留第一次的值（skeleton 未被重写）
    assert.notEqual(json2.title, 'changed');
  });

  test('appendEntry 按 \\n---\\n 分隔写入单行 JSON', () => {
    const sessionDir = join(tmpDir, 'sess-c');
    const s = createSession({ sessionDir, sessionId: 'sess-c' });
    s.appendEntry({ timestamp: 't1', url: 'u1', method: 'POST', body: { a: 1 } });
    s.appendEntry({ timestamp: 't2', url: 'u2', method: 'POST' });
    const raw = readFileSync(s.logFile, 'utf-8');
    const parts = raw.split('\n---\n').filter(Boolean);
    assert.equal(parts.length, 2);
    assert.equal(JSON.parse(parts[0]).timestamp, 't1');
    assert.equal(JSON.parse(parts[1]).url, 'u2');
    // 每个 part 必须是单行（协议要求）
    for (const p of parts) assert.equal(p.includes('\n'), false);
  });

  test('appendEntry 非对象参数抛错', () => {
    const s = createSession({ sessionDir: join(tmpDir, 'sess-d'), sessionId: 'sess-d' });
    assert.throws(() => s.appendEntry(null), /entry must be an object/);
    assert.throws(() => s.appendEntry('string'), /entry must be an object/);
  });

  test('markEnded 补 endedAt 且幂等', () => {
    const s = createSession({ sessionDir: join(tmpDir, 'sess-e'), sessionId: 'sess-e' });
    assert.equal(s.markEnded(), true);
    const first = JSON.parse(readFileSync(s.sessionJsonPath, 'utf-8')).endedAt;
    assert.match(first, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(s.markEnded(), true);
    const second = JSON.parse(readFileSync(s.sessionJsonPath, 'utf-8')).endedAt;
    assert.equal(second, first);
  });
});
