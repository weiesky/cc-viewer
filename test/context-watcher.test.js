import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, mkdtempSync, symlinkSync, rmdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ████ 数据安全死命令(2026-06-06 事故:测试五次删用户真实 ~/.claude 数据)████
// ESM 静态 import 会被 hoist,先于本文件任何语句执行!所以「先赋 env 再静态 import」是无效的。
// context-watcher 的 CONTEXT_WINDOW_FILE 派生自 getClaudeConfigDir()→CLAUDE_CONFIG_DIR,在模块
// init 时即固化 —— 因此【必须】先锁死 CLAUDE_CONFIG_DIR / CCV_LOG_DIR 到进程私有临时目录,
// 再用顶层【动态】import 读项目模块。顺序绝不能反:env→动态 import。
// 严禁把下面的 ../server/lib/context-watcher.js / ../findcc.js 改回顶层静态 import。
const __isoDir = mkdtempSync(join(tmpdir(), 'ccv-ctxw-'));
process.env.CCV_LOG_DIR = __isoDir;
process.env.CLAUDE_CONFIG_DIR = __isoDir;

const { readModelContextSize, getContextSizeForModel, buildContextWindowEvent, readClaudeProjectModel, CONTEXT_WINDOW_FILE } = await import('../packages/app/server/lib/context-watcher.js');
const { getClaudeConfigDir } = await import('../packages/app/findcc.js');

const CLAUDE_DIR = getClaudeConfigDir();

// 备份和恢复 context-window.json
let savedContextFile = null;
let contextFileExisted = false;

function backupContextFile() {
  try {
    contextFileExisted = existsSync(CONTEXT_WINDOW_FILE);
    if (contextFileExisted) savedContextFile = readFileSync(CONTEXT_WINDOW_FILE, 'utf-8');
  } catch { }
}

function restoreContextFile() {
  try {
    if (contextFileExisted && savedContextFile !== null) {
      writeFileSync(CONTEXT_WINDOW_FILE, savedContextFile);
    } else if (!contextFileExisted && existsSync(CONTEXT_WINDOW_FILE)) {
      unlinkSync(CONTEXT_WINDOW_FILE);
    }
  } catch { }
  savedContextFile = null;
}

describe('context-watcher: readModelContextSize', () => {
  it('returns default 200k when file does not exist', () => {
    backupContextFile();
    try {
      if (existsSync(CONTEXT_WINDOW_FILE)) unlinkSync(CONTEXT_WINDOW_FILE);
      const result = readModelContextSize();
      assert.equal(result.modelId, null);
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });

  it('infers 1M from model.id with [1m] tag', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-opus-4-6[1m]' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.modelId, 'claude-opus-4-6[1m]');
      assert.equal(result.contextSize, 1000000);
    } finally {
      restoreContextFile();
    }
  });

  it('infers 200k from model.id with [200k] tag', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-sonnet-4-6[200k]' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.modelId, 'claude-sonnet-4-6[200k]');
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });

  it('falls back to context_window.context_window_size from Claude Code statusLine', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-sonnet-4-6' },
        context_window: { context_window_size: 200000 },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });

  it('defaults Opus to 1M when no size tag in model.id', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-opus-4-6' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 1000000);
    } finally {
      restoreContextFile();
    }
  });

  it('defaults mythons to 1M when no size tag in model.id', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-mythons' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 1000000);
    } finally {
      restoreContextFile();
    }
  });

  it('defaults fable-5 to 1M when no size tag in model.id', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-fable-5' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 1000000);
    } finally {
      restoreContextFile();
    }
  });

  it('returns default 200k when model.id has no size tag and no context_window field', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'claude-sonnet-4-6' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.contextSize, 200000);
    } finally {
      restoreContextFile();
    }
  });

  it('kimi model.id → 256K(规则表新家族)', () => {
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({
        model: { id: 'kimi-k3' },
      }) + '\n');
      const result = readModelContextSize();
      assert.equal(result.modelId, 'kimi-k3');
      assert.equal(result.contextSize, 256000);
    } finally {
      restoreContextFile();
    }
  });
});

