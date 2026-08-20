import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全 — 禁止改回静态 import(2026-06-06 事故) ████
// LOG_DIR/CACHE_DIR 等在 findcc.js / server/lib 模块【加载时】即从 env 派生。
// ESM 静态 import 会被提升到本文件任何语句之前执行,所以「先设 env 再静态 import」无效。
// 必须:① node 内置模块静态 import;② 隔离段设 env;③ 项目模块用顶层 await 动态 import。
// 改回静态 import findcc/server 会让本文件单跑(无外部 CCV_LOG_DIR)时落到真实 ~/.claude。
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-imsenders-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { LOG_DIR } = await import('../findcc.js');
const { imDir } = await import('../server/lib/im/im-lock.js');
const { readSenders, upsertSender, MAX_SENDERS } = await import('../server/lib/im/im-senders.js');

let n = 0;
function freshId() { return `test_senders_${process.pid}_${n++}`; }
function wipe(id) { try { rmSync(imDir(id), { recursive: true, force: true }); } catch { /* noop */ } }

describe('im-senders', () => {
  beforeEach(() => { mkdirSync(LOG_DIR, { recursive: true }); });

  it('readSenders returns {} when file is absent', () => {
    const id = freshId(); wipe(id);
    assert.deepEqual(readSenders(id), {});
  });

  it('upsert writes a sender and readSenders returns it', () => {
    const id = freshId(); wipe(id);
    assert.equal(upsertSender(id, 'u1', { name: 'Alice', avatar: 'https://a/1.png' }), true);
    const map = readSenders(id);
    assert.equal(map.u1.name, 'Alice');
    assert.equal(map.u1.avatar, 'https://a/1.png');
    assert.ok(typeof map.u1.ts === 'number');
    wipe(id);
  });

  it('merges multiple senders and accepts name-only (no avatar)', () => {
    const id = freshId(); wipe(id);
    upsertSender(id, 'u1', { name: 'Alice', avatar: 'https://a/1.png' });
    upsertSender(id, 'u2', { name: 'Bob' });
    const map = readSenders(id);
    assert.equal(Object.keys(map).length, 2);
    assert.equal(map.u2.name, 'Bob');
    assert.equal(map.u2.avatar, null);
    wipe(id);
  });

  it('skips the write when nothing changed (returns false)', () => {
    const id = freshId(); wipe(id);
    assert.equal(upsertSender(id, 'u1', { name: 'Alice', avatar: 'x' }), true);
    assert.equal(upsertSender(id, 'u1', { name: 'Alice', avatar: 'x' }), false);
    wipe(id);
  });

  it('updates an existing sender when name/avatar change', () => {
    const id = freshId(); wipe(id);
    upsertSender(id, 'u1', { name: 'Alice' });
    assert.equal(upsertSender(id, 'u1', { name: 'Alice Q', avatar: 'https://a/2.png' }), true);
    assert.equal(readSenders(id).u1.name, 'Alice Q');
    wipe(id);
  });

  it('ignores empty/invalid senderId', () => {
    const id = freshId(); wipe(id);
    assert.equal(upsertSender(id, '', { name: 'x' }), false);
    assert.equal(upsertSender(id, null, { name: 'x' }), false);
    assert.deepEqual(readSenders(id), {});
    wipe(id);
  });

  it('tolerates corrupt JSON → {} (and can overwrite)', () => {
    const id = freshId(); wipe(id);
    mkdirSync(imDir(id), { recursive: true });
    writeFileSync(join(imDir(id), 'im-senders.json'), '{ this is not json');
    assert.deepEqual(readSenders(id), {});
    assert.equal(upsertSender(id, 'u1', { name: 'Alice' }), true);
    assert.equal(readSenders(id).u1.name, 'Alice');
    wipe(id);
  });

  it('caps the map at MAX_SENDERS, dropping the oldest', () => {
    const id = freshId(); wipe(id);
    for (let i = 0; i < MAX_SENDERS + 10; i++) upsertSender(id, `u${i}`, { name: `n${i}` });
    const map = readSenders(id);
    assert.equal(Object.keys(map).length, MAX_SENDERS);
    // earliest ids should have been evicted
    assert.equal('u0' in map, false);
    assert.equal(`u${MAX_SENDERS + 9}` in map, true);
    wipe(id);
  });

  it('write failure → cleans up temp and returns false (im-senders.js:37-39 + 68-69)', () => {
    // 把目标 im-senders.json 路径占成一个非空目录 → renameSyncWithRetry(tmp, target) 抛错。
    // writeSenders catch 删除 temp 并 rethrow；upsertSender catch 吞掉返回 false（持久化失败不致命）。
    const id = freshId(); wipe(id);
    const dir = imDir(id);
    mkdirSync(dir, { recursive: true });
    const targetAsDir = join(dir, 'im-senders.json');
    mkdirSync(targetAsDir, { recursive: true });
    // 让该目录非空，确保 rename 覆盖必失败（ENOTEMPTY），而非被当成空目录替换。
    writeFileSync(join(targetAsDir, 'keep'), 'x');

    assert.equal(upsertSender(id, 'u1', { name: 'Alice' }), false, '写盘失败时 upsert 应返回 false');
    // 目标仍是原来的目录（未被破坏），且没有遗留 .tmp 文件（catch 已 unlink）。
    const leftover = (() => { try { return readdirSync(dir); } catch { return []; } })();
    assert.ok(!leftover.some((f) => f.startsWith('im-senders.json.tmp-')), '失败后不应遗留 temp 文件');
    wipe(id);
  });
});
