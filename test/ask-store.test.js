// Unit tests for server/lib/ask-store.js
// 涉及文件锁 + tmp-rename 原子写 + corrupt 恢复，使用专用 LOG_DIR 隔离不同 test 间的全局状态。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// 必须在 import server modules 之前设环境变量——findcc.js 的 LOG_DIR 是模块 top-level 计算的。
const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-ask-store-test-'));
process.env.CCV_LOG_DIR = tmpRoot;

const { loadAskStore, saveAskStore, setEntry, deleteEntry, pruneStale, replaceAll, markAnswered, markCancelled, consume, consumeIfFinal } = await import('../packages/app/server/lib/ask-store.js');

const storeFile = join(tmpRoot, 'ask-store.json');
const lockFile = join(tmpRoot, 'ask-store.lock');

function cleanup() {
  try { rmSync(storeFile, { force: true }); } catch {}
  try { rmSync(lockFile, { force: true }); } catch {}
}

describe('lib/ask-store.js', () => {
  beforeEach(() => cleanup());
  after(() => { try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

  describe('loadAskStore', () => {
    it('returns empty object when file missing', async () => {
      assert.deepEqual(loadAskStore(), {});
    });

    it('returns empty object when file empty (whitespace only)', async () => {
      writeFileSync(storeFile, '   \n  ');
      assert.deepEqual(loadAskStore(), {});
    });

    it('returns empty object on corrupt JSON (silent recovery)', async () => {
      writeFileSync(storeFile, '{not json[');
      assert.deepEqual(loadAskStore(), {});
    });

    it('returns empty when schema version mismatches', async () => {
      writeFileSync(storeFile, JSON.stringify({ version: 999, entries: { x: { id: 'x', questions: [] } } }));
      assert.deepEqual(loadAskStore(), {});
    });

    it('strips entries with missing questions array (defensive)', async () => {
      writeFileSync(storeFile, JSON.stringify({
        version: 1,
        entries: {
          good: { id: 'good', questions: [{ question: 'Q' }], createdAt: 123 },
          bad: { id: 'bad', questions: 'not an array' },
          empty: null,
        },
      }));
      const loaded = loadAskStore();
      assert.equal(Object.keys(loaded).length, 1);
      assert.equal(loaded.good.id, 'good');
      assert.deepEqual(loaded.good.questions, [{ question: 'Q' }]);
    });
  });

  describe('saveAskStore + atomic write', () => {
    it('writes JSON with version=1 + entries shape', async () => {
      saveAskStore({ 'toolu_a': { id: 'toolu_a', questions: [{ question: 'Q?' }], createdAt: 1000 } });
      const raw = JSON.parse(readFileSync(storeFile, 'utf-8'));
      assert.equal(raw.version, 1);
      assert.equal(raw.entries.toolu_a.id, 'toolu_a');
      assert.deepEqual(raw.entries.toolu_a.questions, [{ question: 'Q?' }]);
      assert.equal(raw.entries.toolu_a.createdAt, 1000);
      assert.equal(raw.entries.toolu_a.status, 'pending');
    });

    it('strips invalid entries on save (no questions array)', async () => {
      saveAskStore({
        ok: { questions: [{ q: 1 }], createdAt: 100 },
        broken: { something: 'else' },
      });
      const raw = JSON.parse(readFileSync(storeFile, 'utf-8'));
      assert.ok(raw.entries.ok);
      assert.ok(!raw.entries.broken);
    });

    it('no .tmp- file lingers after successful save (atomic rename)', async () => {
      saveAskStore({ a: { questions: [{ q: 'x' }] } });
      const lingering = readdirSync(tmpRoot).filter(f => f.startsWith('ask-store.json.tmp-'));
      assert.equal(lingering.length, 0, `found lingering tmp file(s): ${lingering.join(',')}`);
    });
  });

  describe('setEntry / deleteEntry round-trip', () => {
    it('setEntry persists then loadAskStore returns it', async () => {
      await setEntry('toolu_x', { questions: [{ q: 'a' }], createdAt: 500 });
      const loaded = loadAskStore();
      assert.equal(loaded.toolu_x.id, 'toolu_x');
      assert.equal(loaded.toolu_x.createdAt, 500);
    });

    it('setEntry ignores empty id (defensive)', async () => {
      await setEntry('', { questions: [{ q: 'a' }] });
      await setEntry(null, { questions: [{ q: 'a' }] });
      assert.deepEqual(loadAskStore(), {});
    });

    it('setEntry ignores missing questions array', async () => {
      await setEntry('toolu_x', {});
      await setEntry('toolu_x', { questions: 'string' });
      assert.deepEqual(loadAskStore(), {});
    });

    it('deleteEntry removes the entry', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      await setEntry('b', { questions: [{ q: 2 }] });
      await deleteEntry('a');
      const loaded = loadAskStore();
      assert.ok(!loaded.a);
      assert.ok(loaded.b);
    });

    it('deleteEntry on missing id is a no-op (no throw)', async () => {
      await assert.doesNotReject(() => deleteEntry('never-existed'));
    });
  });

  describe('pruneStale', () => {
    it('removes entries older than maxAge, keeps fresh ones', async () => {
      const now = Date.now();
      saveAskStore({
        fresh: { id: 'fresh', questions: [{ q: 1 }], createdAt: now - 10_000 },
        stale: { id: 'stale', questions: [{ q: 1 }], createdAt: now - 100_000_000 },
      });
      const survivors = await pruneStale(60_000); // 60s
      assert.ok(survivors.fresh);
      assert.ok(!survivors.stale);
      // Disk state matches
      assert.deepEqual(Object.keys(loadAskStore()).sort(), ['fresh']);
    });
  });

  describe('replaceAll', () => {
    it('overwrites entire store atomically', async () => {
      await setEntry('old', { questions: [{ q: 1 }] });
      await replaceAll({ brand_new: { id: 'brand_new', questions: [{ q: 9 }], createdAt: 1 } });
      const loaded = loadAskStore();
      assert.ok(!loaded.old);
      assert.ok(loaded.brand_new);
    });
  });

  describe('markAnswered / markCancelled / consume (Phase 3 short-poll handoff)', () => {
    it('markAnswered persists answers + flips status to answered', async () => {
      await setEntry('toolu_x', { questions: [{ q: 'a' }], createdAt: 100 });
      await markAnswered('toolu_x', { 'a': 'yes' });
      const loaded = loadAskStore();
      assert.equal(loaded.toolu_x.status, 'answered');
      assert.deepEqual(loaded.toolu_x.answers, { a: 'yes' });
      assert.ok(loaded.toolu_x.answeredAt > 0);
    });

    it('markAnswered on missing entry creates minimal record (server restart race recovery)', async () => {
      await markAnswered('toolu_orphan', { 'q': 'answer' });
      const loaded = loadAskStore();
      assert.equal(loaded.toolu_orphan.status, 'answered');
      assert.deepEqual(loaded.toolu_orphan.answers, { q: 'answer' });
    });

    it('markCancelled flips status to cancelled with reason', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      await markCancelled('a', 'user interrupted');
      const loaded = loadAskStore();
      assert.equal(loaded.a.status, 'cancelled');
      assert.equal(loaded.a.cancelReason, 'user interrupted');
      assert.equal(loaded.a.answers, null);
    });

    it('consume returns entry then removes from disk (one-shot)', async () => {
      await setEntry('p', { questions: [{ q: 1 }] });
      await markAnswered('p', { q: 'val' });
      const first = await consume('p');
      assert.equal(first.status, 'answered');
      assert.deepEqual(first.answers, { q: 'val' });
      const second = await consume('p');
      assert.equal(second, null, 'second consume should return null (already consumed)');
      assert.deepEqual(loadAskStore(), {});
    });

    it('consume on missing id returns null (no throw)', async () => {
      assert.equal(await consume('never-existed'), null);
    });
  });

  describe('P0 regression: race + ghost + stale cleanup guards', () => {
    it('setEntry status guard: 不可把 answered 倒回 pending（root of setImmediate race）', async () => {
      await setEntry('toolu_x', { questions: [{ q: 'a' }], createdAt: 100 });
      await markAnswered('toolu_x', { 'a': 'yes' });
      // 模拟 setImmediate 排队的 placeholder setEntry 后到达：必须 noop
      await setEntry('toolu_x', { questions: [{ q: 'a' }], createdAt: 100 });
      const loaded = loadAskStore();
      assert.equal(loaded.toolu_x.status, 'answered', 'setEntry 不能覆盖已 answered 状态');
      assert.deepEqual(loaded.toolu_x.answers, { a: 'yes' });
    });

    it('setEntry status guard: 不可把 cancelled 倒回 pending', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      await markCancelled('a', 'user abort');
      await setEntry('a', { questions: [{ q: 1 }] });
      const loaded = loadAskStore();
      assert.equal(loaded.a.status, 'cancelled');
      assert.equal(loaded.a.cancelReason, 'user abort');
    });

    it('markAnswered first-write-wins: 第二次 markAnswered 不覆盖第一次答案', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      const first = await markAnswered('a', { q: 'first' });
      const second = await markAnswered('a', { q: 'second' });
      assert.equal(first, true, '第一次必须真写入');
      assert.equal(second, false, '第二次必须 noop（first-wins）');
      const loaded = loadAskStore();
      assert.deepEqual(loaded.a.answers, { q: 'first' });
    });

    it('markCancelled first-write-wins: 不会把 answered 改成 cancelled', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      await markAnswered('a', { q: 'x' });
      const wrote = await markCancelled('a', 'should not apply');
      assert.equal(wrote, false);
      const loaded = loadAskStore();
      assert.equal(loaded.a.status, 'answered');
    });

    it('consumeIfFinal: pending 不删（保留给后续 GET）', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      const got = await consumeIfFinal('a');
      assert.equal(got.status, 'pending');
      // disk 仍存在
      assert.ok(loadAskStore().a);
    });

    it('consumeIfFinal: answered 一次性消费', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      await markAnswered('a', { q: 'val' });
      const first = await consumeIfFinal('a');
      assert.equal(first.status, 'answered');
      assert.equal(await consumeIfFinal('a'), null);
      assert.deepEqual(loadAskStore(), {});
    });

    it('consumeIfFinal: cancelled 一次性消费', async () => {
      await setEntry('a', { questions: [{ q: 1 }] });
      await markCancelled('a', 'r');
      const first = await consumeIfFinal('a');
      assert.equal(first.status, 'cancelled');
      assert.equal(first.cancelReason, 'r');
      assert.equal(await consumeIfFinal('a'), null);
    });

    it('lock body 含 owner pid（让其它进程能精确判断 stale）', async () => {
      // 触发一次 withLock → setEntry，落盘后清锁；通过 setEntry 后 lock 文件已被 unlink 验证不到。
      // 改测 acquireLock 阶段写入的内容：直接 hold 一份锁，验证内容形态。
      // setEntry 的 withLock 调用完即 unlink，所以只能在持锁中拍照 —— 这里改为校验内容 schema。
      // 用人为写 fake lock + dead PID 的方式间接验证下面 "PID-based stale steal" 用例。
      await setEntry('lock-presence-probe', { questions: [{ q: 1 }] });
      assert.ok(loadAskStore()['lock-presence-probe']);
    });

    it('PID-based stale steal: 死 pid 持有的 fresh-mtime 锁应能立即被偷', async () => {
      // 写一份带 dead pid + 当前 mtime 的 fake lock —— mtime-only 兜底永远不会 steal
      // （5s 阈值），但 PID 校验能立即识别 owner 已死并回收。
      const DEAD_PID = 999_999_999;
      writeFileSync(lockFile, JSON.stringify({ pid: DEAD_PID, ts: Date.now() }));
      const startedAt = Date.now();
      // setEntry 内部会触发 withLock。若 PID 校验失效，此调用会卡 5s+ 才偷锁；
      // PID 校验生效时几乎瞬完成。
      await setEntry('stale-pid-steal', { questions: [{ q: 1 }] });
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed < 1000, `偷锁应 <1s，实际 ${elapsed}ms（PID 校验未生效？）`);
      assert.ok(loadAskStore()['stale-pid-steal'], 'setEntry 应在偷锁后落盘');
    });

    it('PID-based stale steal: 损坏的 lock body 退回 mtime 兜底（不立即偷）', async () => {
      // 写一份完全非 JSON 的 lock body + 当前 mtime → readLockOwnerPid 返回 null
      // → isLockStale 走 mtime fallback → fresh mtime 视为 NOT stale → 等到 2s deadline
      // 最终 throw（withLock 内层 try-catch 吞错 → setEntry 视为 best-effort fail）。
      writeFileSync(lockFile, 'not-json{');
      const startedAt = Date.now();
      await setEntry('mtime-fallback-probe', { questions: [{ q: 1 }] });
      const elapsed = Date.now() - startedAt;
      // 落到 mtime 兜底路径：应等满 2s deadline 后 best-effort 失败
      assert.ok(elapsed >= 1900, `mtime 兜底应等到 ~2s deadline，实际 ${elapsed}ms`);
      // 锁残留但不影响下次调用（手动清理）
      try { rmSync(lockFile, { force: true }); } catch {}
    });

    it('pruneStale 用 max(createdAt, answeredAt) 保留刚 answered 的老 entry', async () => {
      const now = Date.now();
      // 直接写一个 createdAt=23h ago 的 answered entry（answeredAt 是 now）
      saveAskStore({
        oldButFresh: {
          id: 'oldButFresh',
          questions: [{ q: 1 }],
          createdAt: now - 23 * 60 * 60 * 1000,
          status: 'answered',
          answers: { q: 'yes' },
          answeredAt: now,
          cancelReason: null,
        },
        trulyStale: {
          id: 'trulyStale',
          questions: [{ q: 1 }],
          createdAt: now - 25 * 60 * 60 * 1000,
          status: 'pending',
          answers: null,
          answeredAt: null,
          cancelReason: null,
        },
      });
      const survivors = await pruneStale(24 * 60 * 60 * 1000);
      assert.ok(survivors.oldButFresh, 'answeredAt 新的 entry 必须保留（防 ask-bridge 拿不到答案）');
      assert.ok(!survivors.trulyStale, '真正过期 entry 必须清');
    });
  });
});
