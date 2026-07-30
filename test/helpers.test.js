/**
 * Unit tests for src/utils/helpers.js — 归真版（动态 import 真实模块，不再内联拷贝实现）。
 *
 * helpers.js import 了多个 svg（含 ?raw）依赖链，纯 Node 无法直接静态 import，
 * 因此先 register vite-loader shim 再【动态 import】目标模块。
 *
 * 真实模块 = 事实源：与旧内联拷贝行为冲突处，按真实实现更新 fixture（见各注释），
 * 不改源码。已知与旧内联实现的差异：
 *   - 旧内联 SUBAGENT_SYSTEM_RE 缺 'security monitor|performing a web search' 分支，
 *     真实模块（contentFilter.js）已包含——本套件不直接断言该分支，互不影响。
 *   - 旧内联 getModelInfo 返回 { name, provider: modelName }，真实模块返回完整
 *     { name, provider:<品牌名>, color, svg, svgAnimated }。本套件只断言 .name，无冲突。
 *   - 旧内联 extractCachedContent 提取 tools 的判据是「任一 tool 带 cache_control」；
 *     真实模块（commit 0011d8a, KV-Cache prefix 语义修复）改为「system 有缓存内容」时
 *     才提取 tools。下方 fixture 据此补上带 cache_control 的 system 块。
 *   - parseCachedTools 为真实导出，直接 import（不再内联）。
 */
import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
// extractToolResultText 不从 helpers.js 导出（文件内私有）；其公共版本在 toolResultCore.js，
// 该模块无 svg/i18n 依赖，可直接静态 import（生产路径也复用此实现）。
import { extractToolResultText } from '../src/utils/toolResultCore.js';

let H;
before(async () => {
  H = await import('../src/utils/helpers.js');
});

// ─── Test helpers ────────────────────────────────────────────────────────────

