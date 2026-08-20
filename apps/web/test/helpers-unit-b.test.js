// Covers src/utils/helpers.js 后半部分导出（源文件 395~804 行）:
//   stripPrivateKeys, computeTokenStats, computeCacheRebuildStats,
//   computeToolUsageStats, computeSkillUsageStats, isClaudeMdReminder,
//   isSkillsReminder, hasClaudeMdReminder, hasSkillsReminder,
//   extractLoadedSkills, getModelShort, isRelevantRequest,
//   filterRelevantRequests, findPrevMainAgentTimestamp,
//   extractCachedContent (130 行大函数，分支重点), parseCachedTools
//
// helpers.js import 了多个 svg —— 用 _shims/register.mjs loader + 动态 import 加载。
// 测试针对【当前工作区状态】行为 pin 现状，不触碰任何源码。

import './_shims/register.mjs';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let H;
before(async () => {
  H = await import('../src/utils/helpers.js');
});

// ─────────────────────────────────────────────────────────────
// MainAgent 构造辅助：req.mainAgent=true + 普通 system 文本即被 isMainAgent 认可。
// SUBAGENT_SYSTEM_RE / teammate 标记会反向排除（isMainAgent 实现见 contentFilter.js）。
function mainAgentReq(extra = {}) {
  return {
    mainAgent: true,
    body: { system: 'You are Claude Code, a helpful assistant.', ...(extra.body || {}) },
    ...extra,
  };
}
// 非 MainAgent：无 mainAgent 标记、无合格 tools/system。
function plainReq(extra = {}) {
  return { body: {}, ...extra };
}

// ─────────────────────────────────────────────────────────────
describe('stripPrivateKeys', () => {
  it('删除对象中所有 _ 前缀的 key', () => {
    const out = H.stripPrivateKeys({ a: 1, _hidden: 2, b: 'x' });
    assert.deepEqual(out, { a: 1, b: 'x' });
  });

  it('递归处理嵌套对象与数组', () => {
    const input = {
      keep: { _drop: 1, inner: 2 },
      list: [{ _x: 9, y: 3 }, { z: 4 }],
      _topPrivate: 'gone',
    };
    assert.deepEqual(H.stripPrivateKeys(input), {
      keep: { inner: 2 },
      list: [{ y: 3 }, { z: 4 }],
    });
  });

  it('数组顶层调用映射每个元素', () => {
    assert.deepEqual(H.stripPrivateKeys([{ _a: 1, b: 2 }, 5]), [{ b: 2 }, 5]);
  });

  it('原始值原样返回（含 null）', () => {
    assert.equal(H.stripPrivateKeys(42), 42);
    assert.equal(H.stripPrivateKeys('s'), 's');
    assert.equal(H.stripPrivateKeys(null), null);
    assert.equal(H.stripPrivateKeys(undefined), undefined);
  });

  it('不修改原对象（返回新对象）', () => {
    const orig = { a: 1, _p: 2 };
    const out = H.stripPrivateKeys(orig);
    assert.notEqual(out, orig);
    assert.ok('_p' in orig); // 原对象未被改
  });
});

// ─────────────────────────────────────────────────────────────
describe('computeTokenStats', () => {
  it('按 model 聚合 usage 各字段', () => {
    const requests = [
      { body: { model: 'claude-x' }, response: { body: { usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 } } } },
      { body: { model: 'claude-x' }, response: { body: { usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 1 } } } },
      { body: { model: 'gpt-y' }, response: { body: { usage: { input_tokens: 100, output_tokens: 0 } } } },
    ];
    const stats = H.computeTokenStats(requests);
    assert.deepEqual(stats['claude-x'], { input: 11, output: 6, cacheCreation: 4, cacheRead: 3 });
    assert.deepEqual(stats['gpt-y'], { input: 100, output: 0, cacheCreation: 0, cacheRead: 0 });
  });

  it('缺少 usage 的请求被跳过', () => {
    const requests = [
      { body: { model: 'm' }, response: { body: {} } },
      { body: { model: 'm' } },
    ];
    assert.deepEqual(H.computeTokenStats(requests), {});
  });

  it('缺少 model 时归入 unknown', () => {
    const requests = [{ body: {}, response: { body: { usage: { input_tokens: 7 } } } }];
    const stats = H.computeTokenStats(requests);
    assert.equal(stats.unknown.input, 7);
  });

  it('空数组返回空对象', () => {
    assert.deepEqual(H.computeTokenStats([]), {});
  });
});

