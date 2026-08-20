// Branch-coverage 补强：server/lib/ask/ask-store.js
// 目标分支：saveAskStore 持久化失败 catch（含 _loggedPersistError 两臂）、
// consume / consumeIfFinal / pruneStale 的 catch 兜底、loadAskStore 各防御 ternary。
//
// 隔离原则：
// - 每个 case 用私有 mkdtempSync 目录做 CCV_LOG_DIR，避免与 270+ 并发文件抢共享态。
// - "load 成功但 save 失败" 这类 catch：在【子进程】里把 LOG_DIR 设只读（chmod 0555）——
//   read 现有文件 OK，writeFileSync(tmpFile) EACCES → saveAskStore throw → 外层 catch。
//   子进程 env 必须 spread process.env（否则 NODE_V8_COVERAGE 丢失，覆盖不计入）。
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 本文件自身用的隔离 LOG_DIR —— 在 import 目标模块之前设好。
const tmpRoot = mkdtempSync(join(tmpdir(), 'ccv-branch-ask-store-'));
process.env.CCV_LOG_DIR = tmpRoot;

const storeFile = join(tmpRoot, 'ask-store.json');
const lockFile = join(tmpRoot, 'ask-store.lock');

let mod;
before(async () => {
  mod = await import('../server/lib/ask/ask-store.js');
});

function cleanup() {
  try { rmSync(storeFile, { force: true }); } catch {}
  try { rmSync(lockFile, { force: true }); } catch {}
}

// 目标源文件的绝对路径，子进程动态 import 用。
const askStorePath = fileURLToPath(new URL('../server/lib/ask/ask-store.js', import.meta.url));

// 在子进程里跑一段脚本：私有只读 LOG_DIR，让 load 成功而 save 失败。
// 返回 { status, stdout, stderr }。
function runInReadonlyLogDir(scriptBody) {
  const dir = mkdtempSync(join(tmpdir(), 'ccv-branch-ask-ro-'));
  // 预置一个合法 store 文件，让 loadAskStore 能读到一条 final entry。
  writeFileSync(join(dir, 'ask-store.json'), JSON.stringify({
    version: 1,
    entries: {
      done: {
        id: 'done', questions: [{ q: 1 }], createdAt: Date.now() - 1000,
        status: 'answered', answers: { q: 'v' }, answeredAt: Date.now(), cancelReason: null,
      },
      stalePending: {
        id: 'stalePending', questions: [{ q: 2 }],
        createdAt: 1, status: 'pending', answers: null, answeredAt: null, cancelReason: null,
      },
    },
  }));
  // 目录设只读：read 现有文件 OK，create tmp 文件 EACCES。
  chmodSync(dir, 0o555);
  const script = `
    process.env.CCV_LOG_DIR = ${JSON.stringify(dir)};
    const m = await import(${JSON.stringify(askStorePath)});
    ${scriptBody}
  `;
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, CCV_LOG_DIR: dir },
    encoding: 'utf-8',
    timeout: 60000,
  });
  // 复原权限后清理（chmod 回去否则 rmSync 删不掉）。
  try { chmodSync(dir, 0o755); } catch {}
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
  return res;
}

