// ████ 文件内显式隔离(同 workspace-registry.test.js 的六层闸)████
// LOG_DIR 在 findcc 模块加载时即固化;必须先 mkdtemp + 写 env,再动态 import 项目模块。
import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, unlinkSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirSizeSync, dirSizeAsync } from '../server/lib/v2/layout.js';

const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-wsreg-limit-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { LOG_DIR } = await import('../findcc.js');
const { getWorkspaces, registerWorkspace } = await import('../server/workspace-registry.js');

const WORKSPACES_FILE = join(LOG_DIR, 'workspaces.json');

// 创建一个最小的合法 v2 session 目录(带 journal + meta + 一点内容)。
function makeSessionDir(projectName, sid, opts = {}) {
  const dir = join(LOG_DIR, projectName, 'sessions', sid);
  mkdirSync(join(dir, 'conversations', 'main'), { recursive: true });
  mkdirSync(join(dir, 'blobs'), { recursive: true });
  // meta.json:leader 标记防止被 isDiscardableSession 判为 probe-only
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({
    wireFormat: 2, sessionId: sid, project: projectName, leader: true,
    startTs: new Date().toISOString(), ...opts.meta,
  }) + '\n');
  writeFileSync(join(dir, 'journal.jsonl'),
    '{"ph":"meta","wireFormat":2}\n'
    + '{"ph":"req","seq":1,"rid":"r1","kind":"main","ts":"2026-07-16T00:00:00.000Z","url":"u"}\n');
  writeFileSync(join(dir, 'conversations', 'main', 'e0.jsonl'), 'x'.repeat(opts.size || 200));
  return dir;
}

// 写一份伪造的 stats 缓存(LOG_DIR/<project>/<project>.json)。
function writeStatsCache(projectName, sessionsMap) {
  // sessionsMap: { sid: { size, journalSize, lastModified } }
  const files = {};
  for (const [sid, fields] of Object.entries(sessionsMap)) {
    files[`sessions/${sid}`] = fields;
  }
  writeFileSync(
    join(LOG_DIR, projectName, `${projectName}.json`),
    JSON.stringify({ _v: 12, files }, null, 2),
  );
}

beforeEach(() => {
  try { unlinkSync(WORKSPACES_FILE); } catch { }
});

after(() => {
  try { rmSync(__isoDir, { recursive: true, force: true }); } catch { }
});

describe('getWorkspaces ?limit= + total + 先排序后富化', () => {
  it('limit 截断: 只返回前 N 个,total 仍是富化前总数', async () => {
    // 注册 7 个 workspace,每个都给一个 session 目录,让富化有真工作可做。
    const ids = [];
    for (let i = 0; i < 7; i++) {
      const e = await registerWorkspace(join(__isoDir, `ws-${i}`));
      makeSessionDir(e.projectName, `sid-${i}`);
      ids.push(e);
      // 保证 lastUsed 严格递增(秒级 ISO 可能相同)。
      await new Promise((r) => setTimeout(r, 3));
    }
    const { workspaces, total } = await getWorkspaces({ limit: 3 });
    assert.equal(total, 7, 'total 是富化前总数');
    assert.equal(workspaces.length, 3, 'limit=3 只返回 3 个');
    // 按 lastUsed 降序,第一个应是最后注册的
    assert.equal(workspaces[0].id, ids[6].id);
  });

  it('limit=0 / 缺省 / 负数 / 非数字 → 返回全部', async () => {
    await registerWorkspace(join(__isoDir, 'ws-a'));
    await registerWorkspace(join(__isoDir, 'ws-b'));
    for (const limit of [undefined, 0, -1, NaN, Infinity]) {
      const { workspaces, total } = await getWorkspaces(limit === undefined ? {} : { limit });
      assert.equal(workspaces.length, 2, `limit=${String(limit)} 应回退到全量`);
      assert.equal(total, 2);
    }
  });

  it('limit > total 时 slice 兜底,返回全部', async () => {
    await registerWorkspace(join(__isoDir, 'ws-x'));
    await registerWorkspace(join(__isoDir, 'ws-y'));
    const { workspaces, total } = await getWorkspaces({ limit: 50 });
    assert.equal(total, 2);
    assert.equal(workspaces.length, 2, 'slice(0, 50) 对 2 项自然兜底');
  });

  it('先排序后富化: 即使最旧 workspace 目录大,也不应被富化', async () => {
    // 验证「先排序」的方式:用 limit=1 时,只有最新的一个会被富化;其它的
    // logCount/totalSize 应该是缺省(undefined 或 0,反正不会被计算),而不是真值。
    const older = await registerWorkspace(join(__isoDir, 'ws-older'));
    await new Promise((r) => setTimeout(r, 5));
    const newer = await registerWorkspace(join(__isoDir, 'ws-newer'));
    // 只给 older 一个 session 目录。如果先富化后排序,older 会被算;先排序后富化则不会。
    makeSessionDir(older.projectName, 'sid-old-only');
    const { workspaces, total } = await getWorkspaces({ limit: 1 });
    assert.equal(total, 2);
    assert.equal(workspaces.length, 1);
    assert.equal(workspaces[0].id, newer.id, '最新的在前');
    // 被切掉的 older 不出现在结果里,所以不会为它跑富化。
  });
});