// ─────────────────────────────────────────────────────────────
describe('computeCacheRebuildStats', () => {
  it('TTL 超时（相邻 MainAgent 间隔 > 5min）计为 ttl 重建', () => {
    const reqs = [
      { mainAgent: true, timestamp: 0, body: { system: 'You are Claude Code', model: 'm', messages: [] }, response: { body: { usage: { cache_creation_input_tokens: 0 } } } },
      { mainAgent: true, timestamp: 6 * 60 * 1000, body: { system: 'You are Claude Code', model: 'm', messages: [] }, response: { body: { usage: { cache_creation_input_tokens: 500 } } } },
    ];
    const stats = H.computeCacheRebuildStats(reqs);
    assert.equal(stats.ttl.count, 1);
    assert.equal(stats.ttl.cacheCreate, 500);
    // 其它原因 0
    assert.equal(stats.model_change.count, 0);
  });

  it('model 变化 + system 变化 同时被统计（多 reason）', () => {
    const reqs = [
      { mainAgent: true, timestamp: 0, body: { system: 'You are Claude Code A', model: 'm1', messages: [] }, response: { body: { usage: { cache_creation_input_tokens: 0 } } } },
      { mainAgent: true, timestamp: 1000, body: { system: 'You are Claude Code B', model: 'm2', messages: [] }, response: { body: { usage: { cache_creation_input_tokens: 200 } } } },
    ];
    const stats = H.computeCacheRebuildStats(reqs);
    assert.equal(stats.model_change.count, 1);
    assert.equal(stats.model_change.cacheCreate, 200);
    assert.equal(stats.system_change.count, 1);
    assert.equal(stats.system_change.cacheCreate, 200);
  });

  it('完全无重建（无相邻 MainAgent 对比）时所有计数为 0', () => {
    const stats = H.computeCacheRebuildStats([
      { mainAgent: true, timestamp: 0, body: { system: 'You are Claude Code', model: 'm', messages: [] }, response: { body: { usage: {} } } },
    ]);
    for (const k of Object.keys(stats)) {
      assert.equal(stats[k].count, 0, `${k} count`);
    }
  });
});

// ─────────────────────────────────────────────────────────────
describe('computeToolUsageStats', () => {
  it('统计 response.content 中 tool_use 块并按降序排列', () => {
    const reqs = [
      { response: { body: { content: [
        { type: 'tool_use', name: 'Read' },
        { type: 'tool_use', name: 'Bash' },
        { type: 'text', text: 'hi' },
      ] } } },
      { response: { body: { content: [
        { type: 'tool_use', name: 'Read' },
        { type: 'tool_use', name: 'Read' },
      ] } } },
    ];
    const stats = H.computeToolUsageStats(reqs);
    assert.deepEqual(stats, [['Read', 3], ['Bash', 1]]);
  });

  it('content 非数组 / tool_use 缺 name 被忽略', () => {
    const reqs = [
      { response: { body: { content: 'notarray' } } },
      { response: { body: { content: [{ type: 'tool_use' }] } } }, // 无 name
      {},
    ];
    assert.deepEqual(H.computeToolUsageStats(reqs), []);
  });
});

