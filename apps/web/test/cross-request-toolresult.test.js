/**
 * SubAgent / Teammate 末轮 tool_use 的 tool_result 跨请求补偿渲染。
 *
 * 算法对位 src/utils/toolResultBuilder.js 的 buildGlobalToolResultIndex:
 * 两遍扫所有 requests,Pass 1 建 tool_use 索引,Pass 2 按 id 索引所有 tool_result。
 * 渲染时 buildSubAgentResultMap 按本 entry response.content 的 tool_use_id 在
 * 全局索引中 O(1) 回填。
 *
 * 测试通过 import src/utils/toolResultCore.js 的纯函数 buildSingleToolResultCore
 * 复用 entry 构造逻辑(toolResultCore.js 不依赖 helpers.js / i18n.js / SVG,可直接
 * 在 node --test 加载)。buildGlobalToolResultIndex 的结构性算法仍内联以避免引入
 * toolResultBuilder.js 的 vite-only 链。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSingleToolResultCore } from '../src/utils/toolResultCore.js';

// 内联:buildGlobalToolResultIndex 的结构算法,内部 entry 构造复用 core 函数。
function buildGlobalToolResultIndex(requests) {
  const out = {};
  if (!Array.isArray(requests)) return out;
  const useMap = {};
  for (const r of requests) {
    if (!r) continue;
    const msgs = r.body?.messages;
    if (Array.isArray(msgs)) {
      for (const m of msgs) {
        if (m?.role === 'assistant' && Array.isArray(m.content)) {
          for (const b of m.content) {
            if (b?.type === 'tool_use' && b.id) useMap[b.id] = b;
          }
        }
      }
    }
    const respContent = r.response?.body?.content;
    if (Array.isArray(respContent)) {
      for (const b of respContent) {
        if (b?.type === 'tool_use' && b.id) useMap[b.id] = b;
      }
    }
  }
  for (const r of requests) {
    const msgs = r?.body?.messages;
    if (!Array.isArray(msgs)) continue;
    for (const m of msgs) {
      if (m?.role !== 'user' || !Array.isArray(m.content)) continue;
      for (const b of m.content) {
        if (b?.type === 'tool_result' && b.tool_use_id && !(b.tool_use_id in out)) {
          out[b.tool_use_id] = buildSingleToolResultCore(b, useMap[b.tool_use_id]);
        }
      }
    }
  }
  return out;
}

// 单一请求 lookahead 测试(K → K+1):测最小的提取逻辑。
function lookaheadToolResults(nextReq, toolUseMap) {
  const msgs = nextReq?.body?.messages;
  if (!Array.isArray(msgs) || msgs.length === 0) return {};
  let target = null;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m && m.role === 'user' && Array.isArray(m.content)) { target = m; break; }
  }
  if (!target) return {};
  const out = {};
  for (const block of target.content) {
    if (!block || block.type !== 'tool_result' || !block.tool_use_id) continue;
    const matched = toolUseMap?.[block.tool_use_id];
    if (!matched) continue;
    out[block.tool_use_id] = buildSingleToolResultCore(block, matched);
  }
  return out;
}

// 辅助:模拟 ChatView 调用上下文,构建 K 的 combinedToolUseMap
// (body.messages 历史 turn 的 tool_use + response.content 的当前 turn tool_use)
function buildCombinedToolUseMap(req) {
  const out = {};
  for (const m of req.body?.messages || []) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && b.type === 'tool_use' && b.id) out[b.id] = b;
      }
    }
  }
  for (const b of req.response?.body?.content || []) {
    if (b && b.type === 'tool_use' && b.id) out[b.id] = b;
  }
  return out;
}

// fixture 辅助构造
function makeReq({ historyTurns = [], currentTurnUses = [], response = true }) {
  const messages = [];
  for (const turn of historyTurns) {
    messages.push({ role: 'assistant', content: turn.uses });
    messages.push({ role: 'user', content: turn.results });
  }
  return {
    body: { messages },
    response: response
      ? { body: { content: currentTurnUses } }
      : null,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('lookaheadToolResults: SubAgent 末轮 tool_result 跨请求补偿', () => {
  it('相邻 SubAgent: K 的 response.content 有 tool_use[id=A], K+1 body.messages 末尾有 tool_result[id=A]', () => {
    const reqK = makeReq({
      historyTurns: [],
      currentTurnUses: [{ type: 'tool_use', id: 'toolu_A', name: 'Bash', input: { command: 'ls' } }],
    });
    const reqK1 = makeReq({
      historyTurns: [
        {
          uses: [{ type: 'tool_use', id: 'toolu_A', name: 'Bash', input: { command: 'ls' } }],
          results: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'README.md\nsrc/' }],
        },
      ],
    });
    const lookahead = lookaheadToolResults(reqK1, buildCombinedToolUseMap(reqK));
    assert.equal(Object.keys(lookahead).length, 1, '应补偿 1 个末轮 tool_result');
    assert.equal(lookahead['toolu_A'].toolName, 'Bash');
    assert.equal(lookahead['toolu_A'].resultText, 'README.md\nsrc/');
    assert.equal(lookahead['toolu_A'].isError, false);
  });

  it('单 turn 多并发: K 有 3 个 tool_use, K+1 末尾有 3 个 tool_result', () => {
    const reqK = makeReq({
      currentTurnUses: [
        { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/a' } },
        { type: 'tool_use', id: 'tu_2', name: 'Grep', input: { pattern: 'foo' } },
        { type: 'tool_use', id: 'tu_3', name: 'Glob', input: { pattern: '*.js' } },
      ],
    });
    const reqK1 = makeReq({
      historyTurns: [
        {
          uses: [
            { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/a' } },
            { type: 'tool_use', id: 'tu_2', name: 'Grep', input: { pattern: 'foo' } },
            { type: 'tool_use', id: 'tu_3', name: 'Glob', input: { pattern: '*.js' } },
          ],
          results: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'line1\nline2' },
            { type: 'tool_result', tool_use_id: 'tu_2', content: 'match1' },
            { type: 'tool_result', tool_use_id: 'tu_3', content: 'a.js\nb.js' },
          ],
        },
      ],
    });
    const lookahead = lookaheadToolResults(reqK1, buildCombinedToolUseMap(reqK));
    assert.equal(Object.keys(lookahead).length, 3);
    assert.equal(lookahead['tu_1'].toolName, 'Read');
    assert.equal(lookahead['tu_2'].resultText, 'match1');
    assert.equal(lookahead['tu_3'].toolName, 'Glob');
  });

  it('K 是末尾 (没有 K+1): 返回空对象不抛错', () => {
    const reqK = makeReq({
      currentTurnUses: [{ type: 'tool_use', id: 'toolu_X', name: 'Bash', input: {} }],
    });
    const lookahead1 = lookaheadToolResults(undefined, buildCombinedToolUseMap(reqK));
    const lookahead2 = lookaheadToolResults(null, buildCombinedToolUseMap(reqK));
    const lookahead3 = lookaheadToolResults({}, buildCombinedToolUseMap(reqK));
    const lookahead4 = lookaheadToolResults({ body: { messages: [] } }, buildCombinedToolUseMap(reqK));
    assert.deepEqual(lookahead1, {});
    assert.deepEqual(lookahead2, {});
    assert.deepEqual(lookahead3, {});
    assert.deepEqual(lookahead4, {});
  });

  it('K+1 还在 streaming (response: null) 但 body.messages 已含 tool_result: 仍能合并', () => {
    const reqK = makeReq({
      currentTurnUses: [{ type: 'tool_use', id: 'toolu_S', name: 'Bash', input: {} }],
    });
    const reqK1Streaming = {
      body: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_S', name: 'Bash', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_S', content: 'OK' }] },
        ],
      },
      response: null,
      inProgress: true,
    };
    const lookahead = lookaheadToolResults(reqK1Streaming, buildCombinedToolUseMap(reqK));
    assert.equal(lookahead['toolu_S'].resultText, 'OK');
  });

  it('白名单过滤: K+1 末尾的 tool_result 若不在 K 的 toolUseMap 中,不进入 lookahead', () => {
    const reqK = makeReq({
      currentTurnUses: [{ type: 'tool_use', id: 'toolu_KNOWN', name: 'Bash', input: {} }],
    });
    const reqK1 = {
      body: {
        messages: [
          { role: 'user', content: [
            { type: 'tool_result', tool_use_id: 'toolu_KNOWN', content: 'mine' },
            { type: 'tool_result', tool_use_id: 'toolu_UNRELATED', content: 'someone-else' },
          ]},
        ],
      },
    };
    const lookahead = lookaheadToolResults(reqK1, buildCombinedToolUseMap(reqK));
    assert.deepEqual(Object.keys(lookahead).sort(), ['toolu_KNOWN']);
    assert.equal(lookahead['toolu_UNRELATED'], undefined);
  });

  it('只扫最后一条 user 消息: 老历史 turn 不会重复匹配', () => {
    const reqK = makeReq({
      currentTurnUses: [{ type: 'tool_use', id: 'toolu_NEW', name: 'Bash', input: {} }],
    });
    // K+1 body.messages 中既有历史 turn (id=OLD) 又有当前 turn 的 result (id=NEW)
    const reqK1 = {
      body: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_OLD', name: 'Read', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_OLD', content: 'OLD' }] },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_NEW', name: 'Bash', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_NEW', content: 'NEW' }] },
        ],
      },
    };
    const lookahead = lookaheadToolResults(reqK1, buildCombinedToolUseMap(reqK));
    assert.deepEqual(Object.keys(lookahead).sort(), ['toolu_NEW']);
    assert.equal(lookahead['toolu_NEW'].resultText, 'NEW');
  });

  it('全局索引: 并行 SubAgent 交错 (result 在 K+5, 其他 agent 穿插) 仍能命中', () => {
    const reqK = makeReq({
      currentTurnUses: [{ type: 'tool_use', id: 'tooluA_tail', name: 'Bash', input: {} }],
    });
    const otherReq = (id) => ({
      body: { messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: id, name: 'Read', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'other' }] },
      ]},
    });
    const reqK5 = {
      body: { messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tooluA_tail', name: 'Bash', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tooluA_tail', content: 'A-result' }] },
      ]},
    };
    const requests = [reqK, otherReq('foo1'), otherReq('foo2'), otherReq('foo3'), otherReq('foo4'), reqK5];
    const globalIndex = buildGlobalToolResultIndex(requests);
    assert.equal(globalIndex['tooluA_tail'].resultText, 'A-result');
    assert.equal(globalIndex['tooluA_tail'].toolName, 'Bash');
    // 其他 agent 的 result 也在索引里,但渲染时只看本 entry 的 respContent.tool_use,不会被错配
    assert.equal(globalIndex['foo1'].resultText, 'other');
  });

  it('全局索引: 首次出现的 result 占位 (后续重复 id 不覆盖)', () => {
    // 极端场景(nanoid 实际不会冲突,仍写测试锁定语义):
    const requests = [
      { body: { messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'dup', name: 'A', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'dup', content: 'first' }] },
      ]}},
      { body: { messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'dup', content: 'second' }] },
      ]}},
    ];
    const globalIndex = buildGlobalToolResultIndex(requests);
    assert.equal(globalIndex['dup'].resultText, 'first', '首次出现的 result 保留');
  });

  it('全局索引: 空 requests / 无效输入返回空对象', () => {
    assert.deepEqual(buildGlobalToolResultIndex([]), {});
    assert.deepEqual(buildGlobalToolResultIndex(null), {});
    assert.deepEqual(buildGlobalToolResultIndex(undefined), {});
  });

  it('历史 turn (use+result 都在 K 自身 body.messages 内) 不被 lookahead 影响,保留主路径处理', () => {
    // 模拟 ChatView 的真实合并: localState.toolResultMap = 主路径 + lookahead 补偿
    // 这里只验证 lookahead 不会覆盖或干扰本地已配对的历史
    const reqK = {
      body: {
        messages: [
          { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_hist', name: 'Read', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_hist', content: 'historical' }] },
        ],
      },
      response: {
        body: { content: [{ type: 'tool_use', id: 'tu_tail', name: 'Bash', input: {} }] },
      },
    };
    const reqK1 = {
      body: {
        messages: [
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_tail', content: 'tail-result' }] },
        ],
      },
    };
    const localToolResultMap = { tu_hist: { resultText: 'historical', toolName: 'Read' } };
    const lookahead = lookaheadToolResults(reqK1, buildCombinedToolUseMap(reqK));
    const merged = { ...localToolResultMap, ...lookahead };
    // 历史 tu_hist 仍由本地路径提供
    assert.equal(merged['tu_hist'].resultText, 'historical');
    // 末轮 tu_tail 由 lookahead 补偿
    assert.equal(merged['tu_tail'].resultText, 'tail-result');
    assert.equal(merged['tu_tail'].toolName, 'Bash');
  });
});
