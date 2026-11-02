// 行为测试：ToolFileChangeController（从 ChatView 抽出的工具文件变更监听 + LRU 去重）。
// fake host + mock.timers 覆盖触发刷新/pending、Bash mutating、内容刷新、LRU 砍头、去重、
// requests 数据源、input 防御分支、绝对路径相对化、collectToolUseBlocks 纯函数。

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ToolFileChangeController, collectToolUseBlocks } from '../src/components/chat/controllers/toolFileChangeController.js';

function makeHost({ currentFile = null, fileExplorerOpen = false, gitChangesOpen = false, projectDir = null } = {}) {
  const state = {
    currentFile, fileExplorerOpen, gitChangesOpen,
    fileExplorerRefresh: 0, gitChangesRefresh: 0, fileVersion: 0,
  };
  let mainAgentSessions = [];
  let requests = [];
  const pending = { file: 0, git: 0 };
  const host = {
    _state: state,
    _pending: pending,
    setProps: (s, r) => { mainAgentSessions = s || []; requests = r || []; },
    getState: () => state,
    setState: (u) => {
      const partial = typeof u === 'function' ? u(state) : u;
      if (partial) Object.assign(state, partial);
    },
    getProps: () => ({ mainAgentSessions, requests }),
    getProjectDir: () => projectDir,
    setPendingFileRefresh: () => { pending.file += 1; },
    setPendingGitRefresh: () => { pending.git += 1; },
  };
  return host;
}

// 含 1 个 Write tool_use + 对应 tool_result 的 mainAgentSession
function sessionWithWrite(toolId = 't1', filePath = 'foo.js') {
  return {
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Write', input: { file_path: filePath } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId }] },
    ],
  };
}

// 含 1 个 Write 的 request（subAgent/teammate 路径，走 req.body.messages）
function requestWithWrite(toolId = 'r1', filePath = 'bar.js') {
  return {
    body: {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: 'Write', input: { file_path: filePath } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolId }] },
      ],
    },
  };
}

describe('ToolFileChangeController — 触发刷新', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('Write 工具 + 面板打开 → 防抖 500ms 后 file/git refresh 计数 +1', () => {
    const host = makeHost({ fileExplorerOpen: true, gitChangesOpen: true });
    host.setProps([sessionWithWrite()], []);
    const c = new ToolFileChangeController(host);
    c.check();
    assert.equal(host._state.fileExplorerRefresh, 0, '防抖期未刷新');
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1);
    assert.equal(host._state.gitChangesRefresh, 1);
  });

  it('Write 工具 + 面板关闭 → 记 pending，不刷新计数', () => {
    const host = makeHost({ fileExplorerOpen: false, gitChangesOpen: false });
    host.setProps([sessionWithWrite()], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._pending.file, 1);
    assert.equal(host._pending.git, 1);
    assert.equal(host._state.fileExplorerRefresh, 0);
  });

  it('git 开 / file 关混合 → git 防抖刷新、file 记 pending', () => {
    const host = makeHost({ fileExplorerOpen: false, gitChangesOpen: true });
    host.setProps([sessionWithWrite()], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.gitChangesRefresh, 1);
    assert.equal(host._pending.file, 1);
    assert.equal(host._state.fileExplorerRefresh, 0);
  });

  it('Bash mutating command 触发 file/git refresh', () => {
    const host = makeHost({ fileExplorerOpen: true });
    const session = {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'rm -rf build' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1' }] },
      ],
    };
    host.setProps([session], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1);
  });

  it('Bash git commit 触发 Git 面板刷新', () => {
    const host = makeHost({ fileExplorerOpen: true, gitChangesOpen: true });
    const session = {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'git-commit', name: 'Bash', input: { command: 'git commit -m "update files"' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'git-commit' }] },
      ],
    };
    host.setProps([session], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.gitChangesRefresh, 1);
    assert.equal(host._state.fileExplorerRefresh, 1);
  });

  it('requests 数据源（subAgent/teammate）的 Write 同样触发刷新', () => {
    const host = makeHost({ fileExplorerOpen: true });
    host.setProps([], [requestWithWrite()]); // 只走 requests，mainAgentSessions 为空
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1);
  });

  it('当前打开文件被 Write 命中 → fileVersion +1', () => {
    const host = makeHost({ currentFile: 'foo.js' });
    host.setProps([sessionWithWrite('t1', 'foo.js')], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileVersion, 1);
  });

  it('绝对路径 file_path + projectDir 相对化后命中 currentFile → fileVersion +1', () => {
    const host = makeHost({ currentFile: 'src/foo.js', projectDir: '/proj' });
    host.setProps([sessionWithWrite('t1', '/proj/src/foo.js')], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileVersion, 1);
  });

  it('file_path 非 string（异常 input）→ 不抛错、不触发 content 刷新', () => {
    const host = makeHost({ currentFile: 'foo.js', fileExplorerOpen: true });
    const session = {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 12345 } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      ],
    };
    host.setProps([session], []);
    const c = new ToolFileChangeController(host);
    assert.doesNotThrow(() => c.check());
    mock.timers.tick(500);
    assert.equal(host._state.fileVersion, 0, 'fp 非 string → 不刷新内容');
    assert.equal(host._state.fileExplorerRefresh, 1, '但 Write 仍触发 file 刷新');
  });

  it('is_error 的 tool_result 不触发刷新（但仍标记已处理）', () => {
    const host = makeHost({ fileExplorerOpen: true });
    const session = {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: 'a.js' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true }] },
      ],
    };
    host.setProps([session], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 0);
    assert.equal(c._processedToolIds.has('t1'), true, 'is_error 也标记已处理');
  });
});

