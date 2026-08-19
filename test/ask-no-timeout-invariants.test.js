// Regression net: lock the three "AskUserQuestion 无超时无降级" invariants in place,
// so a future contributor doesn't quietly walk them back to 60min/50-cap/setTimeout.
//
// Static-only because a real long-poll test would have to wait the full 24h to verify
// the timeout doesn't fire too early. Source-level assertions are sufficient — the
// values are simple constants whose values *are* the contract.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// These invariants pin behavior by asserting on source TEXT, so they reference
// files by literal repo-relative path. When a file is moved/renamed, update the
// path here — readSource() fails loudly (with the offending path) instead of a
// bare ENOENT, so the fix is obvious.
function readSource(relPath) {
  const abs = resolve(repoRoot, relPath);
  if (!existsSync(abs)) {
    throw new Error(`readSource: "${relPath}" not found — did this file move? Update the path in ${'ask-no-timeout-invariants.test.js'}.`);
  }
  return readFileSync(abs, 'utf-8');
}

describe('AskUserQuestion 无超时/无降级 不变量', () => {
  it('lib/ask-bridge.js 不再调 req.setTimeout（客户端无硬超时）', () => {
    const src = readSource('packages/app/server/lib/ask-bridge.js');
    assert.ok(
      !/req\.setTimeout\s*\(/.test(src),
      'lib/ask-bridge.js 出现了 req.setTimeout — 违反"客户端无硬超时"承诺（用户视角任何 N 分钟挂起都不应被打断）',
    );
    assert.ok(
      !/TIMEOUT_MS\s*=\s*\d+\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(src),
      'lib/ask-bridge.js 出现了 60min 级别 TIMEOUT_MS 字面量 — 不再有客户端硬时限',
    );
  });

  it('server.js ASK_HOOK_TIMEOUT_MS 必须引用 ASK_TIMEOUT_MS（同源常量来自 lib/ask-constants.js）', () => {
    const src = readSource('packages/app/server/server.js');
    const m = src.match(/const\s+ASK_HOOK_TIMEOUT_MS\s*=\s*([^;]+);/);
    assert.ok(m, 'server.js 必须显式声明 const ASK_HOOK_TIMEOUT_MS 作为同源常量（避免 60min/24h 字面量散落）');
    const expr = m[1].trim();
    assert.ok(
      /ASK_TIMEOUT_MS/.test(expr),
      `ASK_HOOK_TIMEOUT_MS 必须引用 ASK_TIMEOUT_MS（lib/ask-constants.js），不允许内联字面量；实测 "${expr}"`,
    );
    // server.js 必须 import 同源常量
    assert.match(
      src,
      /import\s*\{[^}]*ASK_TIMEOUT_MS[^}]*\}\s*from\s*['"]\.\/lib\/ask-constants\.js['"]/,
      'server.js 必须从 lib/ask-constants.js import ASK_TIMEOUT_MS',
    );
  });

  it('lib/ask-constants.js ASK_TIMEOUT_MS = 24h（hook 与 SDK 路径共享的"无超时"实质上限）', async () => {
    const { ASK_TIMEOUT_MS } = await import('../packages/app/server/lib/ask-constants.js');
    assert.equal(ASK_TIMEOUT_MS, 24 * 60 * 60 * 1000, `ASK_TIMEOUT_MS 必须为 24h，实测 ${ASK_TIMEOUT_MS}`);
  });

  it('lib/sdk-manager.js askTimeoutMs 必须引用 ASK_TIMEOUT_MS（与 hook 路径同源）', () => {
    const src = readSource('packages/app/server/lib/sdk-manager.js');
    const m = src.match(/const\s+askTimeoutMs\s*=\s*([^;]+);/);
    assert.ok(m, 'sdk-manager.js 必须声明 const askTimeoutMs');
    assert.ok(
      /ASK_TIMEOUT_MS/.test(m[1]),
      `sdk-manager askTimeoutMs 必须引用 ASK_TIMEOUT_MS（防 60min/24h 双行为漂移），实测 "${m[1].trim()}"`,
    );
  });

  it('server.js HOOK_TIMEOUT / REPLAY_HOOK_TIMEOUT 必须引用 ASK_HOOK_TIMEOUT_MS 而非字面量', () => {
    // HOOK_TIMEOUT 在 /api/ask-hook handler 内（已迁出到 server/routes/ask-perm.js）
    const askPermSrc = readSource('packages/app/server/routes/ask-perm.js');
    const hookTimeoutAssign = askPermSrc.match(/const\s+HOOK_TIMEOUT\s*=\s*([^;]+);/);
    assert.ok(hookTimeoutAssign, 'routes/ask-perm.js 必须声明 const HOOK_TIMEOUT');
    assert.ok(
      /ASK_HOOK_TIMEOUT_MS/.test(hookTimeoutAssign[1]),
      `HOOK_TIMEOUT 必须引用 ASK_HOOK_TIMEOUT_MS（防字面量漂移），实测 "${hookTimeoutAssign[1].trim()}"`,
    );
    // REPLAY_HOOK_TIMEOUT 在 WS reconnect replay 路径（仍在 server.js）
    const src = readSource('packages/app/server/server.js');
    const replayAssign = src.match(/const\s+REPLAY_HOOK_TIMEOUT\s*=\s*([^;]+);/);
    assert.ok(replayAssign, 'server.js 必须声明 const REPLAY_HOOK_TIMEOUT');
    assert.ok(
      /ASK_HOOK_TIMEOUT_MS/.test(replayAssign[1]),
      `REPLAY_HOOK_TIMEOUT 必须引用 ASK_HOOK_TIMEOUT_MS，实测 "${replayAssign[1].trim()}"`,
    );
  });

  it('server.js ASK_HOOK_MAP_MAX = 1000（防恶意 OOM 兜底，正常使用永不触发）', () => {
    const src = readSource('packages/app/server/server.js');
    const m = src.match(/const\s+ASK_HOOK_MAP_MAX\s*=\s*(\d+)/);
    assert.ok(m, 'server.js 必须显式声明 ASK_HOOK_MAP_MAX');
    const v = Number(m[1]);
    assert.ok(v >= 1000, `ASK_HOOK_MAP_MAX 不能再降回 ≤50 的早期窄上限，实测 ${v}（要求 ≥1000）`);
  });

  it('src/components/chat/AskQuestionForm.jsx 不再有 30s submitting 强释放 setTimeout', () => {
    const src = readSource('apps/web/src/components/chat/AskQuestionForm.jsx');
    // 旧版用 30000 字面量 setTimeout 重置 submitting
    assert.ok(
      !/setTimeout\([^)]*submitting:\s*false[^)]*\}\s*,\s*30000\s*\)/s.test(src)
        && !/}\s*,\s*30000\s*\);\s*\/\/\s*超时恢复/.test(src),
      'AskQuestionForm.jsx 出现了 30000ms setTimeout 释放 submitting — 违反"网络抖动不再被强行解锁"承诺',
    );
    // _submitTimeout 残留检测：constructor / handleSubmit / unmount 都不应再写 this._submitTimeout
    assert.ok(
      !/this\._submitTimeout\s*=/.test(src),
      'AskQuestionForm.jsx 残留 this._submitTimeout 赋值 — 应彻底清理',
    );
  });

  it('src/components/chat/AskTimeoutCountdown.jsx 含 isInfiniteTimeout 阈值分支', () => {
    const src = readSource('apps/web/src/components/chat/AskTimeoutCountdown.jsx');
    assert.ok(
      /NO_TIMEOUT_THRESHOLD_MS/.test(src),
      'AskTimeoutCountdown 必须定义 NO_TIMEOUT_THRESHOLD_MS 用于识别"实质无超时"模式',
    );
    // 无超时模式必须 return null 不渲染（之前的 ui.askNoTimeout 静态文案已删除：等多久都行 = 没倒计时就是最直接的视觉）
    assert.match(
      src,
      /if\s*\(\s*isInfiniteTimeout\s*\)\s*return\s+null/,
      'AskTimeoutCountdown 在 isInfiniteTimeout 时必须 return null（不渲染倒计时也不渲染文案，最干净）',
    );
  });

  it('askFlowController.js _waitForHookBridge 不再有 3s 固定 fallback 上限', () => {
    // Ask 流逻辑已从 ChatView.jsx 抽到 src/components/chat/controllers/askFlowController.js（保留行为）。
    const src = readSource('apps/web/src/components/chat/controllers/askFlowController.js');
    // 旧版: `if (this._askHookWaitRetries > 30) {`（3s = 30 × 100ms）+ fallback PTY
    // 新版必须存在 _askHookEverActive 区分新老 CC 的逻辑
    assert.ok(
      /_askHookEverActive/.test(src),
      'askFlowController.js 必须有 _askHookEverActive 标志区分"新版 hook bridge 已握手"vs"老版无 hook"两种场景',
    );
    // 不允许 retries > 30 这种 3s 硬上限（仍允许更大值作为老版兜底，> 150 ~30s）
    const m = src.match(/_askHookWaitRetries\s*>\s*(\d+)/);
    if (m) {
      const v = Number(m[1]);
      assert.ok(v >= 100, `_waitForHookBridge fallback 阈值不应回退到 ${v}（< 100 = < 20s），实测 ${v}`);
    }
  });

  // v2a 短轮询协议锚点 —— 锁住关键协议字符串/函数名，防未来漂移破协议
  it('lib/ask-store.js SCHEMA_VERSION = 1（不变量；改 schema 必须显式 bump + 写 migration）', () => {
    const src = readSource('packages/app/server/lib/ask-store.js');
    const m = src.match(/const\s+SCHEMA_VERSION\s*=\s*(\d+)/);
    assert.ok(m, 'lib/ask-store.js 必须显式声明 const SCHEMA_VERSION');
    assert.equal(Number(m[1]), 1, `SCHEMA_VERSION 当前锁定为 1，改值意味着需要写 migration —— 实测 ${m[1]}`);
  });

  it('server.js / ask-bridge.js 共享同一 "X-Ask-Poll-Mode: short" 协议字符串', () => {
    // server 侧的 ask-hook handler 已迁出到 server/routes/ask-perm.js
    const server = readSource('packages/app/server/routes/ask-perm.js');
    const bridge = readSource('packages/app/server/lib/ask-bridge.js');
    assert.ok(/['"]x-ask-poll-mode['"]/i.test(server), 'routes/ask-perm.js 必须读 X-Ask-Poll-Mode header');
    assert.ok(/['"]X-Ask-Poll-Mode['"]/.test(bridge), 'lib/ask-bridge.js 必须发 X-Ask-Poll-Mode header');
    assert.ok(/['"]short['"]/.test(server) && /['"]short['"]/.test(bridge), '协议值必须是字符串 "short"');
    assert.ok(/['"]short-poll['"]/.test(server) && /['"]short-poll['"]/.test(bridge), 'capability 必须是字符串 "short-poll"');
  });

  it('lib/ask-bridge.js 必须有 pollUntilAnswered（防 v2a 短轮询被悄悄删回 long-poll）', () => {
    const src = readSource('packages/app/server/lib/ask-bridge.js');
    assert.ok(/function\s+pollUntilAnswered\b/.test(src), 'lib/ask-bridge.js 必须定义 pollUntilAnswered 函数');
    assert.ok(/getPollResult\s*\(/.test(src), 'lib/ask-bridge.js 必须使用 getPollResult 真正发 GET 请求');
  });

  it('lib/ask-store.js 必须导出 consumeIfFinal（防 GET handler 退回到 race-prone 的 consume+setEntry）', () => {
    const src = readSource('packages/app/server/lib/ask-store.js');
    assert.ok(/export\s+(async\s+)?function\s+consumeIfFinal\b/.test(src), 'consumeIfFinal 必须 export（GET handler 依赖它消除写后读 race）');
  });

  it('server.js GET /api/ask-hook/:id/result 端点存在（短轮询协议核心）', () => {
    // GET /api/ask-hook/:id/result 路由已迁出到 server/routes/ask-perm.js（用 predicate 匹配）
    const askPermSrc = readSource('packages/app/server/routes/ask-perm.js');
    assert.ok(
      /url\.startsWith\(['"]\/api\/ask-hook\/['"]\)/.test(askPermSrc) && /\/result/.test(askPermSrc),
      'routes/ask-perm.js 必须路由 GET /api/ask-hook/:id/result 端点',
    );
    assert.ok(/shortPollListeners/.test(askPermSrc), 'routes/ask-perm.js 必须用 shortPollListeners 处理 GET listener');
    // _notifyShortPollAnswer 推送答案的逻辑仍在 server.js 的 WS answer 路径
    const src = readSource('packages/app/server/server.js');
    assert.ok(/_notifyShortPollAnswer/.test(src), 'server.js 必须有 _notifyShortPollAnswer 推送答案');
  });

  it('lib/ensure-hooks.js 必须给注入 hook 加 timeout 字段（防 Claude Code 10min 中断 ask-bridge → TUI 接管）', () => {
    const src = readSource('packages/app/server/lib/ensure-hooks.js');
    // 锁死默认 86400 的常量赋值场景，而非任意位置含 86400 字面量（防注释里写 "// was 86400" 也通过）
    assert.match(
      src,
      /HOOK_TIMEOUT_DEFAULT_S\s*=\s*86400/,
      'ensure-hooks.js 必须有 HOOK_TIMEOUT_DEFAULT_S = 86400（24h 与 server.js ASK_HOOK_TIMEOUT_MS 同源；改值意味着 TUI 可能重新接管）',
    );
    // env var 名是公共 API（用户回退用），rename 会破坏紧急回退路径
    assert.ok(
      /CCV_HOOK_TIMEOUT_S/.test(src),
      'ensure-hooks.js 必须有 CCV_HOOK_TIMEOUT_S env var（紧急回退入口）',
    );
    // 必须有 _hookObjEqual / _buildHookObj 抽象，防 idempotent 比较只比 command 字符串导致老 settings 不重写
    assert.ok(
      /_hookObjEqual/.test(src) && /_buildHookObj/.test(src),
      'ensure-hooks.js 必须用 _hookObjEqual + _buildHookObj 做完整字段比较（防只比 command 字符串导致升级时老用户 settings 不被重写）',
    );
    // 必须用 merge 而非 replace 防丢第三方追加字段
    assert.ok(
      /_mergeHookObj/.test(src),
      'ensure-hooks.js 必须用 _mergeHookObj 写回 hook（防 rewrite 时整对象覆盖把第三方追加的 if/shell/once/async 等字段吞掉）',
    );
  });
});
