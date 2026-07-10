/**
 * Unit tests for src/utils/helpers.js — 前半部分导出（源文件 31~394 行）。
 *
 * 覆盖目标导出：
 *   getModelMaxTokens, getEffectiveModel,
 *   resolveCalibrationTokens, adaptContextWindow, resolveProducerModelInfo,
 *   appendCacheLossMap, buildCacheLossMap, escapeHtml, truncateText,
 *   getModelInfo, AUTO_APPROVE_INSTANT, getSvgAvatar, formatTokenCount。
 *
 * helpers.js import 了多个 svg（含 ?raw），纯 Node 无法直接 import，
 * 因此先 register vite-loader shim 再【动态 import】目标模块。
 * svg 资源被 stub 成 "__ccv_asset_stub__:<文件名>" 字符串。
 *
 * 注意：appendCacheLossMap/buildCacheLossMap 依赖 contentFilter.isMainAgent
 * 与真实的 stripPrivateKeys / restoreSlimmedEntry，本测试用真实依赖链
 * （通过 loader 加载），构造满足 isMainAgent 的最小 request 对象。
 */
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let H;
before(async () => {
  H = await import('../src/utils/helpers.js');
});

// 构造一个能被 contentFilter.isMainAgent 判定为 MainAgent 的最小请求。
// isMainAgent 在 req.mainAgent === true 且 system 文本不含 SUBAGENT 关键字时直接返回 true。
function mainReq({ timestamp = 0, body = {}, usage = null, slimmed = null } = {}) {
  const req = {
    mainAgent: true,
    timestamp,
    body: { system: 'You are Claude Code', tools: [], messages: [], ...body },
  };
  if (usage) req.response = { body: { usage } };
  if (slimmed) Object.assign(req, slimmed);
  return req;
}

// 一个不会被判为 MainAgent 的请求（含 SubAgent 关键字）。
function subReq({ timestamp = 0 } = {}) {
  return {
    mainAgent: true,
    timestamp,
    body: { system: 'You are a general-purpose agent', tools: [], messages: [] },
  };
}

describe('getModelMaxTokens', () => {
  it('空/缺失模型名回落 200000', () => {
    assert.equal(H.getModelMaxTokens(''), 200000);
    assert.equal(H.getModelMaxTokens(null), 200000);
    assert.equal(H.getModelMaxTokens(undefined), 200000);
  });

  it('[1m] 标注优先命中 1M（即使同时含 claude）', () => {
    assert.equal(H.getModelMaxTokens('claude-opus-4-8[1m]'), 1000000);
    assert.equal(H.getModelMaxTokens('something-[1M]'), 1000000);
  });

  it('opus-4-6+ / mythons 默认 1M;3-opus 与旧 opus 修正为 200K', () => {
    assert.equal(H.getModelMaxTokens('claude-opus-4-6'), 1000000);
    assert.equal(H.getModelMaxTokens('mythons-pro'), 1000000);
    // claude-3-opus 真实窗口 200K(规则表统一后取事实值,此前 /opus/→1M 是误判)
    assert.equal(H.getModelMaxTokens('claude-3-opus-20240229'), 200000);
    assert.equal(H.getModelMaxTokens('claude-opus-4-1-20250805'), 200000);
  });

  it('fable-5 家族默认 1M', () => {
    assert.equal(H.getModelMaxTokens('claude-fable-5'), 1000000);
    assert.equal(H.getModelMaxTokens('claude-fable-5-1'), 1000000);
  });

  it('裸 claude → 200K', () => {
    assert.equal(H.getModelMaxTokens('claude-3-5-sonnet-20241022'), 200000);
  });

  it('gpt-4o / o1 / o3 / o4 → 128000', () => {
    assert.equal(H.getModelMaxTokens('gpt-4o-mini'), 128000);
    assert.equal(H.getModelMaxTokens('o1-preview'), 128000);
    assert.equal(H.getModelMaxTokens('o3'), 128000);
    assert.equal(H.getModelMaxTokens('o4'), 128000);
  });

  it('gpt-4 / gpt-3 分档', () => {
    assert.equal(H.getModelMaxTokens('gpt-4-turbo'), 128000);
    assert.equal(H.getModelMaxTokens('gpt-3.5-turbo'), 16000);
  });

  it('deepseek-v4 → 1M（先于通用 deepseek 命中）', () => {
    assert.equal(H.getModelMaxTokens('deepseek-v4'), 1000000);
  });

  it('通用 deepseek → 128000', () => {
    assert.equal(H.getModelMaxTokens('deepseek-chat'), 128000);
  });

  it('未知模型回落 200000', () => {
    assert.equal(H.getModelMaxTokens('llama-3-70b'), 200000);
  });
});