function makeMainReq(overrides = {}) {
  return {
    mainAgent: true,
    timestamp: '2026-01-01T00:00:00Z',
    body: { model: 'claude-opus-4-6', system: [{ type: 'text', text: 'You are Claude Code' }], tools: [], messages: [] },
    response: { status: 200, body: { usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 80 } } },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('helpers', () => {
  describe('getModelMaxTokens', () => {
    it('returns 1000000 for opus models (default 1M)', () => { assert.equal(H.getModelMaxTokens('claude-opus-4-6'), 1000000); });
    it('returns 1000000 for opus model with date suffix', () => { assert.equal(H.getModelMaxTokens('claude-opus-4-6-20250514'), 1000000); });
    it('returns 1000000 for opus model with [1m] suffix', () => { assert.equal(H.getModelMaxTokens('claude-opus-4-6[1m]'), 1000000); });
    it('returns 1000000 for opus-4-8', () => { assert.equal(H.getModelMaxTokens('claude-opus-4-8'), 1000000); });
    it('returns 1000000 for opus-4-9', () => { assert.equal(H.getModelMaxTokens('claude-opus-4-9'), 1000000); });
    it('returns 1000000 for mythons', () => { assert.equal(H.getModelMaxTokens('mythons'), 1000000); });
    it('returns 1000000 for mythons with surrounding chars', () => { assert.equal(H.getModelMaxTokens('claude-mythons-preview'), 1000000); });
    it('returns 1000000 for fable-5', () => { assert.equal(H.getModelMaxTokens('claude-fable-5'), 1000000); });
    it('returns 1000000 for fable-5 with [1m] suffix', () => { assert.equal(H.getModelMaxTokens('claude-fable-5[1m]'), 1000000); });
    it('returns 1000000 for fable-5.x (前瞻版本)', () => { assert.equal(H.getModelMaxTokens('claude-fable-5-1-20260601'), 1000000); });
    it('returns 200000 for non-opus claude models', () => { assert.equal(H.getModelMaxTokens('claude-sonnet-4-6'), 200000); });
    it('returns 128000 for gpt-4o', () => { assert.equal(H.getModelMaxTokens('gpt-4o'), 128000); });
    it('returns 128000 for deepseek', () => { assert.equal(H.getModelMaxTokens('deepseek-v3'), 128000); });
    it('returns 128000 for deepseek-r1 (still 128K, no v4 substring)', () => { assert.equal(H.getModelMaxTokens('deepseek-r1'), 128000); });
    it('returns 1000000 for deepseek-v4', () => { assert.equal(H.getModelMaxTokens('deepseek-v4'), 1000000); });
    it('returns 1000000 for deepseek-v4 with suffix', () => { assert.equal(H.getModelMaxTokens('deepseek-v4-turbo'), 1000000); });
    it('returns 1000000 for deepseek-v4 with surrounding chars', () => { assert.equal(H.getModelMaxTokens('mycompany-deepseek-v4-ft'), 1000000); });
    it('returns 16000 for gpt-3', () => { assert.equal(H.getModelMaxTokens('gpt-3.5-turbo'), 16000); });
    it('returns 200000 for null', () => { assert.equal(H.getModelMaxTokens(null), 200000); });
    it('returns 200000 for unknown model', () => { assert.equal(H.getModelMaxTokens('llama-3'), 200000); });
    it('returns 256000 for kimi-prefixed models and bare k3', () => {
      assert.equal(H.getModelMaxTokens('kimi-k2.5'), 256000);
      assert.equal(H.getModelMaxTokens('kimi-k3'), 256000);
      assert.equal(H.getModelMaxTokens('moonshot-v1-k2'), 256000);
      assert.equal(H.getModelMaxTokens('k3'), 256000);
    });
  });

  describe('resolveCalibrationTokens', () => {
    const reqWith = (model) => ({ response: { body: { model } } });
    it('returns 1M for explicit "1m"', () => {
      assert.equal(H.resolveCalibrationTokens('1m', null), 1000000);
    });
    it('returns 200K for explicit "200k"', () => {
      assert.equal(H.resolveCalibrationTokens('200k', null), 200000);
    });
    it('auto + null lastMainAgent → 1M (cold-start default)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', null), 1000000);
    });
    it('auto + opus-4-7 model → 1M', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-opus-4-7-20250514')), 1000000);
    });
    it('auto + opus-4-8 model → 1M (无 [1m] 后缀也命中家族)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-opus-4-8-20251201')), 1000000);
    });
    it('auto + opus-4-9 model → 1M (前瞻版本)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-opus-4-9')), 1000000);
    });
    it('auto + mythons model → 1M', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-mythons')), 1000000);
    });
    it('auto + fable-5 model → 1M', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-fable-5')), 1000000);
    });
    it('auto + fable-5.x model → 1M (前瞻版本)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-fable-5-2-20260601')), 1000000);
    });
    it('auto + claude-3-opus → 200K (裸 opus 不命中 opus-4-N 家族)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-3-opus-20240229')), 200000);
    });
    it('auto + uppercase opus-4.7 → 1M (case-insensitive)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('CLAUDE-OPUS-4.7')), 1000000);
    });
    it('auto + 1m substring (deepseek-v3-1m) → 1M', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('deepseek-v3-1m')), 1000000);
    });
    it('auto + sonnet-4-6 → 200K (no opus, no 1m)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-sonnet-4-6')), 200000);
    });
    it('auto + kimi 前缀型号 → 1M 桶 (256K 档特判,宁大勿小)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('kimi-k2.5')), 1000000);
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('kimi-k3')), 1000000);
    });
    it('auto + 裸 k3 → 1M 桶 (热切换 k3[1m] 时上游剥后缀,response-first 仍须 1M)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('k3')), 1000000);
    });
    it('auto + 请求 k3[1m]/响应裸 k3(上游归一化)→ 1M (请求后缀意图优先,不被响应覆盖)', () => {
      // 热切换配置 k3[1m]:body.model 带 [1m],上游 response.body.model 归一化成裸 k3。
      // getCalibrationModel 须采纳请求侧 [1m] 意图 → 1M,而非 response-first 的裸 k3。
      const req = { body: { model: 'k3[1m]' }, response: { body: { model: 'k3' } } };
      assert.equal(H.resolveCalibrationTokens('auto', req), 1000000);
    });
    it('legacy value (opus-4.7-1m) + null lastMainAgent → 1M (cold-start fallback via auto path)', () => {
      // 老用户 localStorage 残留值；AppHeader.jsx 验证逻辑会先把它兜底为 'auto'，
      // 但即使直接传进来这里，也会走 auto 路径 + 冷启动默认 1M，行为可接受。
      assert.equal(H.resolveCalibrationTokens('opus-4.7-1m', null), 1000000);
    });
    // projectModelHint 第 3 参数:~/.claude.json projects[cwd].lastModelUsage 推断,
    // 用作 auto 启动期回落(避 haiku init ping 让血条错显 200K)。
    it('auto + null lastMainAgent + projectModelHint=opus-4-7[1m] → 1M (hint 命中)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', null, 'claude-opus-4-7[1m]'), 1000000);
    });
    it('auto + null lastMainAgent + projectModelHint=sonnet-4-6 → 200K (hint 命中非 opus)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', null, 'claude-sonnet-4-6'), 200000);
    });
    it('auto + lastMainAgent=haiku (init ping) + projectModelHint=opus-4-7[1m] → 1M (跳 haiku 用 hint)', () => {
      // 关键修复路径:启动期 claude 先发 haiku topic detection,cc-viewer 误当
      // mainAgent → 不该让血条直接判 200K;有 hint 时用 hint 兜底。
      assert.equal(
        H.resolveCalibrationTokens('auto', reqWith('claude-haiku-4-5-20251001'), 'claude-opus-4-7[1m]'),
        1000000
      );
    });
    it('auto + lastMainAgent=opus-4-7 (真信号) 覆盖 projectModelHint=sonnet', () => {
      // lastMainAgent 是真实 mainAgent 信号,优先于 hint;hint 仅在 lastModel 缺失或 haiku 时生效。
      assert.equal(
        H.resolveCalibrationTokens('auto', reqWith('claude-opus-4-7'), 'claude-sonnet-4-6'),
        1000000
      );
    });
    it('auto + lastMainAgent=haiku + projectModelHint=null → 1M (冷启动兜底)', () => {
      assert.equal(H.resolveCalibrationTokens('auto', reqWith('claude-haiku-4-5'), null), 1000000);
    });
    it('显式 1m/200k 时 projectModelHint 不参与', () => {
      assert.equal(H.resolveCalibrationTokens('1m', null, 'claude-sonnet-4-6'), 1000000);
      assert.equal(H.resolveCalibrationTokens('200k', reqWith('claude-opus-4-7'), 'claude-opus-4-7[1m]'), 200000);
    });
  });

  describe('adaptContextWindow', () => {
    it('200K 判定 + 用量越过整窗(>200K) → 升 1M (纠误判)', () => {
      assert.equal(H.adaptContextWindow(200000, 250000), 1000000);
    });
    it('200K 判定 + 用量恰好 200K(未越窗) → 保持 200K', () => {
      assert.equal(H.adaptContextWindow(200000, 200000), 200000);
    });
    it('200K 判定 + 用量 0 / 远低于整窗 → 保持 200K', () => {
      assert.equal(H.adaptContextWindow(200000, 0), 200000);
      assert.equal(H.adaptContextWindow(200000, 150000), 200000);
    });
    it('已是 1M → 原样返回(单向纠偏,不降级)', () => {
      assert.equal(H.adaptContextWindow(1000000, 50000), 1000000);
      assert.equal(H.adaptContextWindow(1000000, 900000), 1000000);
    });
    it('256K 档(kimi)+ 用量越过整窗(>256K) → 升 1M (256K→1M 纠偏档)', () => {
      assert.equal(H.adaptContextWindow(256000, 300000), 1000000);
    });
    it('256K 档 + 用量恰好 256K(未越窗) → 保持 256K', () => {
      assert.equal(H.adaptContextWindow(256000, 256000), 256000);
    });
  });

  describe('getEffectiveModel', () => {
    it('returns response.body.model when present (proxy hot-switch)', () => {
      const req = { body: { model: 'claude-opus-4-6' }, response: { body: { model: 'deepseek-v4' } } };
      assert.equal(H.getEffectiveModel(req), 'deepseek-v4');
    });
    it('falls back to request.body.model when response missing', () => {
      const req = { body: { model: 'claude-sonnet-4-6' } };
      assert.equal(H.getEffectiveModel(req), 'claude-sonnet-4-6');
    });
    it('falls back to request.body.model when response has no model field', () => {
      const req = { body: { model: 'claude-haiku-4-5' }, response: { body: {} } };
      assert.equal(H.getEffectiveModel(req), 'claude-haiku-4-5');
    });
    it('returns null when both sides missing', () => {
      assert.equal(H.getEffectiveModel({ body: {}, response: { body: {} } }), null);
    });
    it('returns null for null input', () => {
      assert.equal(H.getEffectiveModel(null), null);
    });
    it('returns null for undefined input', () => {
      assert.equal(H.getEffectiveModel(undefined), null);
    });
    it('returns null when body and response are entirely absent', () => {
      assert.equal(H.getEffectiveModel({}), null);
    });
  });

  describe('resolveProducerModelInfo', () => {
    // 模拟 3 轮对话场景：
    //   R1=claude-opus-4-7 (idx=0, ts=t1)
    //   R2=claude-sonnet-4-6 (idx=1, ts=t2)
    //   R3=deepseek-v4 (idx=2, ts=t3)
    // _processEntries 给 a(N-1) 赋的 _timestamp 是 T(N) — 所以 a1._ts=t2, a2._ts=t3
    const tsToIndex = { t1: 0, t2: 1, t3: 2 };
    const modelNameByReqIdx = ['claude-opus-4-7', 'claude-sonnet-4-6', 'deepseek-v4'];

    it('user message: producer = tsToIndex[ts]', () => {
      // q2._ts=t2 → R2 → sonnet-4-6
      const info = H.resolveProducerModelInfo('t2', 'user', tsToIndex, modelNameByReqIdx);
      assert.equal(info.name, 'sonnet-4-6');
    });

    it('assistant message: producer = tsToIndex[ts] - 1 (off-by-one fix)', () => {
      // a1._ts=t2 (被赋值为下一轮 entry ts) → producer R1 → opus-4-7
      const info = H.resolveProducerModelInfo('t2', 'assistant', tsToIndex, modelNameByReqIdx);
      assert.equal(info.name, 'opus-4-7');
    });

    it('assistant message late entry: producer = tsToIndex[ts] - 1', () => {
      // a2._ts=t3 → producer R2 → sonnet-4-6
      const info = H.resolveProducerModelInfo('t3', 'assistant', tsToIndex, modelNameByReqIdx);
      assert.equal(info.name, 'sonnet-4-6');
    });

    it('assistant at idx 0 (mid-session start): clamp to current entry model', () => {
      // mid-session 启动场景：cc-viewer 在对话进行中才打开，第一个 entry 的
      // body.messages 已含历史 [user, assistant, user, ...]，那条 assistant
      // 被赋 _timestamp=T0 → idx=0，producer 不在视野内 → 用当前 entry model 兜底
      const info = H.resolveProducerModelInfo('t1', 'assistant', tsToIndex, modelNameByReqIdx);
      assert.equal(info.name, 'opus-4-7');
    });

    it('assistant at idx 0 with empty modelNameByReqIdx[0] → null', () => {
      // mid-session 边界 + 第一个 entry 还没拿到 effectiveModel（极端 transient）→ 仍返回 null
      const info = H.resolveProducerModelInfo('t1', 'assistant', tsToIndex, [null, 'claude-sonnet-4-6']);
      assert.strictEqual(info, null);
    });

    it('ts not in tsToIndex → null (no global fallback)', () => {
      // 未匹配返回 null，让 ChatMessage 显示中性 'MainAgent'，不污染最新 model
      const info = H.resolveProducerModelInfo('t999', 'assistant', tsToIndex, modelNameByReqIdx);
      assert.strictEqual(info, null);
    });

    it('null ts → null', () => {
      assert.strictEqual(H.resolveProducerModelInfo(null, 'user', tsToIndex, modelNameByReqIdx), null);
    });

    it('undefined ts → null', () => {
      assert.strictEqual(H.resolveProducerModelInfo(undefined, 'assistant', tsToIndex, modelNameByReqIdx), null);
    });

    it('producer slot is empty → null', () => {
      const sparse = ['claude-opus-4-7', null, 'deepseek-v4'];
      // a2._ts=t3 → producer idx 1 → null（无 model 信息时不兜底最新）
      const info = H.resolveProducerModelInfo('t3', 'assistant', tsToIndex, sparse);
      assert.strictEqual(info, null);
    });

    it('loadEarlier scenario: prepended history idx 都已重建', () => {
      // 用户 loadEarlier 后 modelNameByReqIdx 全量重扫，每个 idx 都正确填充
      const expanded = { t0: 0, t1: 1, t2: 2, t3: 3 };
      const expandedModels = ['claude-haiku-4-5', 'claude-opus-4-7', 'claude-sonnet-4-6', 'deepseek-v4'];
      // a0 (loaded earlier)._ts=t1 → producer R0 → haiku-4-5
      const info = H.resolveProducerModelInfo('t1', 'assistant', expanded, expandedModels);
      assert.equal(info.name, 'haiku-4-5');
    });

    it('ts mapping to idx 0, role=user: producerIdx=0 命中', () => {
      // q1._ts=t1 → R1 → opus-4-7（user 不需要 -1）
      const info = H.resolveProducerModelInfo('t1', 'user', tsToIndex, modelNameByReqIdx);
      assert.equal(info.name, 'opus-4-7');
    });
  });

  describe('escapeHtml', () => {
    it('escapes & < > "', () => { assert.equal(H.escapeHtml('<div class="a">&'), '&lt;div class=&quot;a&quot;&gt;&amp;'); });
    it('returns empty for null', () => { assert.equal(H.escapeHtml(null), ''); });
    it('returns empty for empty string', () => { assert.equal(H.escapeHtml(''), ''); });
    it('leaves safe text unchanged', () => { assert.equal(H.escapeHtml('hello world'), 'hello world'); });
  });

  describe('truncateText', () => {
    it('truncates long text', () => { assert.equal(H.truncateText('hello world', 5), 'hello...'); });
    it('returns text unchanged if within limit', () => { assert.equal(H.truncateText('hi', 10), 'hi'); });
    it('returns empty for null', () => { assert.equal(H.truncateText(null, 10), ''); });
    it('returns empty for empty string', () => { assert.equal(H.truncateText('', 10), ''); });
  });

  describe('extractToolResultText (toolResultCore)', () => {
    it('returns string content as-is', () => { assert.equal(extractToolResultText({ content: 'output text' }), 'output text'); });
    it('joins text blocks from array', () => {
      assert.equal(extractToolResultText({ content: [{ type: 'text', text: 'line1' }, { type: 'text', text: 'line2' }] }), 'line1\nline2');
    });
    it('filters non-text blocks', () => {
      assert.equal(extractToolResultText({ content: [{ type: 'image' }, { type: 'text', text: 'ok' }] }), 'ok');
    });
    it('JSON.stringifies object content', () => {
      assert.equal(extractToolResultText({ content: { key: 'val' } }), '{"key":"val"}');
    });
    it('handles null content', () => { assert.equal(extractToolResultText({ content: null }), ''); });
    it('handles undefined content', () => { assert.equal(extractToolResultText({ content: undefined }), ''); });
  });

  describe('formatTokenCount', () => {
    it('returns "0" for 0', () => { assert.equal(H.formatTokenCount(0), '0'); });
    it('returns "0" for null', () => { assert.equal(H.formatTokenCount(null), '0'); });
    it('returns string for small numbers', () => { assert.equal(H.formatTokenCount(500), '500'); });
    it('formats K', () => { assert.equal(H.formatTokenCount(1500), '1.5K'); });
    it('formats M', () => { assert.equal(H.formatTokenCount(2500000), '2.5M'); });
    it('formats exactly 1000 as K', () => { assert.equal(H.formatTokenCount(1000), '1.0K'); });
  });

  describe('stripPrivateKeys', () => {
    it('removes _ prefixed keys', () => {
      assert.deepEqual(H.stripPrivateKeys({ a: 1, _b: 2, c: 3 }), { a: 1, c: 3 });
    });
    it('recurses into nested objects', () => {
      assert.deepEqual(H.stripPrivateKeys({ a: { _x: 1, y: 2 } }), { a: { y: 2 } });
    });
    it('recurses into arrays', () => {
      assert.deepEqual(H.stripPrivateKeys([{ _a: 1, b: 2 }]), [{ b: 2 }]);
    });
    it('returns primitives as-is', () => {
      assert.equal(H.stripPrivateKeys(42), 42);
      assert.equal(H.stripPrivateKeys('str'), 'str');
      assert.equal(H.stripPrivateKeys(null), null);
    });
  });

  describe('computeTokenStats', () => {
    it('aggregates tokens by model', () => {
      const reqs = [
        makeMainReq({ body: { model: 'claude-opus-4-6' }, response: { body: { usage: { input_tokens: 100, output_tokens: 50 } } } }),
        makeMainReq({ body: { model: 'claude-opus-4-6' }, response: { body: { usage: { input_tokens: 200, output_tokens: 30 } } } }),
        makeMainReq({ body: { model: 'claude-haiku-4-5' }, response: { body: { usage: { input_tokens: 50, output_tokens: 10 } } } }),
      ];
      const stats = H.computeTokenStats(reqs);
      assert.equal(stats['claude-opus-4-6'].input, 300);
      assert.equal(stats['claude-opus-4-6'].output, 80);
      assert.equal(stats['claude-haiku-4-5'].input, 50);
    });
    it('skips requests without usage', () => {
      const reqs = [makeMainReq({ response: { body: {} } })];
      assert.deepEqual(H.computeTokenStats(reqs), {});
    });
    it('uses "unknown" when model missing', () => {
      const reqs = [makeMainReq({ body: {}, response: { body: { usage: { input_tokens: 10 } } } })];
      assert.ok(H.computeTokenStats(reqs)['unknown']);
    });
  });

  describe('computeToolUsageStats', () => {
    it('counts tool_use blocks by name, sorted desc', () => {
      const reqs = [
        { response: { body: { content: [{ type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'Bash' }] } } },
        { response: { body: { content: [{ type: 'tool_use', name: 'Bash' }, { type: 'text', text: 'hi' }] } } },
      ];
      const stats = H.computeToolUsageStats(reqs);
      assert.deepEqual(stats, [['Read', 2], ['Bash', 2]]);
    });
    it('returns empty for no tool_use', () => {
      assert.deepEqual(H.computeToolUsageStats([{ response: { body: { content: [{ type: 'text', text: 'hi' }] } } }]), []);
    });
    it('handles missing response content', () => {
      assert.deepEqual(H.computeToolUsageStats([{ response: { body: {} } }]), []);
    });
  });

  describe('computeSkillUsageStats', () => {
    it('counts skill usage from user messages', () => {
      const reqs = [{
        body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /path\n# MySkill\ncontent' }] }] },
      }];
      const stats = H.computeSkillUsageStats(reqs);
      assert.equal(stats.length, 1);
      assert.equal(stats[0][0], 'MySkill');
      assert.equal(stats[0][1], 1);
    });
    it('ignores non-user messages', () => {
      const reqs = [{
        body: { messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Base directory for this skill: /path\n# Skill' }] }] },
      }];
      assert.deepEqual(H.computeSkillUsageStats(reqs), []);
    });
    it('returns empty for no skills', () => {
      const reqs = [{ body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] } }];
      assert.deepEqual(H.computeSkillUsageStats(reqs), []);
    });
  });

  describe('isRelevantRequest', () => {
    it('returns true for normal request', () => {
      assert.equal(H.isRelevantRequest({ url: 'https://api.anthropic.com/v1/messages', response: { status: 200 } }), true);
    });
    it('rejects heartbeat', () => { assert.equal(H.isRelevantRequest({ isHeartbeat: true }), false); });
    it('rejects countTokens', () => { assert.equal(H.isRelevantRequest({ isCountTokens: true }), false); });
    it('rejects eval/sdk URL', () => { assert.equal(H.isRelevantRequest({ url: 'https://statsig.anthropic.com/api/eval/sdk-abc' }), false); });
    it('rejects count_tokens URL', () => { assert.equal(H.isRelevantRequest({ url: 'https://api.anthropic.com/v1/messages/count_tokens' }), false); });
    it('rejects inProgress', () => { assert.equal(H.isRelevantRequest({ inProgress: true, url: '' }), false); });
    it('rejects response status 0', () => { assert.equal(H.isRelevantRequest({ url: '', response: { status: 0 } }), false); });
  });

  describe('filterRelevantRequests', () => {
    it('filters out irrelevant requests', () => {
      const reqs = [
        { url: 'https://api.anthropic.com/v1/messages', response: { status: 200 } },
        { isHeartbeat: true, url: '' },
        { url: 'https://api.anthropic.com/v1/messages', inProgress: true },
      ];
      assert.equal(H.filterRelevantRequests(reqs).length, 1);
    });
  });

  describe('isClaudeMdReminder / hasClaudeMdReminder', () => {
    it('detects CLAUDE.md reminder text', () => {
      assert.equal(H.isClaudeMdReminder('<system-reminder>\n# claudeMd\nsome content'), true);
    });
    it('rejects non-matching text', () => { assert.equal(H.isClaudeMdReminder('hello'), false); });
    it('rejects non-string', () => { assert.equal(H.isClaudeMdReminder(null), false); });
    it('hasClaudeMdReminder finds in string content', () => {
      assert.equal(H.hasClaudeMdReminder({ messages: [{ content: '<system-reminder>\n# claudeMd\nstuff' }] }), true);
    });
    it('hasClaudeMdReminder finds in array content', () => {
      assert.equal(H.hasClaudeMdReminder({ messages: [{ content: [{ type: 'text', text: '<system-reminder>\n# claudeMd' }] }] }), true);
    });
    it('hasClaudeMdReminder returns false when absent', () => {
      assert.equal(H.hasClaudeMdReminder({ messages: [{ content: 'hello' }] }), false);
    });
    it('hasClaudeMdReminder handles null body', () => { assert.equal(H.hasClaudeMdReminder(null), false); });
  });

  describe('isSkillsReminder / hasSkillsReminder', () => {
    it('detects skills reminder', () => {
      assert.equal(H.isSkillsReminder('<system-reminder>The following skills are available</system-reminder>'), true);
    });
    it('rejects non-matching', () => { assert.equal(H.isSkillsReminder('hello'), false); });
    it('hasSkillsReminder finds in messages', () => {
      assert.equal(H.hasSkillsReminder({ messages: [{ content: '<system-reminder>skills are available</system-reminder>' }] }), true);
    });
    it('hasSkillsReminder returns false when absent', () => {
      assert.equal(H.hasSkillsReminder({ messages: [{ content: 'hi' }] }), false);
    });
  });

  describe('getModelShort', () => {
    it('strips claude- prefix and date suffix', () => { assert.equal(H.getModelShort('claude-opus-4-6-20250101'), 'opus-4-6'); });
    it('strips only prefix if no date', () => { assert.equal(H.getModelShort('claude-haiku-4-5'), 'haiku-4-5'); });
    it('returns null for null', () => { assert.equal(H.getModelShort(null), null); });
    it('returns non-claude model as-is', () => { assert.equal(H.getModelShort('gpt-4o'), 'gpt-4o'); });
  });

  describe('findPrevMainAgentTimestamp', () => {
    it('finds previous mainAgent timestamp', () => {
      const reqs = [
        makeMainReq({ timestamp: 'T1' }),
        { mainAgent: false, timestamp: 'T2' },
        makeMainReq({ timestamp: 'T3' }),
      ];
      assert.equal(H.findPrevMainAgentTimestamp(reqs, 2), 'T1');
    });
    it('returns null when none found', () => {
      const reqs = [{ mainAgent: false }, makeMainReq({ timestamp: 'T1' })];
      assert.equal(H.findPrevMainAgentTimestamp(reqs, 0), null);
    });
    it('skips teammate requests', () => {
      // teammate 标记的请求绝不会被 isMainAgent 认可（真实 contentFilter 行为）。
      const reqs = [
        makeMainReq({ teammate: 'worker-1', timestamp: 'T1' }),
        makeMainReq({ timestamp: 'T2' }),
      ];
      assert.equal(H.findPrevMainAgentTimestamp(reqs, 1), null);
    });
  });

  describe('extractCachedContent', () => {
    it('returns null for empty array', () => { assert.equal(H.extractCachedContent([]), null); });
    it('returns null for non-array', () => { assert.equal(H.extractCachedContent(null), null); });

    it('extracts system with cache_control', () => {
      const req = makeMainReq({
        body: {
          system: [
            { type: 'text', text: 'sys1', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'sys2' },
          ],
          tools: [], messages: [],
        },
      });
      const result = H.extractCachedContent([req]);
      assert.deepEqual(result.system, ['sys1']);
    });

    it('extracts messages up to cache_control', () => {
      const req = makeMainReq({
        body: {
          system: [], tools: [],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'msg1', cache_control: { type: 'ephemeral' } }] },
            { role: 'assistant', content: [{ type: 'text', text: 'msg2' }] },
          ],
        },
      });
      const result = H.extractCachedContent([req]);
      assert.equal(result.messages.length, 1);
      assert.ok(result.messages[0].includes('msg1'));
    });

    it('extracts tools when system is cached (KV prefix 语义)', () => {
      // 真实模块：tools 作为 cache 前缀的一部分，只有 system 有缓存内容时才提取
      // （commit 0011d8a 修复，与旧内联「任一 tool 带 cache_control」判据不同）。
      // 故 fixture 补一个带 cache_control 的 system 块。
      const req = makeMainReq({
        body: {
          system: [{ type: 'text', text: 'You are Claude Code', cache_control: { type: 'ephemeral' } }],
          messages: [],
          tools: [
            { name: 'Read', description: 'Read files', cache_control: { type: 'ephemeral' } },
            { name: 'Write', description: 'Write files' },
          ],
        },
      });
      const result = H.extractCachedContent([req]);
      assert.equal(result.tools.length, 2);
      assert.ok(result.tools[0].includes('Read'));
    });

    it('does NOT extract tools when system has no cached content', () => {
      // 互补断言：system 无缓存内容（result.system 为空）→ tools 不提取。
      const req = makeMainReq({
        body: {
          system: [], messages: [],
          tools: [{ name: 'Read', description: 'r', cache_control: { type: 'ephemeral' } }],
        },
      });
      const result = H.extractCachedContent([req]);
      assert.deepEqual(result.tools, []);
    });

    it('returns null when request has no body', () => {
      const reqs = [{ mainAgent: false }];
      assert.equal(H.extractCachedContent(reqs), null);
    });

    it('extracts SubAgent cache content', () => {
      const subReq = {
        mainAgent: false,
        body: {
          system: [
            { type: 'text', text: 'billing' },
            { type: 'text', text: 'You are Claude Code', cache_control: { type: 'ephemeral' } },
            { type: 'text', text: 'file search specialist', cache_control: { type: 'ephemeral' } },
          ],
          tools: [{ name: 'Glob' }, { name: 'Read' }],
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'task', cache_control: { type: 'ephemeral' } }] },
          ],
        },
        response: { body: { usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 5000 } } },
      };
      const result = H.extractCachedContent([subReq]);
      assert.ok(result !== null);
      // 单请求直接使用，提取到最后一个 cache_control 为止的全部 text 块（含 billing）
      assert.deepEqual(result.system, ['billing', 'You are Claude Code', 'file search specialist']);
      assert.equal(result.messages.length, 1);
      assert.equal(result.cacheCreateTokens, 100);
      assert.equal(result.cacheReadTokens, 5000);
    });

    it('prefers request with usage when multiple in array', () => {
      const mainReq = makeMainReq({
        timestamp: 'T1',
        body: { system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }], tools: [], messages: [] },
      });
      const teammateReq = {
        mainAgent: true, teammate: 'worker-1', timestamp: 'T2',
        body: { system: [{ type: 'text', text: 'teammate sys', cache_control: { type: 'ephemeral' } }], tools: [], messages: [] },
        response: { body: {} },
      };
      const result = H.extractCachedContent([mainReq, teammateReq]);
      // teammate 不是 MainAgent（真实 contentFilter），逆序唯一 MainAgent = mainReq（带 usage）
      assert.deepEqual(result.system, ['sys']);
    });

    it('includes cacheCreateTokens and cacheReadTokens', () => {
      const req = makeMainReq({
        response: { body: { usage: { cache_creation_input_tokens: 1000, cache_read_input_tokens: 5000 } } },
        body: { system: [{ type: 'text', text: 'x', cache_control: {} }], tools: [], messages: [] },
      });
      const result = H.extractCachedContent([req]);
      assert.equal(result.cacheCreateTokens, 1000);
      assert.equal(result.cacheReadTokens, 5000);
    });
  });

  describe('parseCachedTools', () => {
    it('returns empty groups for non-array / null / undefined input', () => {
      assert.deepEqual(H.parseCachedTools(null), { builtin: [], mcpByServer: new Map() });
      assert.deepEqual(H.parseCachedTools(undefined), { builtin: [], mcpByServer: new Map() });
      assert.deepEqual(H.parseCachedTools('not-array'), { builtin: [], mcpByServer: new Map() });
      assert.deepEqual(H.parseCachedTools([]), { builtin: [], mcpByServer: new Map() });
    });

    it('classifies builtin vs MCP by name prefix', () => {
      const { builtin, mcpByServer } = H.parseCachedTools([
        'Bash: Run commands',
        'Read: Read a file',
        'mcp__slack__post_message: Post to Slack',
      ]);
      assert.equal(builtin.length, 2);
      assert.deepEqual(builtin[0], { name: 'Bash', description: 'Run commands' });
      assert.deepEqual(builtin[1], { name: 'Read', description: 'Read a file' });
      assert.equal(mcpByServer.size, 1);
      assert.ok(mcpByServer.has('slack'));
      assert.deepEqual(mcpByServer.get('slack')[0], {
        name: 'post_message', fullName: 'mcp__slack__post_message', description: 'Post to Slack',
      });
    });

    it('supports MCP server name containing underscores (non-greedy regex)', () => {
      const { mcpByServer } = H.parseCachedTools([
        'mcp__some_server_name__do_thing: desc',
        'mcp__claude_ai_Google_Drive__authenticate: Auth',
      ]);
      assert.ok(mcpByServer.has('some_server_name'));
      assert.equal(mcpByServer.get('some_server_name')[0].name, 'do_thing');
      assert.ok(mcpByServer.has('claude_ai_Google_Drive'));
      assert.equal(mcpByServer.get('claude_ai_Google_Drive')[0].name, 'authenticate');
    });

    it('groups multiple tools per MCP server', () => {
      const { mcpByServer } = H.parseCachedTools([
        'mcp__gdrive__list_files: List',
        'mcp__gdrive__read_file: Read',
        'mcp__gdrive__search: Search',
      ]);
      assert.equal(mcpByServer.size, 1);
      assert.equal(mcpByServer.get('gdrive').length, 3);
      assert.deepEqual(mcpByServer.get('gdrive').map(t => t.name), ['list_files', 'read_file', 'search']);
    });

    it('handles items with no colon / empty description / extra colons in description', () => {
      const { builtin, mcpByServer } = H.parseCachedTools([
        'LoneName',                          // no colon → name only
        'WithEmpty:',                         // empty description
        'Grep: Search for: pattern matches', // description contains colon (only first split)
        '',                                   // empty string → skip
        'mcp__x__y:',                         // MCP with empty description
      ]);
      assert.equal(builtin.length, 3);
      assert.deepEqual(builtin[0], { name: 'LoneName', description: '' });
      assert.deepEqual(builtin[1], { name: 'WithEmpty', description: '' });
      assert.deepEqual(builtin[2], { name: 'Grep', description: 'Search for: pattern matches' });
      assert.ok(mcpByServer.has('x'));
      assert.deepEqual(mcpByServer.get('x')[0], { name: 'y', fullName: 'mcp__x__y', description: '' });
    });

    it('skips non-string / null entries gracefully', () => {
      const { builtin, mcpByServer } = H.parseCachedTools([
        null, undefined, 42, { weird: true },
        'Bash: ok',
      ]);
      assert.equal(builtin.length, 1);
      assert.equal(builtin[0].name, 'Bash');
      assert.equal(mcpByServer.size, 0);
    });

    it('treats an entry starting with mcp__ but without the second __ as a builtin (no valid MCP tool name)', () => {
      const { builtin, mcpByServer } = H.parseCachedTools([
        'mcp__incomplete: not a valid mcp tool name',
      ]);
      assert.equal(builtin.length, 1);
      assert.equal(builtin[0].name, 'mcp__incomplete');
      assert.equal(mcpByServer.size, 0);
    });

    it('parses XML-shaped tool blocks (new format from formatToolAsXml)', () => {
      const xmlBuiltin = [
        '<tool>\n  <name>Edit</name>\n  <description>Edit files</description>\n  <parameters></parameters>\n</tool>',
        '<tool>\n  <name>Bash</name>\n  <description>Run commands</description>\n  <parameters></parameters>\n</tool>',
        '<tool>\n  <name>mcp__slack__post</name>\n  <description>Post to slack</description>\n  <parameters></parameters>\n</tool>',
      ];
      const { builtin, mcpByServer } = H.parseCachedTools(xmlBuiltin);
      assert.equal(builtin.length, 2);
      assert.deepEqual(builtin[0], { name: 'Edit', description: 'Edit files' });
      assert.deepEqual(builtin[1], { name: 'Bash', description: 'Run commands' });
      assert.ok(mcpByServer.has('slack'));
      assert.equal(mcpByServer.get('slack')[0].name, 'post');
    });

    it('only uses the first <name> (tool-level), ignoring parameter <name> tags', () => {
      const xml = '<tool>\n  <name>Configure</name>\n  <description>Set up</description>\n  <parameters>\n    <parameter>\n      <name>port</name>\n      <type>integer</type>\n    </parameter>\n  </parameters>\n</tool>';
      const { builtin } = H.parseCachedTools([xml]);
      assert.equal(builtin.length, 1);
      assert.equal(builtin[0].name, 'Configure');
    });
  });
});

// 前后端一致性冒烟:helpers 的窗口规则导出必须是 server/lib/context-rules.js 的同一函数引用
// (thin re-export = 单一事实源的最强证明;若有人在 helpers 里重新实现,这里立即爆)。
describe('context-rules 单一事实源冒烟', () => {
  it('helpers re-export 与 context-rules 为同一函数引用', async () => {
    const R = await import('../server/lib/context-rules.js');
    assert.equal(H.getModelMaxTokens, R.getModelMaxTokens);
    assert.equal(H.adaptContextWindow, R.adaptContextWindow);
    assert.equal(H.sumUsageInputTokens, R.sumUsageInputTokens);
    assert.equal(H.sumUsageContextTokens, R.sumUsageContextTokens);
  });
});
