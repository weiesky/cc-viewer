import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import {
  expandHome,
  parseRootsEnv,
  loadRoots,
  scanProviders,
  listScopes,
  listSessions,
  resolveLogFile,
  PROTOCOL_VERSION,
  SLUG_RE,
} from '../lib/external-sessions.js';

function writeProviderLayout(root, providerId, {
  protocolVersion = PROTOCOL_VERSION,
  scopes = [],
} = {}) {
  const providerDir = join(root, providerId);
  mkdirSync(providerDir, { recursive: true });
  writeFileSync(
    join(providerDir, 'index.json'),
    JSON.stringify({ protocolVersion, providerId, providerName: providerId })
  );
  for (const scope of scopes) {
    const scopeDir = join(providerDir, 'scopes', scope.id);
    mkdirSync(scopeDir, { recursive: true });
    writeFileSync(
      join(scopeDir, 'scope.json'),
      JSON.stringify({ scopeId: scope.id, title: scope.title || scope.id, kind: scope.kind || 'work-item' })
    );
    for (const sess of scope.sessions || []) {
      const sDir = join(scopeDir, 'sessions', sess.id);
      mkdirSync(sDir, { recursive: true });
      writeFileSync(
        join(sDir, 'session.json'),
        JSON.stringify({
          sessionId: sess.id,
          title: sess.title || sess.id,
          role: sess.role || 'worker',
          logFile: sess.logFile || 'log.jsonl',
          startedAt: sess.startedAt,
          endedAt: sess.endedAt || null,
        })
      );
      writeFileSync(join(sDir, sess.logFile || 'log.jsonl'), '');
    }
  }
}