describe('getWorkspaces stats 缓存命中', () => {
  it('缓存命中时复用缓存的 size,不再跑 dirSizeAsync', async () => {
    const entry = await registerWorkspace(join(__isoDir, 'ws-cached'));
    const sessionDir = makeSessionDir(entry.projectName, 'sid-1', { size: 500 });

    // 读真实 journal 的 size 和 mtime,作为缓存新鲜度 key
    const { statSync } = await import('node:fs');
    const journalStat = statSync(join(sessionDir, 'journal.jsonl'));

    // 伪造一个 size 远大于实际的缓存值 —— 如果命中,totalSize 就是这个伪造值;
    // 如果不命中(走了真实遍历),totalSize 会基于真实大小(明显更小)。
    const FAKE_SIZE = 999_999_999;
    writeStatsCache(entry.projectName, {
      'sid-1': {
        size: FAKE_SIZE,
        journalSize: journalStat.size,
        lastModified: journalStat.mtime.toISOString(),
      },
    });

    const { workspaces } = await getWorkspaces();
    const w = workspaces.find((x) => x.id === entry.id);
    assert.ok(w, 'workspace returned');
    assert.equal(w.totalSize, FAKE_SIZE, '缓存命中 → 直接用缓存的 size');
    assert.equal(w.sessionCount, 1);
  });

  it('缓存版本不匹配时回退到实时遍历', async () => {
    const entry = await registerWorkspace(join(__isoDir, 'ws-stale'));
    makeSessionDir(entry.projectName, 'sid-1', { size: 500 });
    // 写一个版本号错的缓存
    writeFileSync(
      join(LOG_DIR, entry.projectName, `${entry.projectName}.json`),
      JSON.stringify({ _v: 999, files: { 'sessions/sid-1': { size: 999_999_999 } } }),
    );
    const { workspaces } = await getWorkspaces();
    const w = workspaces.find((x) => x.id === entry.id);
    // 真实的 totalSize 远小于 999_999_999
    assert.ok(w.totalSize > 0 && w.totalSize < 100_000, `版本不匹配 → 实时遍历 (got ${w.totalSize})`);
  });

  it('缓存 journalSize 不匹配(文件已变)时回退到实时遍历', async () => {
    const entry = await registerWorkspace(join(__isoDir, 'ws-drifted'));
    makeSessionDir(entry.projectName, 'sid-1', { size: 500 });
    writeStatsCache(entry.projectName, {
      'sid-1': {
        size: 999_999_999,
        journalSize: 12345, // 显然不匹配真实 journal
        lastModified: new Date().toISOString(),
      },
    });
    const { workspaces } = await getWorkspaces();
    const w = workspaces.find((x) => x.id === entry.id);
    assert.ok(w.totalSize > 0 && w.totalSize < 100_000, `journalSize 漂移 → 实时遍历 (got ${w.totalSize})`);
  });

  it('缓存文件不存在时不抛错,正常实时遍历', async () => {
    const entry = await registerWorkspace(join(__isoDir, 'ws-nocache'));
    makeSessionDir(entry.projectName, 'sid-1', { size: 500 });
    // 不写任何 stats 缓存文件
    const { workspaces } = await getWorkspaces();
    const w = workspaces.find((x) => x.id === entry.id);
    assert.ok(w.totalSize > 0 && w.totalSize < 100_000);
    assert.equal(w.sessionCount, 1);
  });
});

