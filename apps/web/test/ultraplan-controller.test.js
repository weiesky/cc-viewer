// 行为测试：UltraplanController（从 ChatView / TerminalPanel 抽出的 UltraPlan 重复逻辑）。
//
// 控制器是依赖注入的纯逻辑类，可直接在 node:test 下 import（不依赖 antd / React / window）。
// 用 fake host 覆盖纯逻辑方法：文件 removeFile / paste、自定义专家 persist / save / delete
//（含 variant 回落两分支、上传 reject 错误路径）。handleUpload 依赖 document.createElement，
// DOM-bound 不单测——其上传分支逻辑与 paste 同源已覆盖。

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UltraplanController } from '../src/utils/ultraplanController.js';

// ─── fake host：模拟宿主组件的 state / 上传 / 提示 / 偏好 / 关闭编辑器桥接 ───────────
function makeHost({ uploadOk = true, initialFiles = [], initialExperts = [], variant = 'codeExpert' } = {}) {
  const state = {
    ultraplanFiles: [...initialFiles],
    customUltraplanExperts: [...initialExperts],
    ultraplanVariant: variant,
  };
  const uploadCalls = [];      // uploadFile 入参捕获
  const messageErrors = [];    // messageError 捕获
  const prefUpdates = [];      // onUpdatePreferences 捕获
  const closeEditorCalls = []; // closeEditor 调用计数

  const host = {
    _state: state,
    _uploadCalls: uploadCalls,
    _messageErrors: messageErrors,
    _prefUpdates: prefUpdates,
    _closeEditorCalls: closeEditorCalls,

    getState: () => state,
    setState: (updater) => {
      const partial = typeof updater === 'function' ? updater(state) : updater;
      if (partial) Object.assign(state, partial);
    },
    onUpdatePreferences: (payload) => { prefUpdates.push(payload); },
    uploadFile: (file) => {
      uploadCalls.push(file?.name);
      return uploadOk
        ? Promise.resolve(`/tmp/upload/${file?.name || 'x'}`)
        : Promise.reject(new Error('boom'));
    },
    messageError: (msg) => { messageErrors.push(msg); },
    closeEditor: () => { closeEditorCalls.push(true); },
  };
  return host;
}

const tick = () => new Promise(r => setImmediate(r));