describe('getEffectiveModel', () => {
  it('优先返回 response.body.model', () => {
    const req = { response: { body: { model: 'srv-model' } }, body: { model: 'cli-model' } };
    assert.equal(H.getEffectiveModel(req), 'srv-model');
  });

  it('response 缺失时回落 body.model', () => {
    assert.equal(H.getEffectiveModel({ body: { model: 'cli-model' } }), 'cli-model');
  });

  it('两者都缺返回 null', () => {
    assert.equal(H.getEffectiveModel({}), null);
    assert.equal(H.getEffectiveModel(null), null);
    assert.equal(H.getEffectiveModel(undefined), null);
  });
});

describe('AUTO_APPROVE_INSTANT 常量', () => {
  it('AUTO_APPROVE_INSTANT === -1', () => {
    assert.equal(H.AUTO_APPROVE_INSTANT, -1);
  });
});

describe('resolveCalibrationTokens', () => {
  it('直接查表 1m / 200k', () => {
    assert.equal(H.resolveCalibrationTokens('1m', null), 1000000);
    assert.equal(H.resolveCalibrationTokens('200k', null), 200000);
  });

  it('lastMainAgent 真实 model（opus-4-N 家族）→ 1M', () => {
    const last = { body: { model: 'claude-opus-4-8' } };
    assert.equal(H.resolveCalibrationTokens('auto', last), 1000000);
  });

  it('lastMainAgent 是普通 200K model（如 sonnet）→ 200K', () => {
    const last = { body: { model: 'claude-3-5-sonnet-20241022' } };
    assert.equal(H.resolveCalibrationTokens('auto', last), 200000);
  });

  it('lastMainAgent model 含 1m 子串 → 1M', () => {
    const last = { body: { model: 'deepseek-v3-1m' } };
    assert.equal(H.resolveCalibrationTokens('auto', last), 1000000);
  });

  it('lastMainAgent model 含 mythons → 1M', () => {
    const last = { body: { model: 'mythons-x' } };
    assert.equal(H.resolveCalibrationTokens('auto', last), 1000000);
  });

  it('lastMainAgent model 命中 fable-5 家族 → 1M', () => {
    const last = { body: { model: 'claude-fable-5' } };
    assert.equal(H.resolveCalibrationTokens('auto', last), 1000000);
  });

  it('haiku 视为噪声被跳过，落到 projectModelHint', () => {
    const last = { body: { model: 'claude-3-5-haiku-20241022' } };
    // hint 是 opus-4-N → 1M（证明确实跳过了 haiku 走 hint 分支）
    assert.equal(H.resolveCalibrationTokens('auto', last, 'claude-opus-4-8'), 1000000);
    // hint 是 sonnet → 200K
    assert.equal(H.resolveCalibrationTokens('auto', last, 'claude-3-5-sonnet-20241022'), 200000);
  });

  it('lastMainAgent 缺失但有 projectModelHint → 用 hint 分类', () => {
    assert.equal(H.resolveCalibrationTokens('auto', null, 'claude-opus-4-8'), 1000000);
    assert.equal(H.resolveCalibrationTokens('auto', null, 'gpt-4o'), 200000);
  });

  it('全部缺失 → 冷启动 1M 兜底', () => {
    assert.equal(H.resolveCalibrationTokens('auto', null, null), 1000000);
    assert.equal(H.resolveCalibrationTokens('whatever', null), 1000000);
  });

  it('lastMainAgent 存在但 effectiveModel 为空字符串 → 跳过，落 hint/兜底', () => {
    const last = { body: { model: '' } };
    assert.equal(H.resolveCalibrationTokens('auto', last, 'claude-opus-4-8'), 1000000);
    assert.equal(H.resolveCalibrationTokens('auto', last, null), 1000000);
  });

  it('opus-4 大小写不敏感 + 点号分隔均命中 1M', () => {
    assert.equal(H.resolveCalibrationTokens('auto', { body: { model: 'CLAUDE-OPUS-4.7' } }), 1000000);
    assert.equal(H.resolveCalibrationTokens('auto', { body: { model: 'claude-opus-4-9' } }), 1000000);
  });

  it('裸 claude-3-opus 不命中 opus-4-N → 200K', () => {
    assert.equal(H.resolveCalibrationTokens('auto', { body: { model: 'claude-3-opus-20240229' } }), 200000);
  });
});

