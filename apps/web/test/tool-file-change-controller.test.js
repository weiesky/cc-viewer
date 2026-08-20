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
