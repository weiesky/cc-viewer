/**
 * 单元测试目标：src/utils/toolResultBuilder.js
 *
 * 覆盖导出：
 *   getToolResultCache / setToolResultCache（WeakMap 缓存）
 *   createEmptyToolState / createEmptyGlobalIndexState（初始 state 形状）
 *   buildSingleToolResult（i18n label 包装：Task→SubAgent，其它→named，无 tool→generic）
 *   buildGlobalToolResultIndex / appendToGlobalToolResultIndex（两遍扫描、增量、image budget LRU）
 *   buildSubAgentResultMap（本地 + 全局索引补偿，null sentinel）
 *   appendToolResultMap（160 行大函数：Write/Edit/ExitPlanMode plan 追踪、editSnapshot LRU、
 *     Read→readContentMap/_fileState 行号解析与合并、AskUserQuestion cancel/reject/answer、
 *     ExitPlanMode 审批）
 *   buildToolResultMap / cachedBuildToolResultMap
 *   parseAskAnswerText / parsePlanApproval（纯文本解析）
 *
 * 该模块 `import '../i18n'`（无扩展名）→ 必须 _shims loader + 动态 import。
 * label 断言在 before() 里 pin currentLang='en'：t('ui.toolReturn')='Tool result'，
 * t('ui.toolReturnNamed',{name})='{name} result'。
 */
import './_shims/register.mjs';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let M;
let i18n;
let _savedLang;
// label 断言依赖 currentLang。Node 环境无浏览器 navigator → detectLanguage 落 'en'，
// 但为确定性（不受 host navigator.language 影响）在 before() 显式 pin 到 'en'，after() 还原。
before(async () => {
  M = await import('../src/utils/toolResultBuilder.js');
  i18n = await import('../src/i18n.js');
  _savedLang = i18n.getLang();
  i18n.setLang('en');
});
after(() => {
  if (i18n && _savedLang) i18n.setLang(_savedLang);
});

// ── 构造辅助 ────────────────────────────────────────────────────────────────
function use(id, name, input) {
  return { type: 'tool_use', id, name, input };
}
function result(toolUseId, content, extra = {}) {
  return { type: 'tool_result', tool_use_id: toolUseId, content, ...extra };
}
function asstMsg(content) {
  return { role: 'assistant', content };
}
function userMsg(content) {
  return { role: 'user', content };
}

// ── getToolResultCache / setToolResultCache ─────────────────────────────────
describe('toolResultCache (WeakMap)', () => {
  it('returns null for未缓存的 messages', () => {
    const msgs = [];
    assert.equal(M.getToolResultCache(msgs), null);
  });

  it('set 后 get 返回同一 state 引用', () => {
    const msgs = [];
    const state = { tag: 'x' };
    M.setToolResultCache(msgs, state);
    assert.equal(M.getToolResultCache(msgs), state);
  });

  it('不同 messages 引用互不干扰', () => {
    const a = [];
    const b = [];
    M.setToolResultCache(a, { id: 'A' });
    assert.equal(M.getToolResultCache(b), null);
    assert.equal(M.getToolResultCache(a).id, 'A');
  });
});

// ── createEmptyToolState ────────────────────────────────────────────────────
describe('createEmptyToolState', () => {
  it('返回完整的空 state 形状', () => {
    const s = M.createEmptyToolState();
    assert.deepEqual(s.toolUseMap, {});
    assert.deepEqual(s.toolResultMap, {});
    assert.deepEqual(s.readContentMap, {});
    assert.deepEqual(s.editSnapshotMap, {});
    assert.deepEqual(s.askAnswerMap, {});
    assert.deepEqual(s.planApprovalMap, {});
    assert.equal(s.latestPlanContent, null);
    assert.equal(s.latestPlanFilePath, null);
    assert.deepEqual(s._fileState, {});
    assert.deepEqual(s._editOrder, []);
  });

  it('每次调用返回全新对象（不共享引用）', () => {
    const a = M.createEmptyToolState();
    const b = M.createEmptyToolState();
    assert.notEqual(a, b);
    assert.notEqual(a.toolUseMap, b.toolUseMap);
  });
});