describe('adaptContextWindow', () => {
  it('200K 且真实用量越过 200K → 纠偏到 1M', () => {
    assert.equal(H.adaptContextWindow(200000, 200001), 1000000);
  });
  it('200K 用量未越界 → 原样返回', () => {
    assert.equal(H.adaptContextWindow(200000, 200000), 200000);
    assert.equal(H.adaptContextWindow(200000, 5000), 200000);
  });
  it('非 200K 分类一律原样返回（不做反向纠偏）', () => {
    assert.equal(H.adaptContextWindow(1000000, 999999999), 1000000);
    assert.equal(H.adaptContextWindow(128000, 500000), 128000);
  });
});

describe('getModelInfo', () => {
  it('claude → provider Claude，svgAnimated 来自 ?raw stub', () => {
    const info = H.getModelInfo('claude-3-5-sonnet-20241022');
    assert.equal(info.provider, 'Claude');
    assert.equal(info.name, '3-5-sonnet'); // 去 claude- 前缀 + 去 8 位日期后缀
    assert.equal(info.color, 'var(--bg-model-avatar)');
    assert.ok(typeof info.svg === 'string' && info.svg.startsWith('<svg'));
    assert.match(info.svgAnimated, /^__ccv_asset_stub__:/);
  });

  it('gpt/o1/o3/o4 → OpenAI', () => {
    assert.equal(H.getModelInfo('gpt-4o').provider, 'OpenAI');
    assert.equal(H.getModelInfo('o1-preview').provider, 'OpenAI');
  });

  it('各家厂商命中', () => {
    assert.equal(H.getModelInfo('gemini-1.5-pro').provider, 'Gemini');
    assert.equal(H.getModelInfo('qwen-max').provider, 'Qwen');
    assert.equal(H.getModelInfo('kimi-k2').provider, 'Kimi');
    assert.equal(H.getModelInfo('moonshot-v1').provider, 'Kimi');
    assert.equal(H.getModelInfo('glm-4').provider, 'GLM');
    assert.equal(H.getModelInfo('chatglm3').provider, 'GLM');
    assert.equal(H.getModelInfo('minimax-abab').provider, 'MiniMax');
    assert.equal(H.getModelInfo('abab6.5').provider, 'MiniMax');
    assert.equal(H.getModelInfo('deepseek-chat').provider, 'DeepSeek');
  });

  it('未知模型 → svg=null，name/provider 用原名', () => {
    const info = H.getModelInfo('llama-3-70b');
    assert.equal(info.svg, null);
    assert.equal(info.provider, 'llama-3-70b');
    assert.equal(info.name, 'llama-3-70b');
    assert.equal(info.svgAnimated, undefined); // 未知分支不设 svgAnimated
  });

  it('name 去 8 位以上日期后缀', () => {
    assert.equal(H.getModelInfo('claude-opus-4-8-20251101').name, 'opus-4-8');
  });

  it('null/空 → 返回 null', () => {
    assert.equal(H.getModelInfo(''), null);
    assert.equal(H.getModelInfo(null), null);
  });

  it('同名返回同一引用（缓存命中）', () => {
    const a = H.getModelInfo('claude-cache-ref-test');
    const b = H.getModelInfo('claude-cache-ref-test');
    assert.strictEqual(a, b);
  });

  it('非 claude 的 svgAnimated 字段为 null', () => {
    // OpenAI provider 配置无 svgAnimated → info.svgAnimated 应为 null
    assert.equal(H.getModelInfo('gpt-4-turbo').svgAnimated, null);
  });
});