describe('context-watcher: getContextSizeForModel', () => {
  // 这些 model base 都不会与前面 readModelContextSize 用例写进启动缓存的 base
  // (opus-4-6 / sonnet-4-6 / mythons)相撞,因此直接走 /opus|mythons/ 兜底分支判定。
  it('opus-4-8 → 1M', () => { assert.equal(getContextSizeForModel('claude-opus-4-8-20251201'), 1000000); });
  it('opus-4-9 → 1M (前瞻版本)', () => { assert.equal(getContextSizeForModel('claude-opus-4-9'), 1000000); });
  it('mythons → 1M', () => { assert.equal(getContextSizeForModel('claude-mythons'), 1000000); });
  it('mythons with date suffix → 1M', () => { assert.equal(getContextSizeForModel('claude-mythons-20260101'), 1000000); });
  // fable-5 base 'fable-5-1' 等不与启动缓存 base(fable-5)相撞的形态走兜底正则
  it('fable-5 with date suffix → 1M', () => { assert.equal(getContextSizeForModel('claude-fable-5-20260101'), 1000000); });
  it('fable-5.x → 1M (前瞻版本)', () => { assert.equal(getContextSizeForModel('claude-fable-5-1'), 1000000); });
  // 用 haiku(base 'haiku-4-5')而非 sonnet-4-6:后者的 base 会撞上启动缓存命中分支、
  // 绕过本用例要验的 /opus|mythons/ miss→200K 兜底,使断言失去意义。
  it('non-opus/non-mythons → 200K', () => { assert.equal(getContextSizeForModel('claude-haiku-4-5'), 200000); });
  // 共享规则表(context-rules.js)接入后的回归:以下 base 均不与启动缓存撞车
  it('deepseek-v4 → 1M(此前服务端漂移误判 200K 的修复)', () => { assert.equal(getContextSizeForModel('deepseek-v4'), 1000000); });
  it('旧 opus(4-1 含日期后缀)→ 200K(规则表修正)', () => { assert.equal(getContextSizeForModel('claude-opus-4-1-20250805'), 200000); });
  it('gpt-4o → 128K(三方档位与前端同源)', () => { assert.equal(getContextSizeForModel('gpt-4o'), 128000); });
});