// ── createEmptyGlobalIndexState ─────────────────────────────────────────────
describe('createEmptyGlobalIndexState', () => {
  it('返回 { index, _useMap, _imageEntryIds }', () => {
    const s = M.createEmptyGlobalIndexState();
    assert.deepEqual(s.index, {});
    assert.deepEqual(s._useMap, {});
    assert.deepEqual(s._imageEntryIds, []);
  });
});

// ── buildSingleToolResult（i18n label） ─────────────────────────────────────
describe('buildSingleToolResult — label 包装', () => {
  it('无 matchedTool → generic label "Tool result"', () => {
    const entry = M.buildSingleToolResult(result('id1', 'hello'), undefined);
    assert.equal(entry.label, 'Tool result');
    assert.equal(entry.resultText, 'hello');
    assert.equal(entry.toolName, null);
    assert.equal(entry.isError, false);
  });

  it('普通工具 → named label "<name> result"', () => {
    const entry = M.buildSingleToolResult(result('id1', 'out'), use('id1', 'Bash', { command: 'ls' }));
    assert.equal(entry.label, 'Bash result');
    assert.equal(entry.toolName, 'Bash');
    assert.equal(entry.toolInput.command, 'ls');
  });

  it('Task 工具 → SubAgent label 含 subagent_type 与 description', () => {
    const entry = M.buildSingleToolResult(
      result('t1', 'done'),
      use('t1', 'Task', { subagent_type: 'researcher', description: '查资料' }),
    );
    assert.equal(entry.label, 'SubAgent: researcher — 查资料');
  });

  it('Task 工具无 description → 只显示 subagent_type', () => {
    const entry = M.buildSingleToolResult(
      result('t2', 'done'),
      use('t2', 'Task', { subagent_type: 'tester' }),
    );
    assert.equal(entry.label, 'SubAgent: tester');
  });

  it('Task 工具 input 缺失 → 回退到 named label', () => {
    // matchedTool.name === 'Task' 但 input falsy → 走 else 分支 named
    const entry = M.buildSingleToolResult(result('t3', 'done'), { name: 'Task', input: null, id: 't3' });
    assert.equal(entry.label, 'Task result');
  });

  it('error 块 → isError=true 透传', () => {
    const entry = M.buildSingleToolResult(result('e1', 'boom', { is_error: true }), use('e1', 'Bash', {}));
    assert.equal(entry.isError, true);
  });
});

// ── buildGlobalToolResultIndex / appendToGlobalToolResultIndex ───────────────
describe('buildGlobalToolResultIndex', () => {
  it('空 / 非数组输入 → 空 index', () => {
    assert.deepEqual(buildIdx([]), {});
    assert.deepEqual(buildIdx(null), {});
    assert.deepEqual(buildIdx(undefined), {});
  });

  function buildIdx(requests) {
    return M.buildGlobalToolResultIndex(requests);
  }

  it('body.messages 的 tool_use + tool_result 配对建索引并补 label', () => {
    const requests = [
      {
        body: {
          messages: [
            asstMsg([use('A', 'Read', { file_path: '/a' })]),
            userMsg([result('A', 'file content')]),
          ],
        },
      },
    ];
    const idx = buildIdx(requests);
    assert.equal(idx['A'].resultText, 'file content');
    assert.equal(idx['A'].toolName, 'Read');
    assert.equal(idx['A'].label, 'Read result');
  });

  it('response.body.content 的末轮 tool_use 也能为 result 提供 toolName', () => {
    const requests = [
      { response: { body: { content: [use('tail', 'Bash', { command: 'x' })] } } },
      { body: { messages: [userMsg([result('tail', 'tail-out')])] } },
    ];
    const idx = buildIdx(requests);
    assert.equal(idx['tail'].toolName, 'Bash');
    assert.equal(idx['tail'].resultText, 'tail-out');
  });

  it('交错并发：result 在后续请求穿插仍命中', () => {
    const other = (id) => ({
      body: { messages: [asstMsg([use(id, 'X', {})]), userMsg([result(id, 'o')])] },
    });
    const requests = [
      { response: { body: { content: [use('A', 'Bash', {})] } } },
      other('f1'),
      other('f2'),
      { body: { messages: [userMsg([result('A', 'A-result')])] } },
    ];
    const idx = buildIdx(requests);
    assert.equal(idx['A'].resultText, 'A-result');
    assert.equal(idx['f1'].resultText, 'o');
  });

  it('首次出现的 result 占位，重复 id 不覆盖', () => {
    const requests = [
      { body: { messages: [userMsg([result('dup', 'first')])] } },
      { body: { messages: [userMsg([result('dup', 'second')])] } },
    ];
    assert.equal(buildIdx(requests)['dup'].resultText, 'first');
  });

  it('跳过 null request / 非数组 messages / 非 user 角色 / 非 content 数组', () => {
    const requests = [
      null,
      { body: { messages: 'not-array' } },
      { body: { messages: [asstMsg([use('z', 'Read', {})])] } }, // assistant 不出 result
      { body: { messages: [{ role: 'user', content: 'not-array' }] } },
      { body: {} },
    ];
    assert.deepEqual(buildIdx(requests), {});
  });
});

