// Unit tests for server/lib/log-file-utils.js — the shared leaf extracted from
// log-management.js to break the log-management.js ↔ v2/adapter.js static cycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLogFileName, parseLogTs, LIVE_SESSION_MTIME_MS } from '../packages/app/server/lib/log-file-utils.js';
import * as logManagement from '../packages/app/server/lib/log-management.js';

test('isLogFileName accepts .jsonl only', () => {
  assert.equal(isLogFileName('a.jsonl'), true);
  assert.equal(isLogFileName('12345__20260819_101112.jsonl'), true);
  assert.equal(isLogFileName('a.json'), false);
  assert.equal(isLogFileName('jsonl'), false);
});

test('parseLogTs extracts the compact timestamp from prefixed names', () => {
  // the regex anchors on a literal '_' before the 8-digit date, so a bare
  // timestamp name (no prefix) intentionally yields ''
  assert.equal(parseLogTs('c3f9__20260819_101112.jsonl'), '20260819_101112');
  assert.equal(parseLogTs('abc_20260819_101112.jsonl'), '20260819_101112');
  assert.equal(parseLogTs('20260819_101112.jsonl'), '');
  assert.equal(parseLogTs('no-timestamp.jsonl'), '');
  assert.equal(parseLogTs(''), '');
});

test('LIVE_SESSION_MTIME_MS is the 5-minute cross-process liveness window', () => {
  assert.equal(LIVE_SESSION_MTIME_MS, 5 * 60 * 1000);
});

test('log-management re-exports keep binding identity with the leaf', () => {
  assert.equal(logManagement.isLogFileName, isLogFileName);
  assert.equal(logManagement.parseLogTs, parseLogTs);
  assert.equal(logManagement.LIVE_SESSION_MTIME_MS, LIVE_SESSION_MTIME_MS);
});
