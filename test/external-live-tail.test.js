// Verifies the live-tail data path for CCV External Sessions Protocol:
// producer appends to log.jsonl → watchLogFile polls → sendToClients writes
// SSE-framed JSON that the frontend's EventSource.onmessage can parse.
//
// This is the end-to-end path the /api/external/events route relies on.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, unwatchFile } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watchLogFile, getWatchedFiles } from '../lib/log-watcher.js';

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

describe('external live-tail append propagation', () => {
  let tmp, logFile;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ccv-live-tail-'));
    logFile = join(tmp, 'log.jsonl');
    writeFileSync(logFile, '');
  });

  afterEach(() => {
    try { unwatchFile(logFile); } catch {}
    try { getWatchedFiles().delete(logFile); } catch {}
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test('append 后 watchLogFile 通过 SSE data 帧推送新条目', async () => {
    const captured = [];
    const fakeClient = { write: (s) => { captured.push(s); } };

    watchLogFile({
      logFile,
      clients: [fakeClient],
      getClaudePid: () => null,
      runParallelHook: () => Promise.resolve(),
      notifyStatsWorker: () => {},
      getLogFile: () => logFile,
    });

    const entry = {
      timestamp: '2026-04-17T10:00:00.000Z',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      body: { model: 'claude-opus-4-7', messages: [{ role: 'user', content: 'hi' }] },
    };
    appendFileSync(logFile, JSON.stringify(entry) + '\n---\n');

    // watchFile interval is 500ms — wait long enough to guarantee a poll cycle
    await waitMs(900);

    // 至少收到一个 data 帧（默认消息事件，格式: "data: <json>\n\n"）
    const dataFrames = captured.filter(c => c.startsWith('data: '));
    assert.ok(dataFrames.length >= 1, `expected ≥1 data frame, got ${captured.length} writes`);

    // 解析首帧，验证前端 JSON.parse(ev.data) 能还原条目
    const frame = dataFrames[0];
    assert.ok(frame.endsWith('\n\n'), 'SSE frame must end with blank line');
    const payload = frame.slice('data: '.length, -2);
    const parsed = JSON.parse(payload);
    assert.equal(parsed.timestamp, entry.timestamp);
    assert.equal(parsed.url, entry.url);
    assert.equal(parsed.method, entry.method);
    assert.equal(parsed.body?.model, 'claude-opus-4-7');
  });

  test('多次 append 的条目按顺序到达', async () => {
    const captured = [];
    const fakeClient = { write: (s) => { captured.push(s); } };

    watchLogFile({
      logFile,
      clients: [fakeClient],
      getClaudePid: () => null,
      runParallelHook: () => Promise.resolve(),
      notifyStatsWorker: () => {},
      getLogFile: () => logFile,
    });

    for (let i = 1; i <= 3; i++) {
      appendFileSync(logFile, JSON.stringify({
        timestamp: `2026-04-17T10:00:0${i}.000Z`,
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        seq: i,
      }) + '\n---\n');
      await waitMs(700);
    }

    const dataFrames = captured.filter(c => c.startsWith('data: '));
    const seqs = dataFrames.map(f => {
      try { return JSON.parse(f.slice('data: '.length, -2)).seq; } catch { return null; }
    }).filter(x => x != null);

    assert.deepEqual(seqs, [1, 2, 3]);
  });
});