describe('context-watcher: getContextSizeForModel — entry 形式(热切换感知)', () => {
  // response.body.model 是代理热切换后的权威模型名(与前端 effectiveModel 同优先级);
  // 该路径跳过启动缓存 —— 缓存是请求侧静态信息,热切换后即过期。
  it('entry: response.body.model 优先于请求名(hot-switch → kimi-k3 = 256K)', () => {
    const entry = { body: { model: 'claude-opus-4-6' }, response: { body: { model: 'kimi-k3' } } };
    assert.equal(getContextSizeForModel(entry), 256000);
  });
  it('entry: response 模型命中缓存 base 也绕过启动缓存(规则表为准)', () => {
    // 自包含重建启动缓存(sonnet-4-6 → 200K),不依赖前面用例的执行顺序。
    backupContextFile();
    try {
      mkdirSync(CLAUDE_DIR, { recursive: true });
      writeFileSync(CONTEXT_WINDOW_FILE, JSON.stringify({ model: { id: 'claude-sonnet-4-6[200k]' } }) + '\n');
      readModelContextSize(); // populates _startupModelBase='sonnet-4-6', _startupContextSize=200K
      // 请求名(无 [Nk]/[Nm] 后缀)撞缓存 base 'sonnet-4-6',但 response 是 kimi-k3
      // → entry 路径绕过启动缓存走规则表 → 256K(而非缓存的 200K 或 opus 的 1M)。
      const entry = { body: { model: 'claude-sonnet-4-6' }, response: { body: { model: 'kimi-k3' } } };
      assert.equal(getContextSizeForModel(entry), 256000);
    } finally {
      restoreContextFile();
    }
  });
  it('entry: response.body.model 为空字符串 → 视为无 response 模型,回退请求名旧路径', () => {
    const entry = { body: { model: 'claude-haiku-4-5' }, response: { body: { model: '' } } };
    assert.equal(getContextSizeForModel(entry), 200000);
  });
  it('entry: 无 response.body.model → 回退请求名旧路径(缓存优先保留)', () => {
    const entry = { body: { model: 'claude-haiku-4-5' }, response: { body: { usage: {} } } };
    assert.equal(getContextSizeForModel(entry), 200000);
  });
  it('entry: 无 response 字段 → 请求名旧路径', () => {
    assert.equal(getContextSizeForModel({ body: { model: 'claude-opus-4-1' } }), 200000);
  });
  it('entry: response 模型带日期后缀/大小写混合照常命中家族表', () => {
    const entry = { body: { model: 'claude-sonnet-4-6' }, response: { body: { model: 'DeepSeek-V4-Turbo' } } };
    assert.equal(getContextSizeForModel(entry), 1000000);
  });
  it('entry: response 模型无法识别 → 规则表默认 200K(adaptContextWindow 兜底纠偏)', () => {
    const entry = { body: { model: 'claude-opus-4-8' }, response: { body: { model: 'some-opaque-upstream-alias' } } };
    assert.equal(getContextSizeForModel(entry), 200000);
  });
  it('entry: 请求名带 [1m] 后缀 → 请求后缀优先,不被响应归一化覆盖(k3[1m]→裸k3 仍 1M)', () => {
    // 热切换配置 k3[1m]:上游响应 model 剥成裸 k3,请求侧 [1m] 意图必须胜出 → 1M。
    const entry = { body: { model: 'k3[1m]' }, response: { body: { model: 'k3' } } };
    assert.equal(getContextSizeForModel(entry), 1000000);
  });
});