describe('resolveProducerModelInfo', () => {
  const tsToIndex = { t0: 0, t1: 1, t2: 2 };
  const modelByIdx = ['claude-opus-4-8', 'gpt-4o', null];

  it('ts 缺失 → null', () => {
    assert.equal(H.resolveProducerModelInfo(null, 'assistant', tsToIndex, modelByIdx), null);
  });

  it('ts 不在 index 表 → null', () => {
    assert.equal(H.resolveProducerModelInfo('nope', 'assistant', tsToIndex, modelByIdx), null);
  });

  it('assistant：producerIdx = idx-1', () => {
    // ts=t1 → idx=1 → producerIdx=0 → modelByIdx[0]=claude-opus-4-8
    const info = H.resolveProducerModelInfo('t1', 'assistant', tsToIndex, modelByIdx);
    assert.equal(info.provider, 'Claude');
  });

  it('assistant 在 idx=0：producerIdx 夹到 0（mid-session 边界）', () => {
    // ts=t0 → idx=0 → max(0-1,0)=0 → modelByIdx[0]
    const info = H.resolveProducerModelInfo('t0', 'assistant', tsToIndex, modelByIdx);
    assert.equal(info.provider, 'Claude');
  });

  it('user：producerIdx = idx', () => {
    // ts=t1 → idx=1 → producerIdx=1 → gpt-4o
    const info = H.resolveProducerModelInfo('t1', 'user', tsToIndex, modelByIdx);
    assert.equal(info.provider, 'OpenAI');
  });

  it('producer model name 为 null → 返回 null', () => {
    // ts=t2 → idx=2 → user → producerIdx=2 → modelByIdx[2]=null
    assert.equal(H.resolveProducerModelInfo('t2', 'user', tsToIndex, modelByIdx), null);
  });

  it('idx===0 被识别（不被 == null 误判）', () => {
    // 显式验证 idx==0 不会触发 "idx == null" 早退
    const info = H.resolveProducerModelInfo('t0', 'user', tsToIndex, modelByIdx);
    assert.equal(info.provider, 'Claude');
  });
});

