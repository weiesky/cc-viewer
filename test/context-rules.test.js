/**
 * Unit tests for server/lib/context-rules.js — 上下文窗口规则唯一事实源。
 * 纯函数模块(CLIENT-SAFE,无 node 依赖),顶层静态 import,无需环境隔离。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseContextSizeSuffix,
  getCalibrationModel,
  getModelMaxTokens,
  classifyContextWindow,
  adaptContextWindow,
  sumCacheCreationTokens,
  sumUsageInputTokens,
  sumUsageContextTokens,
} from '../packages/app/server/lib/context-rules.js';

describe('parseContextSizeSuffix', () => {
  it('[1m]/[200k]/[500k] 解析,大小写不敏感', () => {
    assert.equal(parseContextSizeSuffix('claude-fable-5[1m]'), 1000000);
    assert.equal(parseContextSizeSuffix('claude-sonnet-4-6[200k]'), 200000);
    assert.equal(parseContextSizeSuffix('x[500K]'), 500000);
    assert.equal(parseContextSizeSuffix('y[1M]'), 1000000);
  });
  it('无后缀/空值返回 null', () => {
    assert.equal(parseContextSizeSuffix('claude-opus-4-8'), null);
    assert.equal(parseContextSizeSuffix(''), null);
    assert.equal(parseContextSizeSuffix(null), null);
  });
});

describe('getCalibrationModel — 校准窗口判定专用解析', () => {
  it('请求名带显式 [Nk]/[Nm] 后缀 → 请求名优先,不被响应归一化覆盖', () => {
    // 热切换 k3[1m]:上游把响应 model 剥成裸 k3,请求侧 [1m] 意图必须胜出
    assert.equal(getCalibrationModel({ body: { model: 'k3[1m]' }, response: { body: { model: 'k3' } } }), 'k3[1m]');
    assert.equal(getCalibrationModel({ body: { model: 'claude-opus-4-6[1m]' }, response: { body: { model: 'claude-opus-4-6' } } }), 'claude-opus-4-6[1m]');
  });
  it('请求名无后缀 → response.body.model 优先(热切换权威)', () => {
    assert.equal(getCalibrationModel({ body: { model: 'claude-opus-4-6' }, response: { body: { model: 'kimi-k3' } } }), 'kimi-k3');
  });
  it('无 response 模型 → 回退请求名;空串响应视为缺失', () => {
    assert.equal(getCalibrationModel({ body: { model: 'claude-haiku-4-5' }, response: { body: { model: '' } } }), 'claude-haiku-4-5');
    assert.equal(getCalibrationModel({ body: { model: 'claude-opus-4-1' } }), 'claude-opus-4-1');
  });
  it('空/非法入参 → null', () => {
    assert.equal(getCalibrationModel(null), null);
    assert.equal(getCalibrationModel({}), null);
    assert.equal(getCalibrationModel({ body: {} }), null);
  });
});

describe('getModelMaxTokens — 后缀优先级最高', () => {
  it('后缀胜过家族规则(haiku/旧 opus 带 [1m] 也判 1M,opus-4-6 带 [200k] 判 200K)', () => {
    assert.equal(getModelMaxTokens('claude-haiku-4-5[1m]'), 1000000);
    assert.equal(getModelMaxTokens('claude-opus-4-1[1m]'), 1000000);
    assert.equal(getModelMaxTokens('claude-opus-4-6[200k]'), 200000);
  });
});

describe('getModelMaxTokens — 家族档位', () => {
  it('haiku 显式 200K', () => {
    assert.equal(getModelMaxTokens('claude-haiku-4-5'), 200000);
    assert.equal(getModelMaxTokens('claude-haiku-4-5-20251001'), 200000);
  });
  it('旧 Opus(4-0/4-1/4-5,含日期后缀与点分变体)修正为 200K', () => {
    assert.equal(getModelMaxTokens('claude-opus-4-0'), 200000);
    assert.equal(getModelMaxTokens('claude-opus-4-1'), 200000);
    assert.equal(getModelMaxTokens('claude-opus-4-1-20250805'), 200000);
    assert.equal(getModelMaxTokens('claude-opus-4.1'), 200000);
    assert.equal(getModelMaxTokens('claude-opus-4-5-20251101'), 200000);
  });
  it('opus-4-6 起与未来版本 1M;(?!\\d) 防误吞 opus-4-15', () => {
    assert.equal(getModelMaxTokens('claude-opus-4-6'), 1000000);
    assert.equal(getModelMaxTokens('claude-opus-4-7'), 1000000);
    assert.equal(getModelMaxTokens('claude-opus-4-9'), 1000000);
    assert.equal(getModelMaxTokens('claude-opus-4-15'), 1000000);
  });
  it('claude-3-opus(两种写法)200K', () => {
    assert.equal(getModelMaxTokens('claude-3-opus-20240229'), 200000);
    assert.equal(getModelMaxTokens('opus-3'), 200000);
  });
  it('mythons / fable-5 / deepseek-v4 → 1M', () => {
    assert.equal(getModelMaxTokens('mythons-pro'), 1000000);
    assert.equal(getModelMaxTokens('claude-fable-5'), 1000000);
    assert.equal(getModelMaxTokens('claude-fable-5-1'), 1000000);
    assert.equal(getModelMaxTokens('deepseek-v4'), 1000000);
  });
  it('裸 claude-sonnet-4-6 维持 200K(有意为之:与 Claude Code 默认一致,[1m] 是显式 opt-in,真 1M 靠后缀或纠偏兜底)', () => {
    assert.equal(getModelMaxTokens('claude-sonnet-4-6'), 200000);
    assert.equal(getModelMaxTokens('claude-3-5-sonnet-20241022'), 200000);
  });
  it('gpt 三档与通用 deepseek', () => {
    assert.equal(getModelMaxTokens('gpt-4o-mini'), 128000);
    assert.equal(getModelMaxTokens('o1-preview'), 128000);
    assert.equal(getModelMaxTokens('gpt-4-turbo'), 128000);
    assert.equal(getModelMaxTokens('gpt-3.5-turbo'), 16000);
    assert.equal(getModelMaxTokens('deepseek-chat'), 128000);
  });
  it('空/未知回落 200K', () => {
    assert.equal(getModelMaxTokens(null), 200000);
    assert.equal(getModelMaxTokens(''), 200000);
    assert.equal(getModelMaxTokens('llama-3-70b'), 200000);
  });
  it('kimi/moonshot 前缀型号与裸 k3 → 256K 精确档', () => {
    assert.equal(getModelMaxTokens('kimi-k2.5'), 256000);
    assert.equal(getModelMaxTokens('kimi-k3'), 256000);
    assert.equal(getModelMaxTokens('moonshot-v1-k2'), 256000);
    assert.equal(getModelMaxTokens('k3'), 256000);
    assert.equal(getModelMaxTokens('K3'), 256000);
  });
  it('kimi 256K 档可被 [Nk]/[Nm] 后缀覆盖', () => {
    assert.equal(getModelMaxTokens('kimi-k3[1m]'), 1000000);
    assert.equal(getModelMaxTokens('k3[128k]'), 128000);
  });
});

describe('classifyContextWindow — 校准二分类', () => {
  it('不变量:只返回 1000000 或 200000', () => {
    for (const m of ['claude-opus-4-8', 'gpt-4o', 'deepseek-chat', 'claude-haiku-4-5', 'x', null]) {
      const r = classifyContextWindow(m);
      assert.ok(r === 1000000 || r === 200000, `${m} → ${r}`);
    }
  });
  it("裸 '1m' 子串(如 deepseek-v3-1m)→ 1M(宽松规则仅限校准路径)", () => {
    assert.equal(classifyContextWindow('deepseek-v3-1m'), 1000000);
  });
  it('1M 档归 1M;128K/16K/200K 档归 200K 桶', () => {
    assert.equal(classifyContextWindow('claude-opus-4-8'), 1000000);
    assert.equal(classifyContextWindow('deepseek-v4'), 1000000);
    assert.equal(classifyContextWindow('claude-opus-4-1'), 200000);
    assert.equal(classifyContextWindow('gpt-4o'), 200000);
    assert.equal(classifyContextWindow('deepseek-chat'), 200000);
  });
  it('kimi/moonshot 前缀型号与裸 k3 均特判归 1M 桶', () => {
    assert.equal(classifyContextWindow('kimi-k2.5'), 1000000);
    assert.equal(classifyContextWindow('kimi-k3'), 1000000);
    assert.equal(classifyContextWindow('moonshot-v1-k2'), 1000000);
    // 裸 k3:热切换 k3[1m] 时上游把响应 model 剥成裸 k3,response-first 解析须仍归 1M
    assert.equal(classifyContextWindow('k3'), 1000000);
  });
});

describe('adaptContextWindow — 自适应纠偏', () => {
  it('200K 判定且输入用量 > 200K → 升 1M(边界 200000 不触发,200001 触发)', () => {
    assert.equal(adaptContextWindow(200000, 200000), 200000);
    assert.equal(adaptContextWindow(200000, 200001), 1000000);
  });
  it('256K 档(kimi 精确档,服务端 SSE 路径)且输入用量 > 256K → 升 1M(边界同理)', () => {
    assert.equal(adaptContextWindow(256000, 256000), 256000);
    assert.equal(adaptContextWindow(256000, 256001), 1000000);
  });
  it('单向:1M 判定不降级;128K 档永不升档', () => {
    assert.equal(adaptContextWindow(1000000, 50), 1000000);
    assert.equal(adaptContextWindow(128000, 300000), 128000);
  });
});

describe('sumCacheCreationTokens — flat/嵌套兼容', () => {
  it('flat 字段存在(含 0)优先', () => {
    assert.equal(sumCacheCreationTokens({ cache_creation_input_tokens: 500 }), 500);
    assert.equal(sumCacheCreationTokens({ cache_creation_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 999 } }), 0);
  });
  it('flat 缺失回落嵌套分桶求和(5m + 1h,未来分桶自动计入)', () => {
    assert.equal(sumCacheCreationTokens({ cache_creation: { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 200 } }), 500);
    assert.equal(sumCacheCreationTokens({ cache_creation: { ephemeral_5m_input_tokens: 300, future_bucket: 100 } }), 400);
  });
  it('null/无关字段 → 0', () => {
    assert.equal(sumCacheCreationTokens(null), 0);
    assert.equal(sumCacheCreationTokens({}), 0);
    assert.equal(sumCacheCreationTokens({ cache_creation: { note: 'str' } }), 0);
  });
});

describe('sumUsageInputTokens / sumUsageContextTokens', () => {
  const usage = { input_tokens: 100, cache_creation_input_tokens: 200, cache_read_input_tokens: 300, output_tokens: 50 };
  it('Input 不含 output;Context 含 output(血条分子,对齐 /context)', () => {
    assert.equal(sumUsageInputTokens(usage), 600);
    assert.equal(sumUsageContextTokens(usage), 650);
  });
  it('仅嵌套 cache_creation 时两者均计入', () => {
    const nested = { input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 200 }, cache_read_input_tokens: 300, output_tokens: 50 };
    assert.equal(sumUsageInputTokens(nested), 600);
    assert.equal(sumUsageContextTokens(nested), 650);
  });
  it('usage 为 null → 0', () => {
    assert.equal(sumUsageInputTokens(null), 0);
    assert.equal(sumUsageContextTokens(null), 0);
  });
});