// ─────────────────────────────────────────────────────────────
describe('computeSkillUsageStats', () => {
  // isSkillText: 文本 trim 后以 "Base directory for this skill:" 开头
  const skillText = (name) => `Base directory for this skill: /x\n# ${name}\nblah`;

  it('从 user 消息的 skill text 块中提取 # 后的 skill 名并计数', () => {
    const reqs = [
      { body: { messages: [
        { role: 'user', content: [{ type: 'text', text: skillText('deep-research') }] },
      ] } },
      { body: { messages: [
        { role: 'user', content: [{ type: 'text', text: skillText('deep-research') }] },
        { role: 'user', content: [{ type: 'text', text: skillText('verify') }] },
      ] } },
    ];
    const stats = H.computeSkillUsageStats(reqs);
    assert.deepEqual(stats, [['deep-research', 2], ['verify', 1]]);
  });

  it('skill text 无 # 标题行时归为 "Skill"', () => {
    const reqs = [{ body: { messages: [
      { role: 'user', content: [{ type: 'text', text: 'Base directory for this skill: /p\nno heading' }] },
    ] } }];
    assert.deepEqual(H.computeSkillUsageStats(reqs), [['Skill', 1]]);
  });

  it('非 user 角色 / 非 skill 文本 / content 非数组 被跳过', () => {
    const reqs = [
      { body: { messages: [{ role: 'assistant', content: [{ type: 'text', text: skillText('x') }] }] } },
      { body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'ordinary text' }] }] } },
      { body: { messages: [{ role: 'user', content: 'string-not-array' }] } },
      { body: {} },
    ];
    assert.deepEqual(H.computeSkillUsageStats(reqs), []);
  });
});