describe('escapeHtml', () => {
  it('空值返回空串', () => {
    assert.equal(H.escapeHtml(''), '');
    assert.equal(H.escapeHtml(null), '');
    assert.equal(H.escapeHtml(undefined), '');
  });
  it('转义 & < > "', () => {
    assert.equal(H.escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  });
  it('& 先转义避免二次转义', () => {
    assert.equal(H.escapeHtml('a & b'), 'a &amp; b');
  });
});

describe('truncateText', () => {
  it('空值返回空串', () => {
    assert.equal(H.truncateText('', 5), '');
    assert.equal(H.truncateText(null, 5), '');
  });
  it('短文本原样返回', () => {
    assert.equal(H.truncateText('abc', 5), 'abc');
    assert.equal(H.truncateText('abcde', 5), 'abcde'); // 边界：等长不截断
  });
  it('超长截断并加省略号', () => {
    assert.equal(H.truncateText('abcdef', 5), 'abcde...');
  });
});

describe('getSvgAvatar', () => {
  it('user / agent / teammate / 各 sub 类型返回不同 svg', () => {
    const user = H.getSvgAvatar('user');
    const agent = H.getSvgAvatar('agent');
    const teammate = H.getSvgAvatar('teammate');
    const search = H.getSvgAvatar('sub-search');
    const explore = H.getSvgAvatar('sub-explore');
    const plan = H.getSvgAvatar('sub-plan');
    const def = H.getSvgAvatar('something-else');
    for (const s of [user, agent, teammate, search, plan, def]) {
      assert.ok(typeof s === 'string' && s.startsWith('<svg'));
    }
    // sub-search 与 sub-explore 共用同一 svg
    assert.equal(search, explore);
    // 不同类别彼此不同
    assert.notEqual(user, agent);
    assert.notEqual(agent, teammate);
    assert.notEqual(search, plan);
    assert.notEqual(plan, def);
  });
  it('未知类型回落 default sub-agent svg', () => {
    assert.equal(H.getSvgAvatar('xyz'), H.getSvgAvatar('totally-unknown'));
  });
  it('system type returns its own gear svg (distinct from default)', () => {
    const sys = H.getSvgAvatar('system');
    assert.ok(typeof sys === 'string' && sys.startsWith('<svg'));
    assert.notEqual(sys, H.getSvgAvatar('totally-unknown'));
    assert.notEqual(sys, H.getSvgAvatar('agent'));
  });
});

describe('formatTokenCount', () => {
  it('null / 0 → "0"', () => {
    assert.equal(H.formatTokenCount(null), '0');
    assert.equal(H.formatTokenCount(undefined), '0');
    assert.equal(H.formatTokenCount(0), '0');
  });
  it('< 1000 原样字符串', () => {
    assert.equal(H.formatTokenCount(999), '999');
    assert.equal(H.formatTokenCount(1), '1');
  });
  it('千位 → K（保留一位小数）', () => {
    assert.equal(H.formatTokenCount(1000), '1.0K');
    assert.equal(H.formatTokenCount(1500), '1.5K');
    assert.equal(H.formatTokenCount(999999), '1000.0K');
  });
  it('百万 → M（保留一位小数）', () => {
    assert.equal(H.formatTokenCount(1000000), '1.0M');
    assert.equal(H.formatTokenCount(2500000), '2.5M');
  });
});

describe('appendCacheLossMap / buildCacheLossMap', () => {
  it('非 MainAgent 请求被跳过，不写入 map', () => {
    const reqs = [
      mainReq({ timestamp: 0, usage: { cache_creation_input_tokens: 10, cache_read_input_tokens: 0 } }),
      subReq({ timestamp: 1 }), // 非 MainAgent → 跳过
    ];
    const map = H.buildCacheLossMap(reqs);
    assert.equal(map.size, 0); // 第一个无 prev，第二个被跳过
  });

  it('首个 MainAgent 无 prev baseline，不计 loss', () => {
    const reqs = [
      mainReq({ timestamp: 0, usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 } }),
    ];
    assert.equal(H.buildCacheLossMap(reqs).size, 0);
  });

  it('cache_creation 未大于 cache_read → 不计 loss', () => {
    const reqs = [
      mainReq({ timestamp: 0 }),
      mainReq({ timestamp: 1, usage: { cache_creation_input_tokens: 5, cache_read_input_tokens: 5 } }),
    ];
    assert.equal(H.buildCacheLossMap(reqs).size, 0);
  });

  it('cache_creation=0 → 不计 loss', () => {
    const reqs = [
      mainReq({ timestamp: 0 }),
      mainReq({ timestamp: 1, usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }),
    ];
    assert.equal(H.buildCacheLossMap(reqs).size, 0);
  });

  it('TTL：间隔 > 5min → reason=ttl', () => {
    const reqs = [
      mainReq({ timestamp: 0 }),
      mainReq({
        timestamp: 5 * 60 * 1000 + 1,
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const map = H.buildCacheLossMap(reqs);
    assert.deepEqual(map.get(1), { reason: 'ttl', reasons: ['ttl'] });
  });

  it('model_change：prev/curr model 不同', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { model: 'm1' } }),
      mainReq({
        timestamp: 100,
        body: { model: 'm2' },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const loss = H.buildCacheLossMap(reqs).get(1);
    assert.equal(loss.reason, 'model_change');
    assert.ok(loss.reasons.includes('model_change'));
  });

  it('system_change：system 文本不同', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { system: 'You are Claude Code A' } }),
      mainReq({
        timestamp: 100,
        body: { system: 'You are Claude Code B' },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const loss = H.buildCacheLossMap(reqs).get(1);
    assert.ok(loss.reasons.includes('system_change'));
  });

  it('tools_change：tools 不同', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { tools: [{ name: 'A' }] } }),
      mainReq({
        timestamp: 100,
        body: { tools: [{ name: 'A' }, { name: 'B' }] },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const loss = H.buildCacheLossMap(reqs).get(1);
    assert.ok(loss.reasons.includes('tools_change'));
  });

  it('msg_truncated：curr.messages 比 prev 短', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] } }),
      mainReq({
        timestamp: 100,
        body: { messages: [{ role: 'user', content: 'a' }] },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const loss = H.buildCacheLossMap(reqs).get(1);
    assert.ok(loss.reasons.includes('msg_truncated'));
  });

  it('msg_modified：公共前缀不一致', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { messages: [{ role: 'user', content: 'a' }] } }),
      mainReq({
        timestamp: 100,
        body: { messages: [{ role: 'user', content: 'CHANGED' }, { role: 'assistant', content: 'b' }] },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const loss = H.buildCacheLossMap(reqs).get(1);
    assert.ok(loss.reasons.includes('msg_modified'));
  });

  it('完全相同的相邻 MainAgent → reasons 兜底 key_change', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { model: 'm', system: 'You are Claude Code', tools: [], messages: [{ role: 'user', content: 'a' }] } }),
      mainReq({
        timestamp: 100,
        body: { model: 'm', system: 'You are Claude Code', tools: [], messages: [{ role: 'user', content: 'a' }] },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const loss = H.buildCacheLossMap(reqs).get(1);
    assert.deepEqual(loss, { reason: 'key_change', reasons: ['key_change'] });
  });

  it('reason 取 reasons[0]（多原因时按检测顺序 model 优先）', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { model: 'm1', system: 'You are Claude Code A', tools: [{ name: 'X' }] } }),
      mainReq({
        timestamp: 100,
        body: { model: 'm2', system: 'You are Claude Code B', tools: [{ name: 'Y' }] },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const loss = H.buildCacheLossMap(reqs).get(1);
    assert.equal(loss.reason, 'model_change');
    assert.deepEqual(loss.reasons, ['model_change', 'system_change', 'tools_change']);
  });

  it('appendCacheLossMap：从 startIndex 增量扫描 + prevMainAgent 显式传入', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { model: 'm1' } }),
      mainReq({
        timestamp: 100,
        body: { model: 'm2' },
        usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
      }),
    ];
    const map = new Map();
    // 从 index 1 开始，显式提供 reqs[0] 作为 baseline
    const lastMain = H.appendCacheLossMap(map, reqs, 1, reqs[0]);
    assert.equal(map.size, 1);
    assert.equal(map.get(1).reason, 'model_change');
    // 返回最后一个 MainAgent 供下次增量调用
    assert.strictEqual(lastMain, reqs[1]);
  });

  it('appendCacheLossMap：无变更（baseline 与新条相同）则不写入但仍推进 prev', () => {
    const r0 = mainReq({ timestamp: 0, body: { model: 'm' } });
    const r1 = mainReq({
      timestamp: 50,
      body: { model: 'm' },
      usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
    });
    const map = new Map();
    const last = H.appendCacheLossMap(map, [r0, r1], 1, r0);
    // 相同 → 兜底 key_change 仍会写入（cache_creation>read 触发了计算）
    assert.equal(map.get(1).reason, 'key_change');
    assert.strictEqual(last, r1);
  });

  it('slim baseline：prevMainAgent._slimmed 时调用 restoreSlimmedEntry 还原后比较', () => {
    // 构造 full entry（index 0）携带完整 messages；slim entry（index 1）指向它。
    const fullEntry = mainReq({
      timestamp: 0,
      body: { model: 'm', messages: [{ role: 'user', content: 'orig' }] },
    });
    const slimPrev = {
      mainAgent: true,
      timestamp: 0,
      _slimmed: true,
      _fullEntryIndex: 0,
      _messageCount: 1,
      body: { model: 'm', system: 'You are Claude Code', tools: [] }, // messages 被剪掉
    };
    const curr = mainReq({
      timestamp: 100,
      body: { model: 'm', messages: [{ role: 'user', content: 'CHANGED' }] },
      usage: { cache_creation_input_tokens: 100, cache_read_input_tokens: 0 },
    });
    const requests = [fullEntry, slimPrev, curr];
    const map = new Map();
    // baseline = slimPrev（_slimmed），还原后其 messages = fullEntry 的 [orig]
    // curr.messages = [CHANGED] → 前缀不一致 → msg_modified
    H.appendCacheLossMap(map, requests, 2, slimPrev);
    const loss = map.get(2);
    assert.ok(loss.reasons.includes('msg_modified'),
      `expected msg_modified, got ${JSON.stringify(loss)}`);
  });

  it('buildCacheLossMap 多条混合：仅对触发条件的 MainAgent 记录', () => {
    const reqs = [
      mainReq({ timestamp: 0, body: { model: 'm1' } }),
      // index1: model 变 + 命中 cache 条件 → 记录
      mainReq({ timestamp: 100, body: { model: 'm2' }, usage: { cache_creation_input_tokens: 50, cache_read_input_tokens: 0 } }),
      // index2: cache_read >= create → 不记录
      mainReq({ timestamp: 200, body: { model: 'm3' }, usage: { cache_creation_input_tokens: 5, cache_read_input_tokens: 10 } }),
    ];
    const map = H.buildCacheLossMap(reqs);
    assert.deepEqual([...map.keys()], [1]);
  });
});

