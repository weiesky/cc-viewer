import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLogFile, sendToClients } from '../lib/log-watcher.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `ccv-logwatch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('readLogFile', () => {
  let dir;

  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns empty array for nonexistent file', () => {
    const result = readLogFile(join(dir, 'nope.jsonl'));
    assert.deepStrictEqual(result, []);
  });

  it('parses single entry', () => {
    const file = join(dir, 'log.jsonl');
    writeFileSync(file, JSON.stringify({ timestamp: 1, url: '/a', data: 'hello' }));
    const result = readLogFile(file);
    assert.equal(result.length, 1);
    assert.equal(result[0].data, 'hello');
  });

  it('parses multiple entries separated by \\n---\\n', () => {
    const file = join(dir, 'log.jsonl');
    const entries = [
      JSON.stringify({ timestamp: 1, url: '/a' }),
      JSON.stringify({ timestamp: 2, url: '/b' }),
      JSON.stringify({ timestamp: 3, url: '/c' }),
    ];
    writeFileSync(file, entries.join('\n---\n'));
    const result = readLogFile(file);
    assert.equal(result.length, 3);
  });

  it('filters out invalid JSON entries', () => {
    const file = join(dir, 'log.jsonl');
    const content = [
      JSON.stringify({ timestamp: 1, url: '/a' }),
      'not valid json {{{',
      JSON.stringify({ timestamp: 2, url: '/b' }),
    ].join('\n---\n');
    writeFileSync(file, content);
    const result = readLogFile(file);
    assert.equal(result.length, 2);
  });

  it('deduplicates by timestamp|url, later entry wins', () => {
    const file = join(dir, 'log.jsonl');
    const content = [
      JSON.stringify({ timestamp: 1, url: '/a', phase: 'request' }),
      JSON.stringify({ timestamp: 1, url: '/a', phase: 'response' }),
    ].join('\n---\n');
    writeFileSync(file, content);
    const result = readLogFile(file);
    assert.equal(result.length, 1);
    assert.equal(result[0].phase, 'response');
  });

  it('keeps entries with different timestamp|url keys', () => {
    const file = join(dir, 'log.jsonl');
    const content = [
      JSON.stringify({ timestamp: 1, url: '/a' }),
      JSON.stringify({ timestamp: 1, url: '/b' }),
      JSON.stringify({ timestamp: 2, url: '/a' }),
    ].join('\n---\n');
    writeFileSync(file, content);
    const result = readLogFile(file);
    assert.equal(result.length, 3);
  });

  it('returns empty array for empty file', () => {
    const file = join(dir, 'log.jsonl');
    writeFileSync(file, '');
    const result = readLogFile(file);
    assert.deepStrictEqual(result, []);
  });

  it('handles file with only whitespace', () => {
    const file = join(dir, 'log.jsonl');
    writeFileSync(file, '   \n  \n  ');
    const result = readLogFile(file);
    assert.deepStrictEqual(result, []);
  });
});

describe('sendToClients', () => {
  it('writes SSE formatted data to all clients', () => {
    const written = [];
    const clients = [
      { write: (data) => written.push(data) },
      { write: (data) => written.push(data) },
    ];
    const entry = { timestamp: 1, url: '/test' };
    sendToClients(clients, entry);
    assert.equal(written.length, 2);
    assert.equal(written[0], `data: ${JSON.stringify(entry)}\n\n`);
    assert.equal(written[1], `data: ${JSON.stringify(entry)}\n\n`);
  });

  it('handles client write errors gracefully', () => {
    const written = [];
    const clients = [
      { write: () => { throw new Error('disconnected'); } },
      { write: (data) => written.push(data) },
    ];
    // Should not throw
    sendToClients(clients, { timestamp: 1, url: '/test' });
    assert.equal(written.length, 1);
  });

  it('handles empty clients array', () => {
    // Should not throw
    sendToClients([], { timestamp: 1, url: '/test' });
  });
});