describe('getWorkspaces 异步性(不阻塞事件循环)', () => {
  it('富化期间事件循环仍能处理其它任务', async () => {
    // 注册一个 workspace + 一个 session,让富化有真工作。
    const entry = await registerWorkspace(join(__isoDir, 'ws-async'));
    makeSessionDir(entry.projectName, 'sid-1', { size: 500 });

    // 关键断言:setImmediate 必须在 await 富化完成前触发 —— 即事件循环没有被
    // 同步 fs 调用冻结。如果 dirSizeAsync 退化回 dirSizeSync(全同步),setImmediate
    // 会被压在富化结束后才跑,此断言失败。
    let immediateFired = false;
    const p = getWorkspaces();
    setImmediate(() => { immediateFired = true; });
    await p;
    assert.equal(immediateFired, true, 'setImmediate must fire before enrichment resolves (proves event loop was not blocked)');
  });
});

describe('STATS_CACHE_VERSION 一致性守护', () => {
  it('workspace-registry 的 STATS_CACHE_VERSION 必须等于 stats-worker 的 STATS_VERSION', () => {
    // 两处分硬编码(避免把 worker 模块图拉进主线程),一旦 stats-worker bump 而
    // workspace-registry 没跟上,缓存命中条件会静默失效(性能回退)。本测试守住漂移。
    const testDir = fileURLToPath(new URL('.', import.meta.url));
    const registrySrc = readFileSync(join(testDir, '../server/workspace-registry.js'), 'utf8');
    const workerSrc = readFileSync(join(testDir, '../server/lib/stats-worker.js'), 'utf8');
    const registryVersion = registrySrc.match(/const\s+STATS_CACHE_VERSION\s*=\s*(\d+)/)?.[1];
    const workerVersion = workerSrc.match(/const\s+STATS_VERSION\s*=\s*(\d+)/)?.[1];
    assert.ok(registryVersion, 'workspace-registry 必须导出 STATS_CACHE_VERSION');
    assert.ok(workerVersion, 'stats-worker 必须导出 STATS_VERSION');
    assert.equal(registryVersion, workerVersion,
      `version drift: workspace-registry=${registryVersion}, stats-worker=${workerVersion}`);
  });
});

describe('dirSizeAsync 与 dirSizeSync 行为对照', () => {
  // 这次改动把请求路径的递归遍历从 sync 换成 async;两实现必须逐字节一致,
  // 否则 .totalSize 会在两种缓存命中状态之间漂移。
  let fixtureDir;
  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'ccv-dirsize-'));
  });
  after(() => {
    try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { }
  });

  it('空目录', async () => {
    assert.equal(dirSizeSync(fixtureDir), await dirSizeAsync(fixtureDir));
  });

  it('12 层深嵌套 + 多文件', async () => {
    let cur = fixtureDir;
    for (let i = 0; i < 12; i++) {
      cur = join(cur, `d${i}`);
      mkdirSync(cur, { recursive: true });
      writeFileSync(join(cur, `f${i}.txt`), 'x'.repeat(100 * (i + 1)));
    }
    assert.equal(dirSizeSync(fixtureDir), await dirSizeAsync(fixtureDir));
    assert.ok(dirSizeSync(fixtureDir) > 0);
  });

  it('不存在的路径', async () => {
    const p = join(fixtureDir, 'does-not-exist');
    assert.equal(dirSizeSync(p), await dirSizeAsync(p));
  });

  it('symlink 到文件', async () => {
    writeFileSync(join(fixtureDir, 'real.txt'), 'x'.repeat(100));
    try {
      symlinkSync(join(fixtureDir, 'real.txt'), join(fixtureDir, 'link.txt'));
    } catch {
      // Windows / 权限不足场景跳过
      return;
    }
    assert.equal(dirSizeSync(fixtureDir), await dirSizeAsync(fixtureDir));
  });

  it('broken symlink(readdir 能看到,stat 失败)', async () => {
    writeFileSync(join(fixtureDir, 'real.txt'), 'x'.repeat(100));
    try {
      symlinkSync(join(fixtureDir, 'gone.txt'), join(fixtureDir, 'broken.txt'));
    } catch {
      return;
    }
    // 两个实现都吞 stat 错(raced-deletion tolerant),应该返回相同值
    assert.equal(dirSizeSync(fixtureDir), await dirSizeAsync(fixtureDir));
  });
});