describe('appendToGlobalToolResultIndex — 增量与幂等', () => {
  it('startIndex 控制只扫切片，重复 append 同一切片不引入副作用', () => {
    const state = M.createEmptyGlobalIndexState();
    const requests = [
      { body: { messages: [asstMsg([use('A', 'Read', {})]), userMsg([result('A', 'ra')])] } },
      { body: { messages: [asstMsg([use('B', 'Bash', {})]), userMsg([result('B', 'rb')])] } },
    ];
    M.appendToGlobalToolResultIndex(state, requests, 0);
    assert.equal(state.index['A'].resultText, 'ra');
    assert.equal(state.index['B'].resultText, 'rb');
    const aRef = state.index['A'];
    // 重复 append：!(id in index) 短路，原 entry 引用不变
    M.appendToGlobalToolResultIndex(state, requests, 0);
    assert.equal(state.index['A'], aRef);
  });

  it('非数组 requests → 直接返回，不抛错', () => {
    const state = M.createEmptyGlobalIndexState();
    assert.doesNotThrow(() => M.appendToGlobalToolResultIndex(state, null, 0));
    assert.deepEqual(state.index, {});
  });

  it('image budget LRU：超过 32 个含图 entry 时最早的降级为 oversized 占位', () => {
    const state = M.createEmptyGlobalIndexState();
    // 构造 34 个含小 base64 图的请求；MAX_LIVE_IMAGE_ENTRIES=32
    const requests = [];
    for (let i = 0; i < 34; i++) {
      const id = `img${i}`;
      requests.push({
        body: {
          messages: [
            asstMsg([use(id, 'Read', { file_path: `/p${i}.png` })]),
            userMsg([
              {
                type: 'tool_result',
                tool_use_id: id,
                content: [
                  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
                ],
              },
            ]),
          ],
        },
      });
    }
    M.appendToGlobalToolResultIndex(state, requests, 0);
    // 最早 2 个（img0, img1）应被驱逐为 oversized
    assert.equal(state.index['img0'].images[0].oversized, true);
    assert.equal(state.index['img0'].images[0].mediaType, 'image/png');
    assert.ok(typeof state.index['img0'].images[0].sizeBytes === 'number');
    assert.equal(state.index['img1'].images[0].oversized, true);
    // 后入的仍保留 src
    assert.ok(state.index['img33'].images[0].src.startsWith('data:image/png;base64,'));
    // FIFO 队列被裁到 <= 32
    assert.ok(state._imageEntryIds.length <= 32);
  });
});