describe('readCalibrationModel', () => {
  const MODELS = [{ value: 'auto' }, { value: '1m' }, { value: '200k' }];
  // Save/stub/restore discipline for globalThis.localStorage — same pattern as
  // branch-utils-projectAlias.test.js / entry-cache.test.js.
  let savedLocalStorage;
  let hadLocalStorage;
  before(() => {
    hadLocalStorage = 'localStorage' in globalThis;
    savedLocalStorage = globalThis.localStorage;
  });
  after(() => {
    if (hadLocalStorage) globalThis.localStorage = savedLocalStorage;
    else delete globalThis.localStorage;
  });
  const stub = (value) => { globalThis.localStorage = { getItem: () => value }; };

  it('migrates pre-1.6.243 per-model values to size buckets', () => {
    stub('opus-4.7-1m');
    assert.equal(H.readCalibrationModel(MODELS), '1m');
    stub('sonnet-4.6');
    assert.equal(H.readCalibrationModel(MODELS), '200k');
  });

  it('passes through values already in the configured list', () => {
    stub('200k');
    assert.equal(H.readCalibrationModel(MODELS), '200k');
    stub('auto');
    assert.equal(H.readCalibrationModel(MODELS), 'auto');
  });

  it('falls back to auto for unknown values and missing keys', () => {
    stub('some-retired-model');
    assert.equal(H.readCalibrationModel(MODELS), 'auto');
    stub(null);
    assert.equal(H.readCalibrationModel(MODELS), 'auto');
  });

  it('is safe without localStorage (non-browser env) and with a throwing storage', () => {
    delete globalThis.localStorage;
    assert.equal(H.readCalibrationModel(MODELS), 'auto');
    globalThis.localStorage = { getItem: () => { throw new Error('denied'); } };
    assert.equal(H.readCalibrationModel(MODELS), 'auto');
  });
});