// ─────────────────────────────────────────────────────────────
describe('isClaudeMdReminder / isSkillsReminder', () => {
  it('isClaudeMdReminder 需同时含 <system-reminder> 与 # claudeMd', () => {
    assert.equal(H.isClaudeMdReminder('<system-reminder>\n# claudeMd\n...'), true);
    assert.equal(H.isClaudeMdReminder('<system-reminder> only'), false);
    assert.equal(H.isClaudeMdReminder('# claudeMd only'), false);
    assert.equal(H.isClaudeMdReminder(123), false);
    assert.equal(H.isClaudeMdReminder(null), false);
  });

  it('isSkillsReminder 需含 <system-reminder> 与 "skills are available"', () => {
    assert.equal(H.isSkillsReminder('<system-reminder>skills are available</system-reminder>'), true);
    assert.equal(H.isSkillsReminder('<system-reminder> nope'), false);
    assert.equal(H.isSkillsReminder('skills are available'), false);
    assert.equal(H.isSkillsReminder(undefined), false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('hasClaudeMdReminder', () => {
  const cmd = '<system-reminder>\n# claudeMd\nrules';

  it('messages 中字符串 content 命中', () => {
    assert.equal(H.hasClaudeMdReminder({ messages: [{ content: cmd }] }), true);
  });

  it('messages 中数组 text 块命中', () => {
    assert.equal(H.hasClaudeMdReminder({ messages: [
      { content: [{ type: 'text', text: cmd }] },
    ] }), true);
  });

  it('无命中返回 false；body 非法返回 false', () => {
    assert.equal(H.hasClaudeMdReminder({ messages: [{ content: 'plain' }] }), false);
    assert.equal(H.hasClaudeMdReminder({ messages: 'notarray' }), false);
    assert.equal(H.hasClaudeMdReminder(null), false);
    assert.equal(H.hasClaudeMdReminder({}), false);
  });

  it('数组中非 text 块被忽略', () => {
    assert.equal(H.hasClaudeMdReminder({ messages: [
      { content: [{ type: 'image' }, { type: 'text', text: cmd }] },
    ] }), true);
  });

  it('数组 text 块全不匹配 → 遍历结束后 false（覆盖 array-no-match 落穿）', () => {
    assert.equal(H.hasClaudeMdReminder({ messages: [
      { content: [{ type: 'text', text: 'irrelevant' }, { type: 'text', text: 'still no' }] },
    ] }), false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('hasSkillsReminder', () => {
  const sk = '<system-reminder>skills are available for use</system-reminder>';

  it('扫描 system[] 的 text 块', () => {
    assert.equal(H.hasSkillsReminder({ system: [{ type: 'text', text: sk }] }), true);
  });

  it('扫描 messages 字符串 content', () => {
    assert.equal(H.hasSkillsReminder({ messages: [{ content: sk }] }), true);
  });

  it('扫描 messages 数组 text 块', () => {
    assert.equal(H.hasSkillsReminder({ messages: [{ content: [{ type: 'text', text: sk }] }] }), true);
  });

  it('system 命中即返回，无需 messages', () => {
    assert.equal(H.hasSkillsReminder({ system: [{ type: 'text', text: sk }], messages: 'x' }), true);
  });

  it('无命中且 messages 非数组返回 false', () => {
    assert.equal(H.hasSkillsReminder({ system: [{ type: 'text', text: 'no' }], messages: 'x' }), false);
    assert.equal(H.hasSkillsReminder({}), false);
  });

  it('messages 数组 text 块全不匹配 → 遍历结束后 false（覆盖 array-no-match 落穿）', () => {
    assert.equal(H.hasSkillsReminder({ messages: [
      { content: [{ type: 'text', text: 'nope' }, { type: 'image' }] },
      { content: 'also plain' },
    ] }), false);
  });
});

// ─────────────────────────────────────────────────────────────
describe('extractLoadedSkills', () => {
  const reminder = (body) =>
    `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- deep-research: Deep research harness\n- verify: Verify code change\n</system-reminder>`;

  it('单请求直取，解析 system[] 中的 skills', () => {
    const req = { body: { system: [{ type: 'text', text: reminder() }] } };
    const skills = H.extractLoadedSkills([req]);
    assert.deepEqual(skills.map(s => s.name), ['deep-research', 'verify']);
    assert.equal(skills[0].description, 'Deep research harness');
  });

  it('多请求逆序选最新 MainAgent', () => {
    const maOld = { mainAgent: true, body: { system: 'You are Claude Code', messages: [
      { role: 'user', content: [{ type: 'text', text: `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- old-skill: old\n</system-reminder>` }] },
    ] } };
    const maNew = { mainAgent: true, body: { system: 'You are Claude Code', messages: [
      { role: 'user', content: [{ type: 'text', text: `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- new-skill: brand new\n</system-reminder>` }] },
    ] } };
    const skills = H.extractLoadedSkills([maOld, plainReq(), maNew]);
    assert.deepEqual(skills.map(s => s.name), ['new-skill']);
  });

  it('messages 中字符串 content 也被扫描', () => {
    const req = { body: { messages: [
      { role: 'user', content: `<system-reminder>\nThe following skills are available for use with the Skill tool:\n\n- str-skill: from string\n</system-reminder>` },
    ] } };
    assert.deepEqual(H.extractLoadedSkills([req]).map(s => s.name), ['str-skill']);
  });

  it('无 reminder 时返回空数组', () => {
    assert.deepEqual(H.extractLoadedSkills([{ body: { system: [{ type: 'text', text: 'hi' }] } }]), []);
  });

  it('空输入 / 非数组 / 无 body 返回空数组', () => {
    assert.deepEqual(H.extractLoadedSkills([]), []);
    assert.deepEqual(H.extractLoadedSkills(null), []);
    assert.deepEqual(H.extractLoadedSkills([{ noBody: 1 }]), []);
  });

  it('多请求但无 MainAgent 命中 → chosen=null → 空数组', () => {
    assert.deepEqual(H.extractLoadedSkills([plainReq(), plainReq()]), []);
  });
});

// ─────────────────────────────────────────────────────────────
describe('getModelShort', () => {
  it('剥离 claude- 前缀与 8+ 位日期后缀', () => {
    assert.equal(H.getModelShort('claude-sonnet-4-20250514'), 'sonnet-4');
    assert.equal(H.getModelShort('claude-opus-4-1-20250805'), 'opus-4-1');
  });

  it('无前缀/无日期后缀原样返回', () => {
    assert.equal(H.getModelShort('gpt-4o'), 'gpt-4o');
  });

  it('仅剥离 8 位及以上的尾部数字（7 位不剥）', () => {
    assert.equal(H.getModelShort('model-1234567'), 'model-1234567'); // 7 位，不剥
    assert.equal(H.getModelShort('model-12345678'), 'model'); // 8 位，剥
  });

  it('空值返回 null', () => {
    assert.equal(H.getModelShort(''), null);
    assert.equal(H.getModelShort(null), null);
    assert.equal(H.getModelShort(undefined), null);
  });
});

// ─────────────────────────────────────────────────────────────
describe('isRelevantRequest / filterRelevantRequests', () => {
  it('普通请求相关', () => {
    assert.equal(H.isRelevantRequest({ url: '/v1/messages', body: {} }), true);
  });

  it('心跳/计数 token 被过滤', () => {
    assert.equal(H.isRelevantRequest({ isHeartbeat: true }), false);
    assert.equal(H.isRelevantRequest({ isCountTokens: true }), false);
  });

  it('eval sdk / count_tokens URL 被过滤', () => {
    assert.equal(H.isRelevantRequest({ url: '/api/eval/sdk-foo' }), false);
    assert.equal(H.isRelevantRequest({ url: '/v1/messages/count_tokens' }), false);
  });

  it('在途请求 / 状态 0 被过滤', () => {
    assert.equal(H.isRelevantRequest({ url: '/x', inProgress: true }), false);
    assert.equal(H.isRelevantRequest({ url: '/x', response: { status: 0 } }), false);
  });

  it('配额检查请求（max_tokens=1 且无 system 无 tools）被过滤', () => {
    assert.equal(H.isRelevantRequest({ url: '/x', body: { max_tokens: 1 } }), false);
    assert.equal(H.isRelevantRequest({ url: '/x', body: { max_tokens: 1, tools: [] } }), false);
    // 有 system → 不算配额检查
    assert.equal(H.isRelevantRequest({ url: '/x', body: { max_tokens: 1, system: 'x' } }), true);
    // 有 tools → 不算配额检查
    assert.equal(H.isRelevantRequest({ url: '/x', body: { max_tokens: 1, tools: [{ name: 't' }] } }), true);
  });

  it('falsy request 返回 false', () => {
    assert.equal(H.isRelevantRequest(null), false);
    assert.equal(H.isRelevantRequest(undefined), false);
  });

  it('filterRelevantRequests 过滤掉无关项', () => {
    const reqs = [
      { url: '/ok', body: {} },
      { isHeartbeat: true },
      { url: '/api/eval/sdk-x' },
    ];
    const out = H.filterRelevantRequests(reqs);
    assert.equal(out.length, 1);
    assert.equal(out[0].url, '/ok');
  });
});

// ─────────────────────────────────────────────────────────────
describe('findPrevMainAgentTimestamp', () => {
  it('从 startIndex-1 逆向找到最近的 MainAgent 时间戳', () => {
    const reqs = [
      mainAgentReq({ timestamp: 100 }),
      plainReq({ timestamp: 200 }),
      mainAgentReq({ timestamp: 300 }),
      plainReq({ timestamp: 400 }),
    ];
    assert.equal(H.findPrevMainAgentTimestamp(reqs, 4), 300);
    assert.equal(H.findPrevMainAgentTimestamp(reqs, 2), 100);
  });

  it('无前置 MainAgent 返回 null', () => {
    const reqs = [plainReq({ timestamp: 1 }), plainReq({ timestamp: 2 })];
    assert.equal(H.findPrevMainAgentTimestamp(reqs, 2), null);
  });

  it('MainAgent 但无 timestamp 跳过', () => {
    const reqs = [mainAgentReq({}), plainReq({ timestamp: 5 })];
    // index 0 是 MainAgent 但无 timestamp → 返回 null
    assert.equal(H.findPrevMainAgentTimestamp(reqs, 1), null);
  });
});

// ─────────────────────────────────────────────────────────────
describe('extractCachedContent', () => {
  it('空/非数组返回 null', () => {
    assert.equal(H.extractCachedContent([]), null);
    assert.equal(H.extractCachedContent(null), null);
  });

  it('chosen 无 body 返回 null', () => {
    assert.equal(H.extractCachedContent([{ noBody: true }]), null);
  });

  it('单请求：提取 system 到最后一个 cache_control 标记为止', () => {
    const req = { body: {
      system: [
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'C' }, // 在断点之后，不提取
      ],
    }, response: { body: { usage: { cache_creation_input_tokens: 50, cache_read_input_tokens: 20 } } } };
    const out = H.extractCachedContent([req]);
    assert.deepEqual(out.system, ['A', 'B']);
    assert.equal(out.cacheCreateTokens, 50);
    assert.equal(out.cacheReadTokens, 20);
  });

  it('system 无 cache_control 标记 → system 为空', () => {
    const req = { body: { system: [{ type: 'text', text: 'A' }] } };
    assert.deepEqual(H.extractCachedContent([req]).system, []);
  });

  it('messages：提取到最后一个带 cache_control 的消息，含 string/text/tool_use/tool_result 块', () => {
    const longInput = { foo: 'x'.repeat(400) };
    const req = { body: {
      system: [{ type: 'text', text: 'sys', cache_control: {} }], // 需要 system 才会提取 tools
      messages: [
        { role: 'user', content: 'hi there' },
        { role: 'assistant', content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', name: 'Read', input: longInput },
        ] },
        { role: 'tool', content: [
          { type: 'tool_result', tool_use_id: 'tid', content: 'result text', cache_control: {} },
        ] },
        { role: 'user', content: 'after breakpoint' }, // 断点之后，不提取
      ],
    } };
    const out = H.extractCachedContent([req]);
    assert.deepEqual(out.messages, [
      '[user] hi there',
      '[assistant] thinking',
      // tool_use 的 input JSON 超 200 字符被截断 + '...'
      `[assistant] Read(${JSON.stringify(longInput).substring(0, 200)}...)`,
      '[tool_result: tid] result text',
    ]);
  });

  it('messages 无 cache_control 但 cacheRead>0 → 提取全部消息（fallback）', () => {
    const req = { body: {
      messages: [
        { role: 'user', content: 'one' },
        { role: 'user', content: 'two' },
      ],
    }, response: { body: { usage: { cache_read_input_tokens: 99 } } } };
    const out = H.extractCachedContent([req]);
    assert.deepEqual(out.messages, ['[user] one', '[user] two']);
  });

  it('messages 无 cache_control 且 cacheRead=0 → messages 为空', () => {
    const req = { body: { messages: [{ role: 'user', content: 'x' }] } };
    assert.deepEqual(H.extractCachedContent([req]).messages, []);
  });

  it('tool_use input 短于 200 字符不截断', () => {
    const req = { body: {
      messages: [{ role: 'assistant', content: [
        { type: 'tool_use', name: 'Bash', input: { cmd: 'ls' }, cache_control: {} },
      ] }],
    } };
    const out = H.extractCachedContent([req]);
    assert.deepEqual(out.messages, ['[assistant] Bash({"cmd":"ls"})']);
  });

  it('tool_use 无 input → 空括号', () => {
    const req = { body: { messages: [{ role: 'assistant', content: [
      { type: 'tool_use', name: 'Noop', cache_control: {} },
    ] }] } };
    assert.deepEqual(H.extractCachedContent([req]).messages, ['[assistant] Noop()']);
  });

  it('tool_result 提取文本为空时被跳过', () => {
    const req = { body: { messages: [{ role: 'tool', content: [
      { type: 'tool_result', tool_use_id: 'a', content: '', cache_control: {} },
    ] }] } };
    // extractToolResultText('') → '' → falsy → 不 push
    assert.deepEqual(H.extractCachedContent([req]).messages, []);
  });

  it('tools 仅当 system 有缓存内容时才提取并格式化为 XML', () => {
    const tool = { name: 'MyTool', description: 'does things', input_schema: { type: 'object', properties: {} } };
    const reqWithSys = { body: {
      system: [{ type: 'text', text: 'sys', cache_control: {} }],
      tools: [tool],
    } };
    const out = H.extractCachedContent([reqWithSys]);
    assert.equal(out.tools.length, 1);
    assert.ok(out.tools[0].includes('<name>MyTool</name>'));
    assert.ok(out.tools[0].includes('<description>does things</description>'));

    // system 无缓存 → tools 不提取
    const reqNoSys = { body: { system: [{ type: 'text', text: 'x' }], tools: [tool] } };
    assert.deepEqual(H.extractCachedContent([reqNoSys]).tools, []);
  });

  it('多请求：逆序选 latestMAWithUsage（优先带 usage 的 MainAgent）', () => {
    const maNoUsage = { mainAgent: true, body: { system: [{ type: 'text', text: 'NO-USAGE', cache_control: {} }] } };
    const maWithUsage = { mainAgent: true, body: { system: [{ type: 'text', text: 'WITH-USAGE', cache_control: {} }] }, response: { body: { usage: { cache_read_input_tokens: 5 } } } };
    // 列表顺序：[withUsage(早), noUsage(晚)]；逆序先遇 noUsage(latestMA)，继续找到 withUsage(有 usage)→break
    const out = H.extractCachedContent([maWithUsage, maNoUsage]);
    assert.deepEqual(out.system, ['WITH-USAGE']);
    assert.equal(out.cacheReadTokens, 5);
  });

  it('多请求：只有不带 usage 的 MainAgent 时回退到 latestMA', () => {
    const ma = { mainAgent: true, body: { system: [{ type: 'text', text: 'ONLY-MA', cache_control: {} }] } };
    const out = H.extractCachedContent([plainReq(), ma]);
    assert.deepEqual(out.system, ['ONLY-MA']);
  });

  it('多请求：无 MainAgent → chosen=null → null', () => {
    assert.equal(H.extractCachedContent([plainReq(), plainReq()]), null);
  });

  it('messages 中非数组 content 不影响（找不到 cache_control 索引）', () => {
    const req = { body: { messages: [{ role: 'user', content: 'plain string only' }] } };
    // 字符串 content 无 cache_control，cacheRead=0 → 不提取
    assert.deepEqual(H.extractCachedContent([req]).messages, []);
  });
});

// ─────────────────────────────────────────────────────────────
describe('parseCachedTools', () => {
  const xmlTool = (name, desc) =>
    `<tool>\n  <name>${name}</name>\n  <description>${desc}</description>\n</tool>`;

  it('非数组返回空 builtin 与空 Map', () => {
    const r = H.parseCachedTools(null);
    assert.deepEqual(r.builtin, []);
    assert.ok(r.mcpByServer instanceof Map);
    assert.equal(r.mcpByServer.size, 0);
  });

  it('解析 XML 块的 builtin 工具', () => {
    const r = H.parseCachedTools([xmlTool('Read', 'Read a file'), xmlTool('Bash', 'Run cmd')]);
    assert.deepEqual(r.builtin, [
      { name: 'Read', description: 'Read a file' },
      { name: 'Bash', description: 'Run cmd' },
    ]);
    assert.equal(r.mcpByServer.size, 0);
  });

  it('XML 块缺 description → 空字符串', () => {
    const r = H.parseCachedTools(['<tool>\n  <name>NoDesc</name>\n</tool>']);
    assert.deepEqual(r.builtin, [{ name: 'NoDesc', description: '' }]);
  });

  it('MCP 工具按 server 分组，非贪心切分 server 名（含下划线）', () => {
    const r = H.parseCachedTools([
      xmlTool('mcp__some_server__do_thing', 'desc1'),
      xmlTool('mcp__some_server__other', 'desc2'),
      xmlTool('mcp__other_srv__act', 'desc3'),
    ]);
    assert.deepEqual([...r.mcpByServer.keys()], ['some_server', 'other_srv']);
    const grp = r.mcpByServer.get('some_server');
    assert.deepEqual(grp, [
      { name: 'do_thing', fullName: 'mcp__some_server__do_thing', description: 'desc1' },
      { name: 'other', fullName: 'mcp__some_server__other', description: 'desc2' },
    ]);
    assert.equal(r.builtin.length, 0);
  });

  it('向前兼容："name: description" 旧格式', () => {
    const r = H.parseCachedTools(['LegacyTool: legacy description']);
    assert.deepEqual(r.builtin, [{ name: 'LegacyTool', description: 'legacy description' }]);
  });

  it('旧格式无冒号 → 整串作为 name，desc 空', () => {
    const r = H.parseCachedTools(['JustAName']);
    assert.deepEqual(r.builtin, [{ name: 'JustAName', description: '' }]);
  });

  it('空字符串 / 非字符串项被跳过', () => {
    const r = H.parseCachedTools(['', null, 42, xmlTool('Keep', 'kept')]);
    assert.deepEqual(r.builtin, [{ name: 'Keep', description: 'kept' }]);
  });

  it('XML 块 name 为空 → 跳过该项', () => {
    const r = H.parseCachedTools(['<tool>\n  <name>   </name>\n  <description>d</description>\n</tool>']);
    assert.deepEqual(r.builtin, []);
    assert.equal(r.mcpByServer.size, 0);
  });
});