describe('external-sessions', () => {
  let tmp;

  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'ccv-ext-reader-')); });
  afterEach(() => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

  test('expandHome 展开 ~ 与 $HOME', () => {
    assert.equal(expandHome('~'), homedir());
    assert.equal(expandHome('~/foo'), join(homedir(), 'foo'));
    assert.equal(expandHome('$HOME/bar'), join(homedir(), 'bar'));
    assert.equal(expandHome('/abs/path'), '/abs/path');
  });

  test('parseRootsEnv 只保留绝对路径', () => {
    const result = parseRootsEnv('/abs/1, /abs/2 ,relative, ');
    assert.deepEqual(result, ['/abs/1', '/abs/2']);
  });

  test('parseRootsEnv 处理空值', () => {
    assert.deepEqual(parseRootsEnv(''), []);
    assert.deepEqual(parseRootsEnv(undefined), []);
  });

  test('loadRoots 只认 env 并去重', () => {
    const roots = loadRoots({ envValue: '/a,/b,/a,/c' });
    assert.deepEqual(roots.map(r => r.path), ['/a', '/b', '/c']);
    assert.deepEqual(roots.map(r => r.index), [0, 1, 2]);
  });

  test('scanProviders 忽略缺 index.json 的目录', () => {
    mkdirSync(join(tmp, 'empty'), { recursive: true });
    writeProviderLayout(tmp, 'lia');
    const providers = scanProviders(tmp);
    assert.equal(providers.length, 1);
    assert.equal(providers[0].providerId, 'lia');
  });

  test('scanProviders 拒绝 protocolVersion 不匹配', () => {
    writeProviderLayout(tmp, 'oldproto', { protocolVersion: 99 });
    assert.equal(scanProviders(tmp).length, 0);
  });

  test('scanProviders 忽略非法 slug 目录名', () => {
    mkdirSync(join(tmp, 'UPPERCASE'), { recursive: true });
    writeFileSync(join(tmp, 'UPPERCASE', 'index.json'), JSON.stringify({ protocolVersion: 1, providerId: 'x' }));
    assert.equal(scanProviders(tmp).length, 0);
  });

  test('scanProviders 不存在的 root 返回空', () => {
    assert.deepEqual(scanProviders('/nonexistent/path'), []);
    assert.deepEqual(scanProviders('relative'), []);
  });

  test('listScopes 与 listSessions 完整流程', () => {
    writeProviderLayout(tmp, 'lia', {
      scopes: [
        {
          id: 'wi-lia-150',
          title: '实现集成',
          sessions: [
            { id: 'worker-20260415-140000', startedAt: '2026-04-15T14:00:00Z' },
            { id: 'worker-20260415-150000', startedAt: '2026-04-15T15:00:00Z' },
          ],
        },
      ],
    });
    const scopes = listScopes(tmp, 'lia');
    assert.equal(scopes.length, 1);
    assert.equal(scopes[0].title, '实现集成');

    const sessions = listSessions(tmp, 'lia', 'wi-lia-150');
    assert.equal(sessions.length, 2);
    // 最新 startedAt 排第一
    assert.equal(sessions[0].sessionId, 'worker-20260415-150000');
  });

  test('listSessions 在 session.json 缺失时降级返回目录名', () => {
    const provDir = join(tmp, 'lia');
    mkdirSync(provDir, { recursive: true });
    writeFileSync(join(provDir, 'index.json'), JSON.stringify({ protocolVersion: 1, providerId: 'lia' }));
    const sDir = join(provDir, 'scopes', 'wi-1', 'sessions', 'orphan-session');
    mkdirSync(sDir, { recursive: true });
    // 没写 session.json
    const sessions = listSessions(tmp, 'lia', 'wi-1');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, 'orphan-session');
    assert.equal(sessions[0].role, 'unknown');
  });

  test('resolveLogFile 返回绝对路径', () => {
    writeProviderLayout(tmp, 'lia', {
      scopes: [{ id: 'wi-1', sessions: [{ id: 'sess-1' }] }],
    });
    const path = resolveLogFile(tmp, 'lia', 'wi-1', 'sess-1');
    assert.ok(path && path.startsWith(tmp));
    assert.ok(path.endsWith('log.jsonl'));
  });

  test('resolveLogFile 拒绝非法 slug', () => {
    assert.equal(resolveLogFile(tmp, '../etc', 'x', 'y'), null);
    assert.equal(resolveLogFile(tmp, 'lia', '..', 'y'), null);
    assert.equal(resolveLogFile(tmp, 'lia', 'x', 'SECRET'), null);
  });

  test('resolveLogFile 拒绝 session.json 里 logFile 为绝对路径或含 ..', () => {
    writeProviderLayout(tmp, 'lia', { scopes: [{ id: 'wi-1', sessions: [{ id: 'sess-1' }] }] });
    const jsonPath = join(tmp, 'lia', 'scopes', 'wi-1', 'sessions', 'sess-1', 'session.json');
    writeFileSync(jsonPath, JSON.stringify({ logFile: '/etc/passwd' }));
    assert.equal(resolveLogFile(tmp, 'lia', 'wi-1', 'sess-1'), null);

    writeFileSync(jsonPath, JSON.stringify({ logFile: '../../../etc/passwd' }));
    assert.equal(resolveLogFile(tmp, 'lia', 'wi-1', 'sess-1'), null);
  });

  test('resolveLogFile 拒绝不存在的 logFile', () => {
    writeProviderLayout(tmp, 'lia', { scopes: [{ id: 'wi-1', sessions: [{ id: 'sess-1', logFile: 'missing.jsonl' }] }] });
    // logFile 写的是 missing.jsonl，但 writeProviderLayout 创建的是该文件——其实被创建了
    // 这里直接删掉
    rmSync(join(tmp, 'lia', 'scopes', 'wi-1', 'sessions', 'sess-1', 'missing.jsonl'));
    assert.equal(resolveLogFile(tmp, 'lia', 'wi-1', 'sess-1'), null);
  });

  test('SLUG_RE 校验合法格式', () => {
    assert.ok(SLUG_RE.test('lia'));
    assert.ok(SLUG_RE.test('wi-lia-150'));
    assert.ok(SLUG_RE.test('worker-20260415-143022'));
    assert.ok(!SLUG_RE.test('UPPER'));
    assert.ok(!SLUG_RE.test('.hidden'));
    assert.ok(!SLUG_RE.test('has/slash'));
    assert.ok(!SLUG_RE.test(''));
  });
});