describe('computeContextPercent', () => {
  // Requests built via mainReq({ body: { model } }) so getEffectiveModel resolves.

  it('honors a pinned 200k / 1m calibration as the denominator', () => {
    const agent = mainReq({ body: { model: 'claude-fable-5' } });
    assert.equal(H.computeContextPercent({
      calibrationModel: '200k', lastMainAgent: agent, contextWindow: null,
      lastTotalTokens: 100000, lastInputTokens: 90000,
    }), 50);
    assert.equal(H.computeContextPercent({
      calibrationModel: '1m', lastMainAgent: agent, contextWindow: null,
      lastTotalTokens: 100000, lastInputTokens: 90000,
    }), 10);
  });

  it('auto mode classifies the window from the last main-agent model', () => {
    // sonnet → 200K bucket, fable-5 → 1M bucket (context-rules.classifyContextWindow)
    assert.equal(H.computeContextPercent({
      calibrationModel: 'auto',
      lastMainAgent: mainReq({ body: { model: 'claude-sonnet-4-5' } }),
      contextWindow: null, lastTotalTokens: 100000, lastInputTokens: 90000,
    }), 50);
    assert.equal(H.computeContextPercent({
      calibrationModel: 'auto',
      lastMainAgent: mainReq({ body: { model: 'claude-fable-5' } }),
      contextWindow: null, lastTotalTokens: 100000, lastInputTokens: 90000,
    }), 10);
  });

  it('rescales server used_percentage onto the calibrated window when no usage tokens exist', () => {
    // The mobile-drift repro: mobile used to show round(used_percentage) raw (50);
    // the shared math rebases 50% of a 200K server window onto the 1M calibration → 10.
    assert.equal(H.computeContextPercent({
      calibrationModel: '1m', lastMainAgent: null,
      contextWindow: { used_percentage: 50, context_window_size: 200000 },
      lastTotalTokens: 0, lastInputTokens: 0,
    }), 10);
  });

  it('prefers direct usage tokens over used_percentage when both exist', () => {
    assert.equal(H.computeContextPercent({
      calibrationModel: '1m',
      lastMainAgent: mainReq({ body: { model: 'claude-fable-5' } }),
      contextWindow: { used_percentage: 99, context_window_size: 200000 },
      lastTotalTokens: 500000, lastInputTokens: 400000,
    }), 50);
  });

  it('adaptive correction: input beyond 200K upgrades an auto-classified 200K window to 1M', () => {
    assert.equal(H.computeContextPercent({
      calibrationModel: 'auto',
      lastMainAgent: mainReq({ body: { model: 'claude-sonnet-4-5' } }), // 200K bucket
      contextWindow: null,
      lastTotalTokens: 300000, lastInputTokens: 250000, // demonstrably >200K of input
    }), 30);
  });

  it('adaptive correction falls back to contextWindow.total_input_tokens when no per-request input tokens exist', () => {
    // Live SSE-only case: no usage on the last main agent yet, but the server
    // event carries total_input_tokens > 200K → the 200K classification upgrades
    // to 1M and used_percentage is rebased onto it (50% of a 200K window → 10%).
    assert.equal(H.computeContextPercent({
      calibrationModel: 'auto',
      lastMainAgent: mainReq({ body: { model: 'claude-sonnet-4-5' } }), // 200K bucket
      contextWindow: { used_percentage: 50, context_window_size: 200000, total_input_tokens: 250000 },
      lastTotalTokens: 0, lastInputTokens: 0,
    }), 10);
  });

  it('pinned 200k skips adaptive correction and clamps at 100', () => {
    assert.equal(H.computeContextPercent({
      calibrationModel: '200k',
      lastMainAgent: mainReq({ body: { model: 'claude-sonnet-4-5' } }),
      contextWindow: null,
      lastTotalTokens: 250000, lastInputTokens: 250000,
    }), 100);
  });

  it('returns 0 with no usable signal', () => {
    assert.equal(H.computeContextPercent({
      calibrationModel: 'auto', lastMainAgent: null, contextWindow: null,
      lastTotalTokens: 0, lastInputTokens: 0,
    }), 0);
  });
});