// ── buildSubAgentResultMap ──────────────────────────────────────────────────
describe('buildSubAgentResultMap', () => {
  it('无 response.content → 返回本地 toolResultMap（含 body 内配对）', () => {
    const req = {
      body: { messages: [asstMsg([use('A', 'Bash', {})]), userMsg([result('A', 'local')])] },
    };
    const out = M.buildSubAgentResultMap(req, {});
    assert.equal(out['A'].resultText, 'local');
  });

  it('无 globalIndex → 返回本地 map（命中 short-circuit）', () => {
    const req = {
      body: { messages: [asstMsg([use('A', 'Bash', {})]), userMsg([result('A', 'local')])] },
      response: { body: { content: [use('B', 'Read', {})] } },
    };
    const out = M.buildSubAgentResultMap(req, null);
    assert.equal(out['A'].resultText, 'local');
    assert.equal(out['B'], undefined);
  });

  it('末轮 tool_use 在全局索引补偿回填', () => {
    const req = {
      body: { messages: [] },
      response: { body: { content: [use('tail', 'Bash', {})] } },
    };
    const globalIndex = { tail: { resultText: 'compensated', toolName: 'Bash' } };
    const out = M.buildSubAgentResultMap(req, globalIndex);
    assert.equal(out['tail'].resultText, 'compensated');
  });

  it('无任何补偿 → 返回原 localState.toolResultMap 引用（避免 memo 抖动）', () => {
    // response.content 里的 tool_use 在本地已有 result，或 globalIndex 没有 → filled=null
    const req = {
      body: { messages: [asstMsg([use('A', 'Bash', {})]), userMsg([result('A', 'x')])] },
      response: { body: { content: [use('A', 'Bash', {})] } }, // A 已在本地
    };
    const globalIndex = { other: { resultText: 'nope' } };
    const out = M.buildSubAgentResultMap(req, globalIndex);
    // 命中 filled=null 分支：返回的应是本地已含 A 的 map
    assert.equal(out['A'].resultText, 'x');
    assert.equal(out['other'], undefined);
  });

  it('req 为 undefined → 使用 EMPTY_MESSAGES 不抛错', () => {
    const out = M.buildSubAgentResultMap(undefined, {});
    assert.deepEqual(out, {});
  });
});

// ── appendToolResultMap（核心大函数） ───────────────────────────────────────
describe('appendToolResultMap — tool_use 解析', () => {
  it('普通 tool_use 写入 toolUseMap', () => {
    const s = M.buildToolResultMap([asstMsg([use('A', 'Bash', { command: 'ls' })])]);
    assert.equal(s.toolUseMap['A'].name, 'Bash');
    assert.equal(s.toolUseMap['A'].input.command, 'ls');
  });

  it('input 是字符串 → JSON.parse 并剥离 [object Object] 前缀', () => {
    const s = M.buildToolResultMap([
      asstMsg([{ type: 'tool_use', id: 'A', name: 'Bash', input: '[object Object]{"command":"pwd"}' }]),
    ]);
    assert.equal(s.toolUseMap['A'].input.command, 'pwd');
  });

  it('input 是非法 JSON 字符串 → catch 后保留原始 block', () => {
    const s = M.buildToolResultMap([
      asstMsg([{ type: 'tool_use', id: 'A', name: 'Bash', input: 'not json at all' }]),
    ]);
    assert.equal(s.toolUseMap['A'].input, 'not json at all');
  });
});

describe('appendToolResultMap — plan 文件追踪', () => {
  it('Write .claude/plans/ 文件 → latestPlanContent 更新', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('w', 'Write', { file_path: '/proj/.claude/plans/p.md', content: 'PLAN BODY' })]),
    ]);
    assert.equal(s.latestPlanContent, 'PLAN BODY');
  });

  it('Write 非 plans 路径 → 不更新 latestPlanContent', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('w', 'Write', { file_path: '/proj/src/x.js', content: 'code' })]),
    ]);
    assert.equal(s.latestPlanContent, null);
  });

  it('ExitPlanMode V2 input.plan / planFilePath → 直接注入', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('e', 'ExitPlanMode', { plan: 'inline plan', planFilePath: '/x/plan.md' })]),
    ]);
    assert.equal(s.latestPlanContent, 'inline plan');
    assert.equal(s.latestPlanFilePath, '/x/plan.md');
    assert.equal(s._planDirty, 1);
  });

  it('ExitPlanMode input.plan 为空白字符串 → 不注入', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('e', 'ExitPlanMode', { plan: '   ' })]),
    ]);
    assert.equal(s.latestPlanContent, null);
  });
});