describe('UltraplanController — handleRemoveFile', () => {
  it('按 idx 过滤文件', () => {
    const host = makeHost({ initialFiles: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
    const c = new UltraplanController(host);
    c.handleRemoveFile(1);
    assert.deepEqual(host._state.ultraplanFiles.map(f => f.name), ['a', 'c']);
  });
});

describe('UltraplanController — persistExperts', () => {
  it('setState 写专家列表 + onUpdatePreferences 收到 payload', () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    const experts = [{ id: 'x', name: 'X' }];
    c.persistExperts(experts);
    assert.deepEqual(host._state.customUltraplanExperts, experts);
    assert.equal(host._prefUpdates.length, 1);
    assert.deepEqual(host._prefUpdates[0], { customUltraplanExperts: experts });
  });
});

describe('UltraplanController — saveExpert', () => {
  it('id 不存在 → 追加', () => {
    const host = makeHost({ initialExperts: [{ id: 'a', name: 'A' }] });
    const c = new UltraplanController(host);
    c.saveExpert({ id: 'b', name: 'B' });
    assert.deepEqual(host._state.customUltraplanExperts.map(e => e.id), ['a', 'b']);
    assert.equal(host._closeEditorCalls.length, 1);
  });

  it('id 存在 → 原位替换', () => {
    const host = makeHost({ initialExperts: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    const c = new UltraplanController(host);
    c.saveExpert({ id: 'a', name: 'A2' });
    assert.deepEqual(host._state.customUltraplanExperts, [{ id: 'a', name: 'A2' }, { id: 'b', name: 'B' }]);
    assert.equal(host._closeEditorCalls.length, 1);
  });
});

describe('UltraplanController — deleteExpert', () => {
  it('移除指定专家 + 关闭编辑器', () => {
    const host = makeHost({ initialExperts: [{ id: 'a' }, { id: 'b' }], variant: 'codeExpert' });
    const c = new UltraplanController(host);
    c.deleteExpert('a');
    assert.deepEqual(host._state.customUltraplanExperts.map(e => e.id), ['b']);
    assert.equal(host._state.ultraplanVariant, 'codeExpert'); // 未选中被删者 → variant 不动
    assert.equal(host._closeEditorCalls.length, 1);
  });

  it('删的正是当前选中专家 → variant 回落 codeExpert', () => {
    const host = makeHost({ initialExperts: [{ id: 'a' }], variant: 'custom:a' });
    const c = new UltraplanController(host);
    c.deleteExpert('a');
    assert.equal(host._state.ultraplanVariant, 'codeExpert');
  });

  it('删的不是当前选中专家 → variant 保持', () => {
    const host = makeHost({ initialExperts: [{ id: 'a' }, { id: 'b' }], variant: 'custom:b' });
    const c = new UltraplanController(host);
    c.deleteExpert('a');
    assert.equal(host._state.ultraplanVariant, 'custom:b');
  });
});

describe('UltraplanController — persistExpertLayout', () => {
  it('写 order/hidden 到 state + 同步 onUpdatePreferences', () => {
    const host = makeHost({ initialExperts: [{ id: 'a' }], variant: 'codeExpert' });
    const c = new UltraplanController(host);
    const order = ['researchExpert', 'codeExpert', 'custom:a'];
    c.persistExpertLayout({ order, hidden: [] });
    assert.deepEqual(host._state.ultraplanExpertOrder, order);
    assert.deepEqual(host._state.ultraplanExpertHidden, []);
    assert.equal(host._prefUpdates.length, 1);
    assert.deepEqual(host._prefUpdates[0], { ultraplanExpertOrder: order, ultraplanExpertHidden: [] });
  });

  it('当前选中变体被隐藏 → 回落首个可见键', () => {
    const host = makeHost({ initialExperts: [{ id: 'a' }], variant: 'codeExpert' });
    const c = new UltraplanController(host);
    c.persistExpertLayout({ order: [], hidden: ['codeExpert'] });
    // 可见序 = [researchExpert, custom:a] → 回落 researchExpert
    assert.equal(host._state.ultraplanVariant, 'researchExpert');
  });

  it('当前选中变体仍可见 → variant 不动', () => {
    const host = makeHost({ initialExperts: [{ id: 'a' }], variant: 'custom:a' });
    const c = new UltraplanController(host);
    c.persistExpertLayout({ order: [], hidden: ['codeExpert'] });
    assert.equal(host._state.ultraplanVariant, 'custom:a');
  });

  it('全部隐藏 → 兜底回落 codeExpert', () => {
    const host = makeHost({ initialExperts: [], variant: 'codeExpert' });
    const c = new UltraplanController(host);
    c.persistExpertLayout({ order: [], hidden: ['codeExpert', 'researchExpert'] });
    assert.equal(host._state.ultraplanVariant, 'codeExpert');
  });
});

describe('UltraplanController — handlePaste', () => {
  function makeImageEvent() {
    const calls = { preventDefault: 0 };
    const event = {
      preventDefault: () => { calls.preventDefault += 1; },
      clipboardData: {
        items: [{
          type: 'image/png',
          getAsFile: () => ({ name: 'shot.png' }),
        }],
      },
    };
    return { event, calls };
  }

  it('图片项 → preventDefault + 上传入列', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    const { event, calls } = makeImageEvent();
    await c.handlePaste(event);
    await tick();
    assert.equal(calls.preventDefault, 1);
    assert.deepEqual(host._uploadCalls, ['shot.png']);
    assert.equal(host._state.ultraplanFiles.length, 1);
    assert.equal(host._state.ultraplanFiles[0].name, 'shot.png');
  });

  it('上传失败 → messageError 被调，文件不入列', async () => {
    const host = makeHost({ uploadOk: false });
    const c = new UltraplanController(host);
    const { event } = makeImageEvent();
    await c.handlePaste(event);
    await tick();
    assert.equal(host._messageErrors.length, 1);
    assert.equal(host._state.ultraplanFiles.length, 0);
  });

  it('非图片剪贴板 → 不处理、不 preventDefault', async () => {
    const host = makeHost();
    const c = new UltraplanController(host);
    const calls = { preventDefault: 0 };
    await c.handlePaste({
      preventDefault: () => { calls.preventDefault += 1; },
      clipboardData: { items: [{ type: 'text/plain', getAsFile: () => null }] },
    });
    await tick();
    assert.equal(calls.preventDefault, 0);
    assert.equal(host._uploadCalls.length, 0);
  });
});