describe('ToolFileChangeController — 去重 / LRU', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('同一 tool_use_id 第二次 check 不重复触发', () => {
    const host = makeHost({ fileExplorerOpen: true });
    host.setProps([sessionWithWrite('t1')], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1);
    c.check(); // 第二次：t1 已处理
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1, '不再重复 +1');
  });

  it('LRU 砍头：超 MAX(20000) → 砍到 KEEP(15000)，Set/Queue 长度不变量', () => {
    const host = makeHost();
    host.setProps([{ messages: [] }], []); // 非空源以越过 early-return
    const c = new ToolFileChangeController(host);
    for (let i = 0; i < 20001; i++) {
      const id = 'id' + i;
      c._processedToolIds.add(id);
      c._processedToolIdQueue.push(id);
    }
    c.check();
    assert.equal(c._processedToolIds.size, 15000);
    assert.equal(c._processedToolIdQueue.length, 15000);
    // 砍掉最旧的，保留最新的
    assert.equal(c._processedToolIds.has('id0'), false);
    assert.equal(c._processedToolIds.has('id20000'), true);
  });
});

describe('ToolFileChangeController — dispose', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('dispose 清理在途 timer 不报错', () => {
    const host = makeHost({ fileExplorerOpen: true });
    host.setProps([sessionWithWrite()], []);
    const c = new ToolFileChangeController(host);
    c.check();          // 安排了 timer
    c.dispose();        // 清理
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 0, 'dispose 后 timer 不再触发');
  });
});