describe('appendToolResultMap — Edit 快照与行号', () => {
  it('Read 先建立 _fileState，再 Edit 增量更新 plainText 与行号', () => {
    const fp = '/proj/file.js';
    const readContent = '   1→const a = 1;\n   2→const b = 2;\n   3→const c = 3;';
    const messages = [
      asstMsg([use('r', 'Read', { file_path: fp })]),
      userMsg([result('r', readContent)]),
      asstMsg([use('ed', 'Edit', { file_path: fp, old_string: 'const b = 2;', new_string: 'const b = 22;' })]),
    ];
    const s = M.buildToolResultMap(messages);
    // editSnapshot 记录 Edit 之前的状态
    assert.ok(s.editSnapshotMap['ed']);
    assert.equal(s.editSnapshotMap['ed'].plainText, 'const a = 1;\nconst b = 2;\nconst c = 3;');
    assert.deepEqual(s.editSnapshotMap['ed'].lineNums, [1, 2, 3]);
    // _fileState 已应用编辑（同行替换，行数不变）
    assert.equal(s._fileState[fp].plainText, 'const a = 1;\nconst b = 22;\nconst c = 3;');
    assert.equal(s._editOrder.length, 1);
  });

  it('Edit 增加行数 → lineNums 重排并 shift 后续行号', () => {
    const fp = '/proj/multi.js';
    const readContent = '   1→line one\n   2→line two';
    const messages = [
      asstMsg([use('r', 'Read', { file_path: fp })]),
      userMsg([result('r', readContent)]),
      // old 单行 → new 双行，lineDelta=+1
      asstMsg([use('ed', 'Edit', { file_path: fp, old_string: 'line one', new_string: 'line one\nINSERTED' })]),
    ];
    const s = M.buildToolResultMap(messages);
    assert.equal(s._fileState[fp].plainText, 'line one\nINSERTED\nline two');
    // 原 [1,2] → 第 1 行变 2 行 (1,2)，后续 line two 从 2 shift 到 3
    assert.deepEqual(s._fileState[fp].lineNums, [1, 2, 3]);
  });

  it('Edit plan 文件 → latestPlanContent 同步为编辑后完整内容', () => {
    const fp = '/proj/.claude/plans/p.md';
    const readContent = '   1→# Plan\n   2→step a';
    const messages = [
      asstMsg([use('r', 'Read', { file_path: fp })]),
      userMsg([result('r', readContent)]),
      asstMsg([use('ed', 'Edit', { file_path: fp, old_string: 'step a', new_string: 'step b' })]),
    ];
    const s = M.buildToolResultMap(messages);
    assert.equal(s.latestPlanContent, '# Plan\nstep b');
  });

  it('Edit 无前置 _fileState → 跳过快照（无对应 read）', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('ed', 'Edit', { file_path: '/never/read.js', old_string: 'a', new_string: 'b' })]),
    ]);
    assert.deepEqual(s.editSnapshotMap, {});
    assert.deepEqual(s._editOrder, []);
  });

  it('Edit old_string 在内容中找不到 → 不改 plainText（idx<0 分支）', () => {
    const fp = '/proj/nf.js';
    const readContent = '   1→hello world';
    const s = M.buildToolResultMap([
      asstMsg([use('r', 'Read', { file_path: fp })]),
      userMsg([result('r', readContent)]),
      asstMsg([use('ed', 'Edit', { file_path: fp, old_string: 'NONEXISTENT', new_string: 'X' })]),
    ]);
    // 快照仍创建，但内容未变
    assert.ok(s.editSnapshotMap['ed']);
    assert.equal(s._fileState[fp].plainText, 'hello world');
  });
});

describe('appendToolResultMap — editSnapshot LRU 淘汰', () => {
  it('超过 MAX_EDIT_SNAPSHOTS(300) → 最早快照置 null 占位', () => {
    const messages = [];
    // 为每个 Edit 建立一个独立文件的 _fileState（先 Read），制造 301 个快照
    for (let i = 0; i < 301; i++) {
      const fp = `/f/${i}.js`;
      messages.push(asstMsg([use(`r${i}`, 'Read', { file_path: fp })]));
      messages.push(userMsg([result(`r${i}`, `   1→content ${i}`)]));
      messages.push(asstMsg([use(`ed${i}`, 'Edit', { file_path: fp, old_string: `content ${i}`, new_string: `new ${i}` })]));
    }
    const s = M.buildToolResultMap(messages);
    // 第一个被淘汰为 null
    assert.equal(s.editSnapshotMap['ed0'], null);
    // 最后一个仍存在
    assert.ok(s.editSnapshotMap['ed300']);
    assert.equal(s._editOrder.length, 300);
  });
});

