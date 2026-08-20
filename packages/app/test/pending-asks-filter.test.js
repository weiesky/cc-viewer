// 测试 /api/pending-asks 端点对 disk entry 的 filter 不变量：
//   - status === 'pending' 才暴露（answered/cancelled 占位不能渲染成 ghost ask）
//   - questions.length > 0（防御性，markAnswered orphan 路径会落 questions=[] 占位）
//   - 不在内存 Map 内（避免 memory entry 和 disk mirror 重复渲染）
//
// 端到端测试需要拉整个 server.js + WS，太重；这里走两层：
//   1) 源码层 invariant：grep server.js 的 filter 表达式确保关键 predicate 在。
//   2) 数据层：用真实 ask-store 写 pending/answered/cancelled/孤儿空 questions entry，
//      手动跑相同 filter 表达式（与 server.js:2733 一致），验证形状。
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');

const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-pending-asks-test-'));
process.env.CCV_LOG_DIR = tmpRoot;

const { loadAskStore, saveAskStore } = await import('../server/lib/ask/ask-store.js');

const storeFile = join(tmpRoot, 'ask-store.json');

function cleanup() { try { rmSync(storeFile, { force: true }); } catch {} }

// 必须与 server.js /api/pending-asks handler 中的 filter 表达式语义一致（line ~2733）。
// 改这里前请同步更新 server.js，反之亦然 —— invariant test 会守住。
function filterDiskForApi(diskAll, memIds) {
  return Object.values(diskAll)
    .filter(e => !memIds.has(e.id) && e.status === 'pending' && Array.isArray(e.questions) && e.questions.length > 0)
    .map(e => ({ id: e.id, questions: e.questions, createdAt: e.createdAt, source: 'disk' }));
}

describe('/api/pending-asks 端点 filter 不变量', () => {
  beforeEach(() => cleanup());
  after(() => { try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

  describe('源码层 invariant（防回滚）', () => {
    // /api/pending-asks handler 已迁出到 server/routes/ask-perm.js
    const src = readFileSync(resolve(repoRoot, 'packages/app/server/routes/ask-perm.js'), 'utf-8');

    it('server.js 必须有 /api/pending-asks GET handler', () => {
      assert.match(src, /\/api\/pending-asks/, 'GET /api/pending-asks 端点必须存在');
    });

    it('disk filter 必须包含 status === \'pending\' 守卫', () => {
      // status guard 防 answered/cancelled 占位被渲染成 ghost ask
      assert.match(src, /status\s*===\s*['"]pending['"]/, 'filter 必须有 status === \'pending\' 守卫');
    });

    it('disk filter 必须包含 questions.length > 0 守卫', () => {
      // 防 markAnswered orphan 创建的 questions=[] 终态占位渲染成空 ask
      assert.match(src, /questions\.length\s*>\s*0/, 'filter 必须有 questions.length > 0 守卫');
    });

    it('disk filter 必须排除内存已有的 id（memIds 去重）', () => {
      assert.match(src, /memIds\.has/, 'filter 必须用 memIds.has(...) 防重复渲染');
    });
  });

  describe('数据层 filter 行为', () => {
    it('仅返 pending entry，answered / cancelled 占位被过滤', () => {
      saveAskStore({
        a: { id: 'a', questions: [{ question: 'Qa' }], createdAt: 100, status: 'pending' },
        b: { id: 'b', questions: [{ question: 'Qb' }], createdAt: 200, status: 'answered', answers: { x: 1 }, answeredAt: 250 },
        c: { id: 'c', questions: [{ question: 'Qc' }], createdAt: 150, status: 'cancelled', cancelReason: 'abort' },
      });
      const all = loadAskStore();
      const filtered = filterDiskForApi(all, new Set());
      assert.equal(filtered.length, 1, '只暴露 pending entry');
      assert.equal(filtered[0].id, 'a');
    });

    it('过滤 questions=[] 的孤儿占位（markAnswered orphan 路径产物）', () => {
      // markAnswered 在 entry 不存在时创建 minimal record，但被 setEntry 反向保护后这里只会
      // 出现"被答案标记后保留的 questions:[]" 占位 —— 不能让它穿透到前端渲染空 ask 卡片。
      saveAskStore({
        ghost: { id: 'ghost', questions: [], createdAt: 100, status: 'pending' },
        real: { id: 'real', questions: [{ question: 'Q' }], createdAt: 200, status: 'pending' },
      });
      const filtered = filterDiskForApi(loadAskStore(), new Set());
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, 'real');
    });

    it('排除内存 Map 中已有的 id（避免重复渲染）', () => {
      saveAskStore({
        live: { id: 'live', questions: [{ question: 'Q1' }], createdAt: 100, status: 'pending' },
        diskOnly: { id: 'diskOnly', questions: [{ question: 'Q2' }], createdAt: 200, status: 'pending' },
      });
      const filtered = filterDiskForApi(loadAskStore(), new Set(['live']));
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, 'diskOnly');
      assert.equal(filtered[0].source, 'disk');
    });

    it('空 disk 时返空数组', () => {
      const filtered = filterDiskForApi(loadAskStore(), new Set());
      assert.deepEqual(filtered, []);
    });

    it('保留 createdAt 字段供前端按时间排序', () => {
      saveAskStore({
        x: { id: 'x', questions: [{ question: 'Q' }], createdAt: 12345, status: 'pending' },
      });
      const filtered = filterDiskForApi(loadAskStore(), new Set());
      assert.equal(filtered[0].createdAt, 12345);
    });
  });
});