describe('lib/ask-store.js 分支补强', () => {
  after(() => { try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {} });

  describe('saveAskStore 持久化失败 catch（rename 到目录 → throw）', () => {
    it('store 文件是目录时 saveAskStore 抛错并清理 tmp', () => {
      cleanup();
      // 把 ask-store.json 做成目录：writeFileSync(tmpFile) 成功，但 rename 到目录失败。
      const { mkdirSync, readdirSync } = require_fs();
      mkdirSync(storeFile, { recursive: true });
      try {
        assert.throws(() => {
          mod.saveAskStore({ a: { id: 'a', questions: [{ q: 1 }], createdAt: 1 } });
        });
        // tmp- 文件不应残留（catch 里 unlinkSync）。
        const lingering = readdirSync(tmpRoot).filter(f => f.startsWith('ask-store.json.tmp-'));
        assert.equal(lingering.length, 0, `残留 tmp: ${lingering.join(',')}`);
      } finally {
        try { rmSync(storeFile, { recursive: true, force: true }); } catch {}
      }
    });

    it('第二次失败不再 warn（_loggedPersistError 两臂在子进程验证）', () => {
      // 子进程独立 _loggedPersistError，初始 false：第一次失败 warn，第二次静默。
      const dir = mkdtempSync(join(tmpdir(), 'ccv-branch-ask-warn-'));
      const { mkdirSync } = require_fs();
      mkdirSync(join(dir, 'ask-store.json'), { recursive: true }); // store 是目录 → save throw
      const script = `
        process.env.CCV_LOG_DIR = ${JSON.stringify(dir)};
        const m = await import(${JSON.stringify(askStorePath)});
        let first = 'no', second = 'no';
        try { m.saveAskStore({ a: { id:'a', questions:[{q:1}], createdAt:1 } }); } catch { first = 'threw'; }
        try { m.saveAskStore({ b: { id:'b', questions:[{q:1}], createdAt:1 } }); } catch { second = 'threw'; }
        console.log('RESULT:' + first + ',' + second);
      `;
      const res = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, CCV_LOG_DIR: dir },
        encoding: 'utf-8',
        timeout: 60000,
      });
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      assert.equal(res.status, 0, `子进程异常退出: ${res.stderr}`);
      assert.match(res.stdout, /RESULT:threw,threw/);
      // 第一次失败应有一行 warn（stderr），第二次静默 → 只出现一次。
      const warnCount = (res.stderr.match(/ask-store persistence failed/g) || []).length;
      assert.equal(warnCount, 1, `warn 应只一次（首发 warn + 后续静默），实际 ${warnCount}`);
    });
  });

  describe('catch 兜底：load 成功 / save 失败（只读 LOG_DIR 子进程）', () => {
    it('consume catch → 返回 null', () => {
      const res = runInReadonlyLogDir(`
        const r = await m.consume('done');
        console.log('OUT:' + JSON.stringify(r));
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:null/);
    });

    it('consumeIfFinal catch（final entry → 尝试 save 失败）→ 返回 null', () => {
      const res = runInReadonlyLogDir(`
        const r = await m.consumeIfFinal('done');
        console.log('OUT:' + JSON.stringify(r));
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:null/);
    });

    it('pruneStale catch → 返回 {}', () => {
      const res = runInReadonlyLogDir(`
        const r = await m.pruneStale(60_000);
        console.log('OUT:' + JSON.stringify(r));
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:\{\}/);
    });

    it('markAnswered catch（save 失败）→ 返回 false', () => {
      const res = runInReadonlyLogDir(`
        const r = await m.markAnswered('stalePending', { q: 'x' });
        console.log('OUT:' + JSON.stringify(r));
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:false/);
    });

    it('markCancelled catch（save 失败）→ 返回 false', () => {
      const res = runInReadonlyLogDir(`
        const r = await m.markCancelled('stalePending', 'r');
        console.log('OUT:' + JSON.stringify(r));
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:false/);
    });

    it('setEntry catch（save 失败）→ best-effort 静默吞错', () => {
      const res = runInReadonlyLogDir(`
        await m.setEntry('newId', { questions: [{ q: 1 }], createdAt: 5 });
        console.log('OUT:done');
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:done/);
    });

    it('deleteEntry catch（删存在的 id → save 失败被吞）', () => {
      const res = runInReadonlyLogDir(`
        await m.deleteEntry('done');
        console.log('OUT:done');
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:done/);
    });

    it('replaceAll catch（save 失败被吞）', () => {
      const res = runInReadonlyLogDir(`
        await m.replaceAll({ z: { id: 'z', questions: [{ q: 1 }], createdAt: 1 } });
        console.log('OUT:done');
      `);
      assert.equal(res.status, 0, `子进程异常: ${res.stderr}`);
      assert.match(res.stdout, /OUT:done/);
    });
  });

  describe('参数防御短路分支', () => {
    it('markAnswered: 非法 id / answers 直接返回 false（不进 withLock）', async () => {
      assert.equal(await mod.markAnswered('', { a: 1 }), false);
      assert.equal(await mod.markAnswered(123, { a: 1 }), false);
      assert.equal(await mod.markAnswered('id', null), false);
      assert.equal(await mod.markAnswered('id', 'notobj'), false);
    });

    it('markCancelled: 非法 id 返回 false', async () => {
      assert.equal(await mod.markCancelled('', 'r'), false);
      assert.equal(await mod.markCancelled(null, 'r'), false);
    });

    it('consume / consumeIfFinal: 非法 id 返回 null', async () => {
      assert.equal(await mod.consume(''), null);
      assert.equal(await mod.consume(42), null);
      assert.equal(await mod.consumeIfFinal(''), null);
      assert.equal(await mod.consumeIfFinal(undefined), null);
    });

    it('setEntry / deleteEntry: 非法 id 提前返回', async () => {
      cleanup();
      await mod.setEntry(null, { questions: [] });
      await mod.deleteEntry('');
      assert.deepEqual(mod.loadAskStore(), {});
    });

    it('markCancelled: reason 非字符串时落 ""（ternary 另一臂）', async () => {
      cleanup();
      await mod.setEntry('c1', { questions: [{ q: 1 }] });
      const wrote = await mod.markCancelled('c1', 12345);
      assert.equal(wrote, true);
      assert.equal(mod.loadAskStore().c1.cancelReason, '');
    });
  });

  describe('loadAskStore 防御 ternary 分支', () => {
    it('entries 缺省时 (data.entries || {}) 走默认空对象', async () => {
      cleanup();
      writeFileSync(storeFile, JSON.stringify({ version: 1 })); // 无 entries
      assert.deepEqual(mod.loadAskStore(), {});
    });

    it('data 不是 object（数组/标量）走 typeof 防御', async () => {
      cleanup();
      writeFileSync(storeFile, JSON.stringify([1, 2, 3]));
      assert.deepEqual(mod.loadAskStore(), {});
      writeFileSync(storeFile, JSON.stringify(42));
      assert.deepEqual(mod.loadAskStore(), {});
      writeFileSync(storeFile, 'null');
      assert.deepEqual(mod.loadAskStore(), {});
    });

    it('id 为空串 / entry 非对象的项被跳过', async () => {
      cleanup();
      writeFileSync(storeFile, JSON.stringify({
        version: 1,
        entries: {
          '': { id: '', questions: [{ q: 1 }] }, // 空 id key（实际 key 是 ''）→ 跳过
          ok: { id: 'ok', questions: [{ q: 1 }] },
          nope: 'not-an-object',
        },
      }));
      const loaded = mod.loadAskStore();
      assert.deepEqual(Object.keys(loaded), ['ok']);
    });

    it('answered entry 缺/坏 answers → answers=null（&& 短路臂）', async () => {
      cleanup();
      writeFileSync(storeFile, JSON.stringify({
        version: 1,
        entries: {
          a1: { id: 'a1', questions: [{ q: 1 }], status: 'answered', answers: null },
          a2: { id: 'a2', questions: [{ q: 1 }], status: 'answered', answers: 'str' },
          a3: { id: 'a3', questions: [{ q: 1 }], status: 'answered', answers: { ok: 1 } },
        },
      }));
      const loaded = mod.loadAskStore();
      assert.equal(loaded.a1.answers, null);
      assert.equal(loaded.a2.answers, null);
      assert.deepEqual(loaded.a3.answers, { ok: 1 });
    });

    it('cancelled entry cancelReason 非字符串 → null（ternary 另一臂）', async () => {
      cleanup();
      writeFileSync(storeFile, JSON.stringify({
        version: 1,
        entries: {
          c: { id: 'c', questions: [{ q: 1 }], status: 'cancelled', cancelReason: 999 },
        },
      }));
      assert.equal(mod.loadAskStore().c.cancelReason, null);
    });

    it('未知 status 归一为 pending；createdAt/answeredAt 兜底', async () => {
      cleanup();
      writeFileSync(storeFile, JSON.stringify({
        version: 1,
        entries: {
          x: { id: 'x', questions: [{ q: 1 }], status: 'weird', createdAt: 'NaN-ish', answeredAt: 'bad' },
        },
      }));
      const e = mod.loadAskStore().x;
      assert.equal(e.status, 'pending');
      assert.ok(Number.isFinite(e.createdAt)); // Number('NaN-ish')||Date.now()
      assert.equal(e.answeredAt, null); // Number('bad')||null
    });
  });

  describe('saveAskStore 字段归一 ternary', () => {
    it('cancelled status 时 cancelReason 缺省落 ""，answers/answeredAt 落 null', async () => {
      cleanup();
      mod.saveAskStore({
        c: { id: 'c', questions: [{ q: 1 }], status: 'cancelled' },
      });
      const e = mod.loadAskStore().c;
      assert.equal(e.status, 'cancelled');
      assert.equal(e.cancelReason, '');
      assert.equal(e.answers, null);
    });

    it('answered status 时 answers/answeredAt 缺省兜底', async () => {
      cleanup();
      mod.saveAskStore({
        a: { id: 'a', questions: [{ q: 1 }], status: 'answered' },
      });
      const e = mod.loadAskStore().a;
      assert.equal(e.status, 'answered');
      assert.equal(e.answers, null); // entry.answers || null
      assert.ok(e.answeredAt > 0); // Number(...) || Date.now()
    });

    it('save 跳过 entry===null / id 非字符串 / questions 非数组', async () => {
      cleanup();
      mod.saveAskStore({
        nul: null,
        good: { id: 'good', questions: [{ q: 1 }] },
        badq: { id: 'badq', questions: 'x' },
      });
      assert.deepEqual(Object.keys(mod.loadAskStore()), ['good']);
    });
  });
});

// require 在 ESM 里不可直接用：用 createRequire 包一层供少数 fs 操作。
import { createRequire } from 'node:module';
const _req = createRequire(import.meta.url);
function require_fs() { return _req('node:fs'); }