// 增量扫描（性能修复）：check() 不再每帧全量重扫所有 sessions/requests 的 messages，
// 而是用 WeakMap<对象, 已扫 messages 长度> 游标只扫增量。以下验证增量行为与全量一致，
// 且不重复触发、不漏触发。
describe('增量扫描游标', () => {
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); });

  it('同一 session 追加新 tool_result → 只触发新增的那次，旧的幂等不重刷', () => {
    const host = makeHost({ fileExplorerOpen: true });
    // 一个会持续增长的 session 对象（merge 复用同一对象引用）。
    const session = {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: 'a.js' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1' }] },
      ],
    };
    host.setProps([session], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1, '第一个 Write 触发一次刷新');

    // 同一 session 对象追加第二个 Write（merge 的 push 模式：messages 变长）。
    session.messages.push(
      { role: 'assistant', content: [{ type: 'tool_use', id: 'w2', name: 'Write', input: { file_path: 'b.js' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w2' }] },
    );
    c.check(); // 增量：应只处理 w2，w1 幂等早退
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 2, '第二个 Write 增量再触发一次（不重刷 w1）');
  });

  it('push 一个新 session 对象 → 新 session 从 0 全扫，其 tool_result 被检测', () => {
    const host = makeHost({ fileExplorerOpen: true });
    const s1 = sessionWithWrite('t1', 'old.js');
    host.setProps([s1], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1);

    // 新增一个全新 session 对象（新会话）。
    const s2 = sessionWithWrite('t2', 'new.js');
    host.setProps([s1, s2], []);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 2, '新 session 的 Write 被增量检测');
  });

  it('requests 数据源增量：同一 request 追加 messages → 只扫增量', () => {
    const host = makeHost({ fileExplorerOpen: true });
    const req = {
      body: { messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'Write', input: { file_path: 'x.js' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1' }] },
      ] },
    };
    host.setProps([], [req]);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1);

    // 同一 request 对象 messages 增长（累积前缀），追加第二个 Write。
    req.body.messages.push(
      { role: 'assistant', content: [{ type: 'tool_use', id: 'r2', name: 'Write', input: { file_path: 'y.js' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r2' }] },
    );
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 2, 'request 增量 Write 再触发一次');
  });

  it('resetCursors 后重扫：_processedToolIds 幂等 → 不重复触发已处理的刷新', () => {
    const host = makeHost({ fileExplorerOpen: true });
    host.setProps([sessionWithWrite('t1')], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1);

    // 冷加载/切会话 → resetCursors。同一内容重扫，但 w 的 tool_result 已在
    // _processedToolIds 里（不被 resetCursors 清），幂等早退 → 不重复触发。
    c.resetCursors();
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1, 'reset 后重扫不重复触发已处理的 tool_result');
  });

  it('流式尾部 content 增长：同一 user message 追加 tool_result block → 被捕获', () => {
    const host = makeHost({ fileExplorerOpen: true });
    // 先收集 tool_use（assistant），尾部 user message 初始无 tool_result。
    const session = {
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 's1', name: 'Write', input: { file_path: 's.js' } }] },
        { role: 'user', content: [{ type: 'text', text: 'working...' }] },
      ],
    };
    host.setProps([session], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 0, '初始无 tool_result，不刷新');

    // 流式把 tool_result 合进尾部那条已扫的 user message（message 数不变、content 增长）。
    session.messages[1].content.push({ type: 'tool_result', tool_use_id: 's1' });
    c.check(); // 尾部重扫一条 → 捕获新合入的 tool_result
    mock.timers.tick(500);
    assert.equal(host._state.fileExplorerRefresh, 1, '尾部 message 新增的 tool_result 被重扫捕获');
  });

  it('长度回缩（/clear 重置该 session）→ 从 0 重扫不抛错', () => {
    const host = makeHost({ fileExplorerOpen: true });
    const session = sessionWithWrite('t1');
    host.setProps([session], []);
    const c = new ToolFileChangeController(host);
    c.check();
    mock.timers.tick(500);
    // /clear：同一 session 对象的 messages 被换成更短的全新数组。
    session.messages = [{ role: 'user', content: [{ type: 'text', text: 'after clear' }] }];
    c.check(); // scanned(2) > msgs.length(1) → from=0 重扫
    mock.timers.tick(500);
    assert.ok(true, '回缩重扫不抛错');
  });
});

describe('collectToolUseBlocks（纯函数）', () => {
  it('正常 tool_use → 收集 {name, input}', () => {
    const map = new Map();
    collectToolUseBlocks([{ type: 'tool_use', id: 'x', name: 'Write', input: { file_path: 'a.js' } }], map);
    assert.deepEqual(map.get('x'), { name: 'Write', input: { file_path: 'a.js' } });
  });

  it('string input 含 [object Object] 残片 → 剥前缀后 JSON.parse', () => {
    const map = new Map();
    collectToolUseBlocks([{ type: 'tool_use', id: 'y', name: 'Edit', input: '[object Object]{"file_path":"b.js"}' }], map);
    assert.deepEqual(map.get('y'), { name: 'Edit', input: { file_path: 'b.js' } });
  });

  it('string input 无法 parse → 兜底空对象 {}', () => {
    const map = new Map();
    collectToolUseBlocks([{ type: 'tool_use', id: 'z', name: 'Bash', input: 'not-json-at-all' }], map);
    assert.deepEqual(map.get('z'), { name: 'Bash', input: {} });
  });

  it('非数组 / 非 tool_use / 缺 id|name → 跳过', () => {
    const map = new Map();
    collectToolUseBlocks(null, map);
    collectToolUseBlocks([{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'NoId' }, { type: 'tool_use', id: 'noName' }], map);
    assert.equal(map.size, 0);
  });
});