describe('appendToolResultMap — Read → readContentMap / _fileState 合并', () => {
  it('Read 结果写入 readContentMap（按 file_path）', () => {
    const fp = '/proj/a.txt';
    const s = M.buildToolResultMap([
      asstMsg([use('r', 'Read', { file_path: fp })]),
      userMsg([result('r', '   1→hello')]),
    ]);
    assert.equal(s.readContentMap[fp], '   1→hello');
    assert.equal(s._fileState[fp].plainText, 'hello');
    assert.deepEqual(s._fileState[fp].lineNums, [1]);
  });

  it('两次 Read 同文件不同行段 → _fileState 按行号合并去重排序', () => {
    const fp = '/proj/big.js';
    const s = M.buildToolResultMap([
      asstMsg([use('r1', 'Read', { file_path: fp })]),
      userMsg([result('r1', '   1→aaa\n   2→bbb')]),
      asstMsg([use('r2', 'Read', { file_path: fp })]),
      // 第 2 行被覆盖更新 + 新增第 5 行
      userMsg([result('r2', '   2→BBB\n   5→eee')]),
    ]);
    assert.deepEqual(s._fileState[fp].lineNums, [1, 2, 5]);
    assert.equal(s._fileState[fp].plainText, 'aaa\nBBB\neee');
  });

  it('Read 结果无行号前缀 → plainLines 为空，不建 _fileState', () => {
    const fp = '/proj/raw.txt';
    const s = M.buildToolResultMap([
      asstMsg([use('r', 'Read', { file_path: fp })]),
      userMsg([result('r', 'no line numbers here\njust text')]),
    ]);
    assert.equal(s.readContentMap[fp], 'no line numbers here\njust text');
    assert.equal(s._fileState[fp], undefined);
  });

  it('支持 → 与 制表符 两种行号分隔符', () => {
    const fp = '/proj/tab.txt';
    const s = M.buildToolResultMap([
      asstMsg([use('r', 'Read', { file_path: fp })]),
      userMsg([result('r', '   1\tta\n   2→tb')]),
    ]);
    assert.deepEqual(s._fileState[fp].lineNums, [1, 2]);
    assert.equal(s._fileState[fp].plainText, 'ta\ntb');
  });
});

describe('appendToolResultMap — AskUserQuestion', () => {
  it('正常答案文本 → 解析为 answer map', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('q', 'AskUserQuestion', {})]),
      userMsg([result('q', '"颜色"="红色" "尺寸"="大"')]),
    ]);
    assert.deepEqual(s.askAnswerMap['q'], { 颜色: '红色', 尺寸: '大' });
    assert.equal(s._askDirty, 1);
  });

  it('cancelled：is_error + [cc-viewer:cancel] 前缀 → __cancelled__ + 清洗后的 reason', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('q', 'AskUserQuestion', {})]),
      userMsg([
        result('q', "[cc-viewer:cancel] User doesn't want to proceed: typed instead", { is_error: true }),
      ]),
    ]);
    const a = s.askAnswerMap['q'];
    assert.equal(a.__cancelled__, true);
    // 前缀被截掉
    assert.ok(!/\[cc-viewer:cancel\]/.test(a.__cancelReason__));
    assert.ok(a.__cancelReason__.includes("User doesn't want to proceed"));
  });

  it('rejected：is_error 但无 cancel 前缀且无答案 → __rejected__', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('q', 'AskUserQuestion', {})]),
      userMsg([result('q', "User doesn't want to proceed with this tool use", { is_error: true })]),
    ]);
    assert.deepEqual(s.askAnswerMap['q'], { __rejected__: true });
  });

  it('cancelReason 超长 → slice 到 200 字符', () => {
    const long = 'x'.repeat(500);
    const s = M.buildToolResultMap([
      asstMsg([use('q', 'AskUserQuestion', {})]),
      // 需 isPermissionDenied=true 才进入 cancel 分支
      userMsg([result('q', `[cc-viewer:cancel] User doesn't want to proceed ${long}`, { is_error: true })]),
    ]);
    assert.equal(s.askAnswerMap['q'].__cancelReason__.length, 200);
  });
});