describe('context-watcher: readClaudeProjectModel', () => {
  // 用 tmpdir 写 stub ~/.claude.json,readClaudeProjectModel 接受可选 filePath 参数,
  // 单测注入 tmp 文件不动用户真实 config(后者动辄数 MB)。
  function withTmpClaudeJson(content, fn) {
    const tmpFile = join(tmpdir(), `cc-viewer-claude-json-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(tmpFile, typeof content === 'string' ? content : JSON.stringify(content));
    try { return fn(tmpFile); }
    finally { try { unlinkSync(tmpFile); } catch {} }
  }

  it('returns null when file does not exist', () => {
    const result = readClaudeProjectModel('/some/cwd', join(tmpdir(), 'definitely-not-exist-' + Date.now() + '.json'));
    assert.equal(result, null);
  });

  it('returns null when cwd is missing or not a string', () => {
    withTmpClaudeJson({ projects: {} }, (tmpFile) => {
      assert.equal(readClaudeProjectModel(null, tmpFile), null);
      assert.equal(readClaudeProjectModel('', tmpFile), null);
      assert.equal(readClaudeProjectModel(123, tmpFile), null);
    });
  });

  it('returns null when projects[cwd] does not exist', () => {
    withTmpClaudeJson({ projects: { '/other/path': { lastModelUsage: { foo: {} } } } }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd', tmpFile), null);
    });
  });

  it('returns null when lastModelUsage is empty', () => {
    withTmpClaudeJson({ projects: { '/my/cwd': { lastModelUsage: {} } } }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd', tmpFile), null);
    });
  });

  it('returns null when only haiku is present (filtered out)', () => {
    withTmpClaudeJson({
      projects: { '/my/cwd': { lastModelUsage: { 'claude-haiku-4-5': { costUSD: 0.5 } } } },
    }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd', tmpFile), null);
    });
  });

  it('prefers [1m] suffix over other models', () => {
    // [1m] 是用户显式选 1M context 的强信号,即使 costUSD 不是最大也优先返回
    withTmpClaudeJson({
      projects: { '/my/cwd': { lastModelUsage: {
        'claude-opus-4-7': { costUSD: 100 },
        'claude-opus-4-7[1m]': { costUSD: 10 },
      } } },
    }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd', tmpFile), 'claude-opus-4-7[1m]');
    });
  });

  it('falls back to highest costUSD when no [1m] entry', () => {
    withTmpClaudeJson({
      projects: { '/my/cwd': { lastModelUsage: {
        'claude-sonnet-4-6': { costUSD: 5 },
        'claude-opus-4-7': { costUSD: 50 },
      } } },
    }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd', tmpFile), 'claude-opus-4-7');
    });
  });

  it('skips haiku and picks among non-haiku entries', () => {
    withTmpClaudeJson({
      projects: { '/my/cwd': { lastModelUsage: {
        'claude-haiku-4-5': { costUSD: 200 },
        'claude-opus-4-7': { costUSD: 20 },
      } } },
    }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd', tmpFile), 'claude-opus-4-7');
    });
  });

  it('returns null on invalid JSON (graceful catch)', () => {
    withTmpClaudeJson('{not-valid-json', (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd', tmpFile), null);
    });
  });

  it('matches with trailing slash — "/my/cwd/" finds key "/my/cwd"', () => {
    withTmpClaudeJson({
      projects: { '/my/cwd': { lastModelUsage: { 'claude-opus-4-7': { costUSD: 50 } } } },
    }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/cwd/', tmpFile), 'claude-opus-4-7');
    });
  });

  it('matches via realpath when cwd is accessed through a symlink', () => {
    const realDir = mkdtempSync(join(tmpdir(), 'ccv-test-real-'));
    const linkDir = join(tmpdir(), `ccv-test-link-${Date.now()}`);
    // Use realpathSync on both sides: the JSON key and the lookup path must
    // resolve to the same canonical path (macOS /var→/private/var symlinks).
    const canonicalDir = realpathSync(realDir);
    try {
      symlinkSync(realDir, linkDir);
      withTmpClaudeJson({
        projects: { [canonicalDir]: { lastModelUsage: { 'claude-opus-4-7': { costUSD: 50 } } } },
      }, (tmpFile) => {
        assert.equal(readClaudeProjectModel(linkDir, tmpFile), 'claude-opus-4-7');
      });
    } finally {
      try { unlinkSync(linkDir); } catch {}
      try { rmdirSync(realDir); } catch {}
    }
  });

  it('case-insensitive fallback on darwin/win32 — "/My/Proj" finds key "/my/proj"', { skip: process.platform !== 'darwin' && process.platform !== 'win32' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'CCV-TEST-'));
    try {
      const canonicalDir = realpathSync(dir);
      withTmpClaudeJson({
        projects: { [canonicalDir.toLowerCase()]: { lastModelUsage: { 'claude-opus-4-7': { costUSD: 50 } } } },
      }, (tmpFile) => {
        assert.equal(readClaudeProjectModel(dir, tmpFile), 'claude-opus-4-7');
      });
    } finally {
      try { rmdirSync(dir); } catch {}
    }
  });

  it('haiku-only exact match returns null — never bleeds into a case-variant sibling key', () => {
    // The sibling is inserted FIRST so a naive case-insensitive scan would find
    // it before the exact key; an exact usage record must decide alone.
    withTmpClaudeJson({
      projects: {
        '/MY/PROJ': { lastModelUsage: { 'claude-opus-4-7': { costUSD: 99 } } },
        '/my/proj': { lastModelUsage: { 'claude-haiku-4-5': { costUSD: 1 } } },
      },
    }, (tmpFile) => {
      assert.equal(readClaudeProjectModel('/my/proj', tmpFile), null);
    });
  });

  it('matches a raw symlink-path key even when realpath diverges from it', () => {
    // Key stored as the symlink path itself (non-canonical): the raw cwd must be
    // tried before the realpath'd form, or a previously-working lookup regresses.
    const realDir = mkdtempSync(join(tmpdir(), 'ccv-test-rawkey-'));
    const linkDir = join(tmpdir(), `ccv-test-rawlink-${Date.now()}`);
    try {
      symlinkSync(realDir, linkDir);
      withTmpClaudeJson({
        projects: { [linkDir]: { lastModelUsage: { 'claude-opus-4-7': { costUSD: 50 } } } },
      }, (tmpFile) => {
        assert.equal(readClaudeProjectModel(linkDir, tmpFile), 'claude-opus-4-7');
      });
    } finally {
      try { unlinkSync(linkDir); } catch {}
      try { rmdirSync(realDir); } catch {}
    }
  });
});

describe('context-watcher: buildContextWindowEvent', () => {
  it('computes correct context_window data from usage', () => {
    const usage = {
      input_tokens: 5000,
      output_tokens: 1000,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 3000,
    };
    const result = buildContextWindowEvent(usage, 200000);
    assert.ok(result);
    assert.equal(result.total_input_tokens, 8200); // 5000 + 200 + 3000
    assert.equal(result.total_output_tokens, 1000);
    assert.equal(result.context_window_size, 200000);
    assert.equal(result.used_percentage, 5); // (9200 / 200000) * 100 ≈ 5
    assert.equal(result.remaining_percentage, 95);
  });

  it('computes correct percentage for 1M context', () => {
    const usage = { input_tokens: 50000, output_tokens: 10000 };
    const result = buildContextWindowEvent(usage, 1000000);
    assert.ok(result);
    assert.equal(result.context_window_size, 1000000);
    assert.equal(result.used_percentage, 6); // (60000 / 1000000) * 100 = 6
    assert.equal(result.remaining_percentage, 94);
  });

  it('returns null when usage is missing', () => {
    assert.equal(buildContextWindowEvent(null, 200000), null);
    assert.equal(buildContextWindowEvent(undefined, 200000), null);
  });

  it('handles zero tokens gracefully', () => {
    const usage = { input_tokens: 0, output_tokens: 0 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.ok(result);
    assert.equal(result.used_percentage, 0);
    assert.equal(result.remaining_percentage, 100);
  });

  it('preserves current_usage in output', () => {
    const usage = { input_tokens: 1000, output_tokens: 500 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.deepEqual(result.current_usage, usage);
  });

  it('自适应纠偏:判 200K 但输入上下文 >200K → size 升 1M、百分比按 1M 重算', () => {
    // 250K 输入(input+cache)对 200K 模型物理上不可能 → 必是误判,升 1M。
    const usage = { input_tokens: 100000, cache_read_input_tokens: 150000, output_tokens: 5000 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.equal(result.total_input_tokens, 250000);
    assert.equal(result.context_window_size, 1000000); // 200000 → 1000000
    assert.equal(result.used_percentage, 26); // (255000 / 1000000) * 100 ≈ 26（非卡死 100）
  });

  it('自适应纠偏:判 256K(kimi 精确档)但输入 >256K → 升 1M;未越窗保持 256K', () => {
    // 260K 输入对 256K 窗口同样物理不可能 → 升 1M,百分比按 1M 重算。
    const over = buildContextWindowEvent({ input_tokens: 260000, output_tokens: 5000 }, 256000);
    assert.equal(over.context_window_size, 1000000); // 256000 → 1000000
    assert.equal(over.used_percentage, 27); // (265000 / 1000000) * 100 ≈ 27
    // 200K 输入 < 256K → 不触发,保持 256K 档。
    const under = buildContextWindowEvent({ input_tokens: 200000, output_tokens: 5000 }, 256000);
    assert.equal(under.context_window_size, 256000);
    assert.equal(under.used_percentage, 80); // (205000 / 256000) * 100 ≈ 80
  });

  it('自适应纠偏:大 output 但输入侧未越窗 → 不触发(只看输入侧)', () => {
    // output 拉高 totalTokens,但 input+cache 仅 120K < 200K,不该误升。
    const usage = { input_tokens: 100000, cache_read_input_tokens: 20000, output_tokens: 150000 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.equal(result.total_input_tokens, 120000);
    assert.equal(result.context_window_size, 200000); // 保持 200K
  });

  it('自适应纠偏:1M 判定 + 高用量 → 原样 1M(单向,不降级)', () => {
    const usage = { input_tokens: 300000, output_tokens: 10000 };
    const result = buildContextWindowEvent(usage, 1000000);
    assert.equal(result.context_window_size, 1000000);
  });

  it('嵌套 cache_creation(flat 缺失)计入 total_input_tokens', () => {
    const usage = { input_tokens: 5000, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 }, cache_read_input_tokens: 3000, output_tokens: 1000 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.equal(result.total_input_tokens, 8300); // 5000 + (200+100) + 3000
    assert.equal(result.used_percentage, 5); // (9300 / 200000) * 100 ≈ 5
  });

  it('嵌套 cache_creation 用量推过 200K → 触发纠偏升 1M(组合场景)', () => {
    const usage = { input_tokens: 100000, cache_creation: { ephemeral_5m_input_tokens: 150000 }, output_tokens: 5000 };
    const result = buildContextWindowEvent(usage, 200000);
    assert.equal(result.total_input_tokens, 250000);
    assert.equal(result.context_window_size, 1000000);
  });
});

describe('log-watcher: processWatchedEntry — 实时 SSE 路径热切换感知', () => {
  // 实时广播路径(log-watcher.js processWatchedEntry)与 /events 冷加载共用同一
  // getContextSizeForModel entry 分支;此处直接驱动 processWatchedEntry,断言广播帧的
  // context_window_size 跟随 response.body.model 而非请求名。
  it('热切换 entry(请求 opus-4-6 / 响应 kimi-k3)→ 广播 context_window_size=256000', async () => {
    const { processWatchedEntry } = await import('../packages/app/server/lib/log-watcher.js');
    const sent = [];
    const clients = [{
      write: (payload) => { sent.push(payload); return true; },
      // minimal writable-ish surface used by _safeSseWrite
      destroyed: false,
    }];
    const parsed = {
      timestamp: '2026-07-30T00:00:00.000Z',
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      mainAgent: true,
      body: {
        model: 'claude-opus-4-6',
        system: [{ type: 'text', text: 'You are Claude Code' }],
        tools: [{ name: 'Edit' }, { name: 'Bash' }, { name: 'Task' }, { name: 'Read' }, { name: 'Write' }, { name: 'Glob' }, { name: 'Grep' }, { name: 'Agent' }, { name: 'WebFetch' }, { name: 'WebSearch' }, { name: 'NotebookEdit' }, { name: 'AskUser' }],
        metadata: { user_id: JSON.stringify({ device_id: 'd', account_uuid: 'a', session_id: 's' }) },
        messages: [{ role: 'user', content: 'hi' }],
      },
      response: { status: 200, body: { model: 'kimi-k3', usage: { input_tokens: 1000, output_tokens: 10 } } },
    };
    const ctx = {
      reconstructor: { reconstruct: () => {} },
      clients,
      getClaudePid: () => 12345,
      runParallelHook: () => Promise.resolve(),
    };
    processWatchedEntry(parsed, ctx);
    const cwFrame = sent.find((p) => p.startsWith('event: context_window'));
    assert.ok(cwFrame, `应广播 context_window 帧(实发 ${sent.length} 帧)`);
    const data = JSON.parse(cwFrame.slice(cwFrame.indexOf('data:') + 5).trim());
    assert.equal(data.context_window_size, 256000,
      '实时路径窗口档位应跟随 response.body.model(kimi-k3 → 256K),而非请求名 opus-4-6 的 1M');
  });
});