describe('appendToolResultMap — ExitPlanMode 审批', () => {
  it('approved → status approved + planContent 提取', () => {
    const text = 'User has approved your plan.\n## Approved Plan:\nDo the thing\nstep 2';
    const s = M.buildToolResultMap([
      asstMsg([use('e', 'ExitPlanMode', { plan: 'old' })]),
      userMsg([result('e', text)]),
    ]);
    assert.equal(s.planApprovalMap['e'].status, 'approved');
    assert.equal(s.planApprovalMap['e'].planContent, 'Do the thing\nstep 2');
    // 审批后无条件重置
    assert.equal(s.latestPlanContent, null);
    assert.equal(s.latestPlanFilePath, null);
  });

  it('approved with new heading variant → planContent populated + reset', () => {
    // Claude Code CLI ≥2.1.201 emits "## Approved Plan (edited by user):" and no input.plan
    const text = 'User has approved your plan. You can now start coding.\n\n'
      + 'Your plan has been saved to: /Users/x/.claude/plans/p.md\n\n'
      + '## Approved Plan (edited by user):\n# Plan\ndo things';
    const s = M.buildToolResultMap([
      asstMsg([use('e', 'ExitPlanMode', { allowedPrompts: [] })]),
      userMsg([result('e', text)]),
    ]);
    assert.equal(s.planApprovalMap['e'].status, 'approved');
    assert.equal(s.planApprovalMap['e'].planContent, '# Plan\ndo things');
    assert.equal(s.latestPlanContent, null);
    assert.equal(s.latestPlanFilePath, null);
  });

  it('rejected（is_error）→ status rejected + 提取 "the user said:" feedback', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('e', 'ExitPlanMode', {})]),
      userMsg([
        result('e', "User doesn't want to proceed. the user said: please add tests", { is_error: true }),
      ]),
    ]);
    assert.equal(s.planApprovalMap['e'].status, 'rejected');
    assert.equal(s.planApprovalMap['e'].feedback, 'please add tests');
  });

  it('ultraplan（is_error + permission-denied + ultraplan 文案）→ status ultraplan', () => {
    // isUltraplan 要求 isPermissionDenied=true（须命中 "rejected.*tool use" 等）AND 提及 ultraplan
    const s = M.buildToolResultMap([
      asstMsg([use('e', 'ExitPlanMode', {})]),
      userMsg([result('e', 'User rejected tool use; switch to ultraplan mode', { is_error: true })]),
    ]);
    assert.equal(s.planApprovalMap['e'].status, 'ultraplan');
  });

  it('非 error 文本走 parsePlanApproval（pending）', () => {
    const s = M.buildToolResultMap([
      asstMsg([use('e', 'ExitPlanMode', {})]),
      userMsg([result('e', 'some neutral text')]),
    ]);
    assert.equal(s.planApprovalMap['e'].status, 'pending');
  });
});

describe('appendToolResultMap — 通用 tool_result', () => {
  it('未配对 tool_result（无 matchedTool）仍写入 toolResultMap', () => {
    const s = M.buildToolResultMap([userMsg([result('orphan', 'lonely')])]);
    assert.equal(s.toolResultMap['orphan'].resultText, 'lonely');
    assert.equal(s.toolResultMap['orphan'].toolName, null);
  });

  it('忽略非 tool_use / tool_result 类型的 block', () => {
    const s = M.buildToolResultMap([
      asstMsg([{ type: 'text', text: 'hi' }]),
      userMsg([{ type: 'text', text: 'reply' }]),
    ]);
    assert.deepEqual(s.toolResultMap, {});
    assert.deepEqual(s.toolUseMap, {});
  });

  it('content 非数组的 msg 被跳过', () => {
    const s = M.buildToolResultMap([
      { role: 'assistant', content: 'plain string' },
      { role: 'user', content: null },
    ]);
    assert.deepEqual(s.toolUseMap, {});
    assert.deepEqual(s.toolResultMap, {});
  });
});

// ── buildToolResultMap / cachedBuildToolResultMap ───────────────────────────
describe('buildToolResultMap / cachedBuildToolResultMap', () => {
  it('buildToolResultMap 从空 state 全量构建', () => {
    const msgs = [asstMsg([use('A', 'Bash', {})]), userMsg([result('A', 'r')])];
    const s = M.buildToolResultMap(msgs);
    assert.equal(s.toolResultMap['A'].resultText, 'r');
  });

  it('cachedBuildToolResultMap 同一 messages 引用返回缓存（同一 state）', () => {
    const msgs = [asstMsg([use('A', 'Bash', {})]), userMsg([result('A', 'r')])];
    const first = M.cachedBuildToolResultMap(msgs);
    const second = M.cachedBuildToolResultMap(msgs);
    assert.equal(first, second);
    // 缓存写穿到 WeakMap
    assert.equal(M.getToolResultCache(msgs), first);
  });

  it('不同 messages 引用 → 不同 state', () => {
    const a = M.cachedBuildToolResultMap([userMsg([result('A', 'a')])]);
    const b = M.cachedBuildToolResultMap([userMsg([result('A', 'b')])]);
    assert.notEqual(a, b);
  });
});

// ── parseAskAnswerText ──────────────────────────────────────────────────────
describe('parseAskAnswerText', () => {
  it('提取多组 "k"="v" 键值对', () => {
    assert.deepEqual(M.parseAskAnswerText('"q1"="a1" "q2"="a2"'), { q1: 'a1', q2: 'a2' });
  });

  it('允许空 value', () => {
    assert.deepEqual(M.parseAskAnswerText('"q1"=""'), { q1: '' });
  });

  it('无匹配 → 空对象', () => {
    assert.deepEqual(M.parseAskAnswerText('no kv pairs here'), {});
    assert.deepEqual(M.parseAskAnswerText(''), {});
  });

  it('重复 key → 后者覆盖', () => {
    assert.deepEqual(M.parseAskAnswerText('"k"="v1" "k"="v2"'), { k: 'v2' });
  });
});

// ── parsePlanApproval ───────────────────────────────────────────────────────
describe('parsePlanApproval', () => {
  it('空文本 → pending', () => {
    assert.deepEqual(M.parsePlanApproval(''), { status: 'pending' });
    assert.deepEqual(M.parsePlanApproval(null), { status: 'pending' });
    assert.deepEqual(M.parsePlanApproval(undefined), { status: 'pending' });
  });

  it('approved → 提取 ## Approved Plan: 后的内容', () => {
    const r = M.parsePlanApproval('User has approved your plan\n## Approved Plan:\nthe plan text');
    assert.equal(r.status, 'approved');
    assert.equal(r.planContent, 'the plan text');
  });

  it('approved → new heading variant "## Approved Plan (edited by user):" is extracted', () => {
    const r = M.parsePlanApproval(
      'User has approved your plan. You can now start coding.\n\n'
      + 'Your plan has been saved to: /Users/x/.claude/plans/p.md\n\n'
      + '## Approved Plan (edited by user):\n# Title\nstep 1\nstep 2'
    );
    assert.equal(r.status, 'approved');
    assert.equal(r.planContent, '# Title\nstep 1\nstep 2');
  });

  it('approved → heading with trailing spaces before newline still extracts', () => {
    const r = M.parsePlanApproval('User has approved\n## Approved Plan:  \nbody');
    assert.equal(r.status, 'approved');
    assert.equal(r.planContent, 'body');
  });

  it('approved 但无 Approved Plan 块 → planContent 空串', () => {
    const r = M.parsePlanApproval('User has approved');
    assert.equal(r.status, 'approved');
    assert.equal(r.planContent, '');
  });

  it('rejected → 提取 feedback:', () => {
    const r = M.parsePlanApproval('User rejected the plan\nfeedback: needs more detail');
    assert.equal(r.status, 'rejected');
    assert.equal(r.feedback, 'needs more detail');
  });

  it('rejected fallback：无 feedback: 时用 "User rejected ...:" 捕获', () => {
    const r = M.parsePlanApproval('User rejected plan: too risky');
    assert.equal(r.status, 'rejected');
    assert.equal(r.feedback, 'too risky');
  });

  it('rejected 无任何可提取 feedback → 空串', () => {
    const r = M.parsePlanApproval('User rejected');
    assert.equal(r.status, 'rejected');
    assert.equal(r.feedback, '');
  });

  it('既非 approved 也非 rejected → pending', () => {
    assert.deepEqual(M.parsePlanApproval('still waiting'), { status: 'pending' });
  });
});
